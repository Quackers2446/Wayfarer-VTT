import {accounts} from './accounts.mjs';
import {validRuleSet} from './spell-rule-schema.mjs';
import {newRoomOwner,ownerHash,ownsRoom} from './room-owner.mjs';
import {newPlayerCredential,playerCredentialHash,matchesPlayerCredential} from './player-auth.mjs';
const api = "/api/sessions";
const sessionId = "[\\da-f]{8}-(?:[\\da-f]{4}-){3}[\\da-f]{12}";
const sessionPath = new RegExp(`^/api/sessions/(${sessionId})(/artwork|/chat|/players|/voice|/tokens/([\\da-f]{64}))?$`);
const uuid = new RegExp(`^${sessionId}$`);
const chatHistory = 200;
const voiceSignalHistory = 240;
const voiceOnlineMs = 12000;
const stunServers = [
  {urls: "stun:stun.cloudflare.com:3478"},
  {urls: "stun:stun.l.google.com:19302"},
  {urls: "stun:stun1.l.google.com:19302"},
];
const tokenIdPattern = /^[\da-f]{64}$/;
const maxMapBytes = 512 * 1024;
const maxStateBytes = 768 * 1024;
const maxImageBytes = 16 * 1024 * 1024;
const maxTokenBytes = 1280 * 1024;
const maxSessionTokenBytes = 12 * 1024 * 1024;
const imageTypes = new Set(["image/png","image/jpeg","image/webp"]);
const headers = {"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const bytes = (text) => new TextEncoder().encode(text).byteLength;

function reply(value, status = 200, extraHeaders = {}) {
  return Response.json(value,{status,headers:{...headers,...extraHeaders}});
}

const fail = (status,message) => reply({message},status);

/** Short-lived TURN credentials are reusable across joins in the same isolate. */
let turnCache = {at: 0, value: null};
let turnUsageCache = {at: 0, gb: null, ok: false};
const TURN_CACHE_MS = 5 * 60 * 1000;
const TURN_USAGE_CACHE_MS = 15 * 60 * 1000;
const TURN_FREE_GB = 1000;
const GiB = 1024 ** 3;

function turnCapGb(env) {
  const raw = Number(env.TURN_USAGE_CAP_GB);
  // Default 750 GiB ≈ 75% of the shared 1,000 GB Realtime free tier.
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, TURN_FREE_GB) : 750;
}

function stunOnly(reason, extra = {}) {
  return {iceServers: stunServers, turn: false, turnReason: reason, ...extra};
}

/** Monthly Realtime TURN egress in GiB via GraphQL analytics (Account Analytics token). */
async function turnUsageGb(env) {
  const accountId = env.CF_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) return {ok: false, gb: null};
  if (turnUsageCache.ok && Date.now() - turnUsageCache.at < TURN_USAGE_CACHE_MS) {
    return {ok: true, gb: turnUsageCache.gb};
  }
  const now = new Date();
  const from = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00Z`;
  const to = now.toISOString();
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json"},
      body: JSON.stringify({
        query: `query TurnEgress($accountId: String!, $from: String!, $to: String!) {
          viewer {
            accounts(filter: {accountTag: $accountId}) {
              callsTurnUsageAdaptiveGroups(
                filter: {date_geq: $from, date_leq: $to}
                limit: 10000
              ) { sum { egressBytes } }
            }
          }
        }`,
        variables: {accountId, from, to},
      }),
    });
    if (!response.ok) return {ok: false, gb: null};
    const body = await response.json();
    const groups = body?.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups;
    if (!Array.isArray(groups) || body?.errors?.length) return {ok: false, gb: null};
    const bytes = groups.reduce((sum, row) => sum + Number(row?.sum?.egressBytes ?? 0), 0);
    if (!Number.isFinite(bytes)) return {ok: false, gb: null};
    const gb = bytes / GiB;
    turnUsageCache = {at: Date.now(), gb, ok: true};
    return {ok: true, gb};
  } catch {
    return {ok: false, gb: null};
  }
}

async function turnIceServers(env) {
  const keyId = env.TURN_KEY_ID, token = env.TURN_KEY_API_TOKEN;
  if (env.TURN_DISABLED === "1" || env.TURN_DISABLED === "true") {
    return stunOnly("disabled");
  }
  if (!keyId || !token) return stunOnly("missing");

  const cap = turnCapGb(env);
  const usage = await turnUsageGb(env);
  if (usage.ok && usage.gb >= cap) {
    return stunOnly("capped", {turnUsageGb: Math.round(usage.gb * 10) / 10, turnCapGb: cap});
  }

  if (turnCache.value?.turn && Date.now() - turnCache.at < TURN_CACHE_MS) {
    return {
      ...turnCache.value,
      ...(usage.ok ? {turnUsageGb: Math.round(usage.gb * 10) / 10, turnCapGb: cap} : {}),
    };
  }
  try {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
      body: JSON.stringify({ttl: 86400}),
    });
    if (!response.ok) return stunOnly("error");
    const body = await response.json();
    const fromCf = Array.isArray(body?.iceServers) ? body.iceServers.filter(Boolean) : [];
    if (!fromCf.length) return stunOnly("error");
    // Keep public STUN as a fast path; Cloudflare TURN covers hard NAT / symmetric cases.
    const urls = new Set(fromCf.flatMap((server) => [].concat(server.urls ?? [])));
    const iceServers = [
      ...stunServers.filter((server) => !urls.has(server.urls)),
      ...fromCf,
    ];
    turnCache = {at: Date.now(), value: {iceServers, turn: true}};
    return {
      iceServers,
      turn: true,
      ...(usage.ok ? {turnUsageGb: Math.round(usage.gb * 10) / 10, turnCapGb: cap} : {}),
    };
  } catch {
    return stunOnly("error");
  }
}

/** Bind voice/player seat to signed-in account or guest HttpOnly credential — never trust a bare controller UUID. */
async function authorizePlayerSeat(request, env, session, controller) {
  if (typeof controller !== "string" || !uuid.test(controller)) return {error: fail(400, "The player ID was invalid.")};
  const account = await accounts.identity(request, env);
  if (account) {
    if (controller !== account.id) return {error: fail(403, "Reload Wayfarer to use your signed-in profile.")};
    return {account, controller};
  }
  if (await env.DB.prepare("SELECT id FROM account_users WHERE id=?").bind(controller).first()) {
    return {error: fail(403, "Sign in to use this player profile.")};
  }
  const presented = await playerCredentialHash(request);
  const auth = await env.DB.prepare("SELECT credential_hash FROM session_player_auth WHERE session_id=? AND controller=?")
    .bind(session, controller).first();
  if (!auth || !matchesPlayerCredential(auth.credential_hash, presented)) {
    return {error: fail(403, "Join the room from this browser before using that player seat.")};
  }
  return {controller};
}
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const positive = (value) => Number.isFinite(value) && value > 0;
const alignmentShape = (value) => record(value) && positive(value.width) && positive(value.height) &&
  Number.isFinite(value.x) && Number.isFinite(value.y);

function validMap(map) {
  return record(map) && [map.key,map.title,map.module].every((value) => typeof value === "string") &&
    [map.width,map.height,map.size].every(positive) && Number.isFinite(map.offsetX) && Number.isFinite(map.offsetY) &&
    [map.cellWidth,map.cellHeight].every((cell) => cell == null || positive(cell)) &&
    (!map.sourceGrid || alignmentShape(map.sourceGrid) && positive(map.sourceGrid.divisions)) &&
    [map.cols,map.rows].every((value) => Number.isInteger(value) && value > 0) && map.cols*map.rows <= 90000 &&
    Array.isArray(map.regions) && map.regions.every((region) => record(region) && Array.isArray(region.points) &&
      region.points.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)));
}

function validRoom(room) {
  return room==null || record(room) && typeof room.name==='string' && room.name.trim().length>0 && room.name.length<=80 &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(room.name) &&
    [room.adventure,room.adventureName].every(value=>value==null || typeof value==='string' && value.length<=160) &&
    [room.createdAt,room.updatedAt].every(value=>value==null || Number.isSafeInteger(value) && value>0);
}

const optionalRange=(o,k,min,max)=>o[k]==null || Number.isFinite(o[k]) && o[k]>=min && o[k]<=max;
function validRest(rest){return rest==null||record(rest)&&(rest.shortUsed==null||Number.isInteger(rest.shortUsed)&&rest.shortUsed>=0&&rest.shortUsed<=2)&&(rest.encounterProgress==null||record(rest.encounterProgress)&&Object.keys(rest.encounterProgress).length<=200&&Object.values(rest.encounterProgress).every(n=>Number.isFinite(n)&&n>=0&&n<1e9))&&(rest.tableChoices==null||record(rest.tableChoices)&&Object.keys(rest.tableChoices).length<=200&&Object.values(rest.tableChoices).every(id=>typeof id==='string'&&id.length<=300));}
function validVision(v){return v==null || record(v) && (v.enabled==null || typeof v.enabled==='boolean') && optionalRange(v,'range',0,300) && optionalRange(v,'angle',1,360) && optionalRange(v,'facing',0,360);}
function validWalls(v){return v==null || record(v) && ['walls','doors'].every(type=>v[type]==null || Array.isArray(v[type]) && v[type].length<=2000 && v[type].every(s=>record(s) && ['x1','y1','x2','y2'].every(k=>Number.isFinite(s[k]) && Math.abs(s[k])<=90000) && (type!=='doors' || typeof s.id==='string' && ['open','closed','locked','secret'].includes(s.state))));}
function validFogSettings(v){return v==null || record(v) && ['sharedVision','remember','blockMovement'].every(k=>v[k]==null || typeof v[k]==='boolean') && optionalRange(v,'opacity',0,1) && optionalRange(v,'exploredOpacity',0,1) && optionalRange(v,'softness',0,5);}

const sceneKeys=new Set(['terrain','markers','features','wallData','wallRevision','fogMemory','fogMemoryByActor','explored','alignedGrid','gridManual','gridOverlay','gridSquareFt','artworkFit','sceneReady','worldLootVersion','spellZones','showDmArtwork']);
function validState(state) {
  const battle = state?.battle;
  const alignment = state?.alignment;
  return record(state) && validRoom(state?.room) && validRest(battle?.rest) && (battle?.spellRules==null || validRuleSet(battle.spellRules)) && (state.currentMap==null || validMap(state.currentMap)) &&
    (state.world==null || state.currentMap && record(state.world) && state.world.version===1 && record(state.world.maps) && Object.keys(state.world.maps).length<=128 && Object.values(state.world.maps).every(scene=>record(scene) && scene.battle==null && scene.actors==null && (scene.map==null || validMap(scene.map)) && (scene.environment==null || record(scene.environment) && Object.keys(scene.environment).every(key=>sceneKeys.has(key)) && validWalls(scene.environment.wallData)))) && record(battle) && Array.isArray(battle.actors) && battle.actors.length <= 500 &&
    battle.actors.every((actor) => record(actor) && typeof actor.id === "string" && typeof actor.name === "string" &&
      validVision(actor.vision) && [actor.hp,actor.maxHp,actor.ac,actor.speed].every(Number.isFinite) && ["party","hostile","neutral"].includes(actor.side) &&
      (actor.partyId == null || actor.side === "party" && typeof actor.partyId === "string" && /^party-\d+$/.test(actor.partyId) && actor.partyId.length <= 16) &&
      [actor.tempHp,actor.successes,actor.failures].every((value) => value == null || Number.isFinite(value)) &&
      (actor.tokenImage == null || actor.side === "party" && typeof actor.tokenImage === "string" && tokenIdPattern.test(actor.tokenImage)) &&
      (actor.initiativeRoll == null || Number.isFinite(actor.initiativeRoll)) &&
      [actor.x,actor.y].every((value) => value == null || Number.isInteger(value)) &&
      [actor.attacks,actor.spells].every(Array.isArray) && record(actor.slots)) &&
    Array.isArray(battle.order) && battle.order.every((id) => typeof id === "string") &&
    (battle.parties==null || Array.isArray(battle.parties) && battle.parties.length<=4 && battle.parties.every(party=>record(party)&&typeof party.id==='string'&&/^party-\d+$/.test(party.id)&&typeof party.name==='string'&&party.name.length>0&&party.name.length<=40)) &&
    (battle.truceVotes==null || record(battle.truceVotes)&&Object.keys(battle.truceVotes).length<=16&&Object.entries(battle.truceVotes).every(([id,vote])=>battle.actors.some(actor=>actor.id===id&&actor.side==='party')&&vote===true)) &&
    (battle.combatKind==null || ['pvp','encounter'].includes(battle.combatKind)) &&
    (battle.controllers==null || record(battle.controllers)&&Object.keys(battle.controllers).length<=8&&Object.entries(battle.controllers).every(([id,controller])=>battle.actors.some(actor=>actor.id===id&&actor.side==='party')&&typeof controller==='string'&&uuid.test(controller))) &&
    validWalls(battle.wallData) && validFogSettings(battle.fogSettings) &&
    (battle.fogEnabled==null || typeof battle.fogEnabled==='boolean') &&
    (battle.fogMemoryByActor==null || record(battle.fogMemoryByActor) && Object.keys(battle.fogMemoryByActor).length<=500 && Object.entries(battle.fogMemoryByActor).every(([id,m])=>battle.actors.some(a=>a.id===id && a.side==='party') && record(m) && validFogMemory(m))) &&
    (battle.fogMemory == null || validFogMemory(battle.fogMemory)) &&
    (battle.explored == null || Array.isArray(battle.explored) && battle.explored.length <= 4096 &&
      battle.explored.every((key) => typeof key === "string" && /^\d+:\d+$/.test(key))) &&
    Array.isArray(battle.log) && battle.log.every((line) => typeof line === "string") && record(battle.terrain) &&
    Number.isInteger(battle.round) && battle.round >= 0 && Number.isInteger(battle.turn) &&
    (!alignment || alignmentShape(alignment));
}

function validFogMemory(memory) {
  const {cols,rows,data} = memory;
  if (![cols,rows].every((value) => Number.isInteger(value) && value > 0) || cols*rows > 90000 || typeof data !== "string") return false;
  const bytes = Math.ceil(cols*rows/8);
  if (data.length !== Math.ceil(bytes/3)*4 || !/^[\da-z+/]+={0,2}$/i.test(data)) return false;
  try {return atob(data).length === bytes;} catch {return false;}
}

async function boundedBody(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  while (true) {
    const {done,value} = await reader.read();
    if (done) return new Blob(chunks);
    size += value.byteLength;
    if (size > limit) {await reader.cancel(); return null;}
    chunks.push(value);
  }
}

const tokenKey = (session,id) => `tokens/${session}/${id}`;

// Pages can share images through D1 when no R2 bucket is configured.
// Chunking keeps each row below D1's limit and bounds download memory.
function imageStore(env) {
  if(env.BUCKET) return env.BUCKET;
  const db=env.DB,chunkSize=512*1024;
  return {
    async put(key,data,{httpMetadata}) {
      if(await db.prepare('SELECT asset_id FROM session_images WHERE asset_key=?').bind(key).first()) return;
      const blob=new Blob([data]),id=crypto.randomUUID(),count=Math.ceil(blob.size/chunkSize);
      try {
        for(let start=0;start<count;start+=4) {
          const statements=[];
          for(let part=start;part<Math.min(count,start+4);part++) statements.push(db.prepare('INSERT INTO session_image_chunks (asset_id,part,body) VALUES (?,?,?)')
            .bind(id,part,await blob.slice(part*chunkSize,(part+1)*chunkSize).arrayBuffer()));
          await db.batch(statements);
        }
        await db.prepare('INSERT INTO session_images (asset_key,asset_id,content_type,chunk_count) VALUES (?,?,?,?) ON CONFLICT (asset_key) DO NOTHING').bind(key,id,httpMetadata.contentType,count).run();
        const stored=await db.prepare('SELECT asset_id FROM session_images WHERE asset_key=?').bind(key).first();
        if(stored.asset_id!==id) await db.prepare('DELETE FROM session_image_chunks WHERE asset_id=?').bind(id).run();
      } catch(error) {await db.prepare('DELETE FROM session_image_chunks WHERE asset_id=?').bind(id).run();throw error;}
    },
    async get(key) {
      const row=await db.prepare('SELECT asset_id,content_type,chunk_count FROM session_images WHERE asset_key=?').bind(key).first();
      if(!row) return null;
      let part=0;
      const body=new ReadableStream({async pull(controller) {
        try {
          if(part>=row.chunk_count) {controller.close();return;}
          const bytes=await db.prepare('SELECT body FROM session_image_chunks WHERE asset_id=? AND part=?').bind(row.asset_id,part++).first('body');
          if(bytes==null) throw new Error('Shared image chunk missing.');
          controller.enqueue(new Uint8Array(bytes));
        } catch(error) {controller.error(error);}
      }});
      return {body,httpMetadata:{contentType:row.content_type}};
    },
    async delete(key) {
      await db.batch([
        db.prepare('DELETE FROM session_image_chunks WHERE asset_id IN (SELECT asset_id FROM session_images WHERE asset_key=?)').bind(key),
        db.prepare('DELETE FROM session_images WHERE asset_key=?').bind(key),
      ]);
    },
  };
}

async function validToken(blob, id) {
  if (!(blob instanceof Blob) || !imageTypes.has(blob.type) || !blob.size || blob.size > maxTokenBytes) return false;
  const data = new Uint8Array(await blob.arrayBuffer());
  const signature = (offset,length) => String.fromCharCode(...data.subarray(offset,offset+length));
  if (blob.type === "image/webp" && (signature(0,4) !== "RIFF" || signature(8,4) !== "WEBP")) return false;
  if (blob.type === "image/png" && (data[0] !== 137 || signature(1,3) !== "PNG")) return false;
  if (blob.type === "image/jpeg" && (data[0] !== 255 || data[1] !== 216 || data[2] !== 255)) return false;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256",data));
  return id === Array.from(hash,(byte) => byte.toString(16).padStart(2,"0")).join("");
}

async function sessionToken(request, env, session, id) {
  const key = tokenKey(session,id);
  if (request.method === "GET") {
    const image = await imageStore(env).get(key);
    return image ? new Response(image.body,{headers:{...headers,"Content-Type":image.httpMetadata.contentType}}) : fail(404,"No shared token image.");
  }
  if (request.method !== "PUT") return fail(405,"This action is unavailable.");
  if (!await env.DB.prepare("SELECT id FROM game_sessions WHERE id=?").bind(session).first()) {
    return fail(404,"This session could not be found.");
  }
  const body = await boundedBody(request,maxTokenBytes);
  const blob = body?.slice(0,body.size,request.headers.get("Content-Type") ?? "");
  if (!await validToken(blob,id)) return fail(400,"Choose a valid PNG, JPEG, or WebP token image.");
  await imageStore(env).put(key,await blob.arrayBuffer(),{httpMetadata:{contentType:blob.type}});
  return new Response(null,{status:204,headers});
}

async function create(request, env) {
  const multipart = request.headers.get("Content-Type")?.startsWith("multipart/form-data;");
  const body = await boundedBody(request,maxMapBytes + maxStateBytes + (multipart ? maxImageBytes + maxSessionTokenBytes + 65536 : 0));
  if (!body) return fail(413,"The map or artwork is too large to share.");
  let input, artwork, form;
  try {
    if (multipart) {
      form = await new Response(body,{headers:{"Content-Type":request.headers.get("Content-Type")}}).formData();
      input = JSON.parse(form.get("session"));
      artwork = form.get("artwork");
    } else input = JSON.parse(await body.text());
  } catch {return fail(400,"The session could not be read.");}
  if (!validMap(input?.map) || !validState(input?.state)) return fail(400,"The encounter could not be shared.");
  if(input.state.room) input.state.room={...input.state.room,name:input.state.room.name.trim(),createdAt:Date.now(),updatedAt:Date.now()};
  // Public player identifiers are display/control metadata, never deletion credentials.
  if(input.state.room)delete input.state.room.ownerController;
  const map = JSON.stringify(input.map), state = JSON.stringify(input.state);
  if (bytes(map) > maxMapBytes || bytes(state) > maxStateBytes) return fail(413,"The encounter is too large to share.");
  if (artwork && (!(artwork instanceof Blob) || !imageTypes.has(artwork.type) || artwork.size > maxImageBytes || !artwork.size)) {
    return fail(400,"Choose a PNG, JPEG, or WebP map image up to 16 MB.");
  }
  const tokens = new Map();
  let total = 0;
  const referenced = new Set(input.state.battle.actors.map(({tokenImage}) => tokenImage).filter(Boolean));
  for (const hash of referenced) {
    const blob = form?.get("token-"+hash);
    if (!await validToken(blob,hash)) return fail(400,"One of the character token images could not be shared.");
    total += blob.size;
    if (total > maxSessionTokenBytes) return fail(413,"The party’s token images are too large to share together.");
    tokens.set(hash,blob);
  }
  const id = crypto.randomUUID();
  const owner=await newRoomOwner(request);
  const account=await accounts.identity(request,env);
  const uploaded = [];
  try {
    if (artwork) {
      await imageStore(env).put(id,await artwork.arrayBuffer(),{httpMetadata:{contentType:artwork.type}});
      uploaded.push(id);
    }
    for (const [hash,blob] of tokens) {
      const key = tokenKey(id,hash);
      await imageStore(env).put(key,await blob.arrayBuffer(),{httpMetadata:{contentType:blob.type}});
      uploaded.push(key);
    }
    await env.DB.prepare("INSERT INTO game_sessions (id,map,state,artwork_type,owner_key_hash) VALUES (?,?,?,?,?)")
      .bind(id,map,state,artwork?.type ?? null,owner.hash).run();
    if(account)await accounts.addRoom(env,account,id,true);
  } catch (error) {
    await Promise.allSettled(uploaded.map((key) => imageStore(env).delete(key)));
    throw error;
  }
  return Response.json({id,revision:0},{status:201,headers:{...headers,"Set-Cookie":owner.cookie}});
}

async function get(env, id, after) {
  if (after === null) {
    const row = await env.DB.prepare("SELECT map,state,revision,artwork_type FROM game_sessions WHERE id=?").bind(id).first();
    if (!row) return fail(404,"This session could not be found. Check the invitation link.");
    const state=JSON.parse(row.state);return reply({map:state.currentMap ?? JSON.parse(row.map),state,revision:row.revision,hasArtwork:Boolean(row.artwork_type)});
  }
  if (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after))) return fail(400,"The session revision was invalid.");
  const row = await env.DB.prepare("SELECT CASE WHEN revision>? THEN state END AS state,revision FROM game_sessions WHERE id=?").bind(Number(after),id).first();
  if(!row)return fail(404,'This adventure room was deleted or is no longer available.');
  return row.revision>Number(after) ? reply({state:JSON.parse(row.state),revision:row.revision}) : new Response(null,{status:204,headers});
}

async function update(request, env, id) {
  const body = await boundedBody(request,maxStateBytes + 1024);
  if (!body) return fail(413,"The encounter is too large to share.");
  let input;
  try {input = JSON.parse(await body.text());} catch {return fail(400,"The update could not be read.");}
  if (!Number.isSafeInteger(input?.revision) || input.revision < 0 || !validState(input.state)) {
    return fail(400,"The update was invalid.");
  }
  const metadata=await env.DB.prepare("SELECT json_extract(state,'$.room') AS room,json_extract(map,'$.module') AS adventure,json_extract(state,'$.world.version') AS worldVersion,json_extract(state,'$.currentMap.key') AS currentMapKey,json_extract(state,'$.battle.controllers') AS controllers,json_extract(state,'$.battle.round') AS round FROM game_sessions WHERE id=?").bind(id).first();
  const beforeControllers=metadata?.controllers?JSON.parse(metadata.controllers):{},afterControllers=input.state.battle.controllers??{};
  const changedIds=[...new Set([...Object.values(beforeControllers),...Object.values(afterControllers)])].filter(value=>typeof value==='string');
  if(changedIds.length){const protectedIds=await env.DB.prepare('SELECT id FROM account_users WHERE id IN ('+changedIds.map(()=>'?').join(',')+')').bind(...changedIds).all();if(protectedIds.results.length){const account=await accounts.identity(request,env);for(const actorId of new Set([...Object.keys(beforeControllers),...Object.keys(afterControllers)])){if(beforeControllers[actorId]===afterControllers[actorId])continue;if(protectedIds.results.some(row=>(row.id===beforeControllers[actorId]||row.id===afterControllers[actorId])&&row.id!==account?.id))return fail(403,'Only that signed-in player can change their character claim.');}}}
  if(metadata?.worldVersion===1 && input.state.world?.version!==1){const current=await env.DB.prepare('SELECT state,revision FROM game_sessions WHERE id=?').bind(id).first();return reply({state:JSON.parse(current.state),revision:current.revision,message:'Reload this room to use its adventure-wide save.'},409);}
  if(metadata?.round>0 && input.state.currentMap && metadata.currentMapKey && input.state.currentMap.key!==metadata.currentMapKey)return fail(400,'Finish combat before changing maps.');
  if(input.state.currentMap && metadata?.adventure && input.state.currentMap.module!==metadata.adventure)return fail(400,"Choose a map from this room’s adventure.");
  if(metadata?.room) {
    const original=JSON.parse(metadata.room);
    input.state.room={...original,...input.state.room,createdAt:original.createdAt,ownerController:original.ownerController};
  }
  if(input.state.room) input.state.room={...input.state.room,name:input.state.room.name.trim(),updatedAt:Date.now()};
  const state = JSON.stringify(input.state);
  if (bytes(state) > maxStateBytes) return fail(413,"The encounter is too large to share.");
  const result = await env.DB.prepare("UPDATE game_sessions SET state=?, revision=revision+1 WHERE id=? AND revision=?")
    .bind(state,id,input.revision).run();
  if (result.meta.changes) return reply({revision:input.revision + 1});
  const current = await env.DB.prepare("SELECT state,revision FROM game_sessions WHERE id=?").bind(id).first();
  if (!current) return fail(404,"This session could not be found.");
  return reply({state:JSON.parse(current.state),revision:current.revision},409);
}

async function sessionPlayers(request, env, id) {
  if (request.method !== "POST") return fail(405,"This action is unavailable.");
  const raw = await boundedBody(request,512);
  if (!raw) return fail(413,"The username is too long.");
  let input;
  try {input = JSON.parse(await raw.text());} catch {return fail(400,"The player details could not be read.");}
  const account=await accounts.identity(request,env);
  const controller = input?.controller;
  if(account && controller!==account.id)return fail(403,"Reload Wayfarer to use your signed-in profile.");
  if(!account && await env.DB.prepare("SELECT id FROM account_users WHERE id=?").bind(controller??"").first())return fail(403,"Sign in to use this player profile.");
  if (typeof controller !== "string" || !uuid.test(controller)) return fail(400,"The player ID was invalid.");
  const choosingName = input.username !== undefined || Boolean(account);
  const name = typeof input.username === "string" ? input.username.normalize("NFKC").trim() : account?.display_name ?? "";
  if (choosingName && (!name || name.length > 24 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name))) {
    return fail(400,"Enter a username of up to 24 characters.");
  }

  let guestAuthCookie = null;
  if (!account) {
    const existingAuth = await env.DB.prepare("SELECT credential_hash FROM session_player_auth WHERE session_id=? AND controller=?")
      .bind(id, controller).first();
    if (existingAuth) {
      const presented = await playerCredentialHash(request);
      if (!matchesPlayerCredential(existingAuth.credential_hash, presented)) {
        // Probe used to reserve auth without Set-Cookie; reclaim only if this seat never finished joining.
        const seated = await env.DB.prepare("SELECT 1 AS ok FROM session_players WHERE session_id=? AND controller=?")
          .bind(id, controller).first();
        if (seated) {
          return fail(403, "This player seat is already claimed in another browser.");
        }
        const issued = await newPlayerCredential(request);
        guestAuthCookie = issued.cookie;
        await env.DB.prepare("UPDATE session_player_auth SET credential_hash=? WHERE session_id=? AND controller=?")
          .bind(issued.hash, id, controller).run();
      }
    } else if (choosingName) {
      // Issue the seat cookie only when a username is chosen — never on the anonymous probe.
      const issued = await newPlayerCredential(request);
      guestAuthCookie = issued.cookie;
      await env.DB.prepare(`INSERT INTO session_player_auth (session_id,controller,credential_hash)
        SELECT id,?,? FROM game_sessions WHERE id=? ON CONFLICT DO NOTHING`)
        .bind(controller, issued.hash, id).run();
      const claimed = await env.DB.prepare("SELECT credential_hash FROM session_player_auth WHERE session_id=? AND controller=?")
        .bind(id, controller).first();
      if (!claimed || !matchesPlayerCredential(claimed.credential_hash, issued.hash)) {
        return fail(403, "This player seat is already claimed in another browser.");
      }
    }
  }

  const now = Date.now();
  if (choosingName) {
    await env.DB.prepare(`INSERT INTO session_players (session_id,controller,username,username_key,joined_at,last_seen)
      SELECT id,?,?,?,?,? FROM game_sessions WHERE id=? ON CONFLICT DO NOTHING`)
      .bind(controller,name,name.toLowerCase(),now,now,id).run();
  }
  const player = await env.DB.prepare(`UPDATE session_players SET last_seen=MAX(last_seen,?)
    WHERE session_id=? AND controller=? RETURNING username`).bind(now,id,controller).first();
  if (!player) {
    if (!await env.DB.prepare("SELECT id FROM game_sessions WHERE id=?").bind(id).first()) {
      return fail(404,"This session could not be found. Check the invitation link.");
    }
    if (choosingName) {
      // Keep the newly issued cookie so a username retry does not orphan the seat.
      return reply({message:"That username is already taken in this session."}, 409,
        guestAuthCookie ? {"Set-Cookie": guestAuthCookie} : {});
    }
    return reply({player:null,players:[]}, 200, guestAuthCookie ? {"Set-Cookie": guestAuthCookie} : {});
  }
  const {results} = await env.DB.prepare(`SELECT s.controller AS id, s.username, s.last_seen, p.image_id AS photo FROM session_players s
    LEFT JOIN account_photos p ON p.user_id=s.controller
    WHERE s.session_id=? ORDER BY s.joined_at, s.controller`).bind(id).all();
  if(account)await accounts.addRoom(env,account,id);
  const players = results.map(({id,username,last_seen,photo}) => ({id,username,online:now - last_seen < 60000,...(photo?{photo}:{})}));
  return reply({player:player.username,players}, 200, guestAuthCookie ? {"Set-Cookie": guestAuthCookie} : {});
}

async function voiceMembers(env, id, now = Date.now()) {
  const {results} = await env.DB.prepare(`SELECT v.controller AS id, p.username, v.muted, v.deafened, v.last_seen AS lastSeen
    FROM session_voice v LEFT JOIN session_players p ON p.session_id=v.session_id AND p.controller=v.controller
    WHERE v.session_id=? ORDER BY v.joined_at, v.controller`).bind(id).all();
  return results.map(({id,username,muted,deafened,lastSeen}) => ({
    id, username: username || "Player", muted: Boolean(muted), deafened: Boolean(deafened),
    lastSeen, online: now - lastSeen < voiceOnlineMs,
  }));
}

async function sessionVoice(request, env, id, url) {
  if (request.method === "GET") {
    const controller = url.searchParams.get("controller");
    const after = url.searchParams.get("after");
    if (after !== null && (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after)))) {
      return fail(400, "The voice cursor was invalid.");
    }
    const seat = await authorizePlayerSeat(request, env, id, controller);
    if (seat.error) return seat.error;
    if (!await env.DB.prepare("SELECT id FROM game_sessions WHERE id=?").bind(id).first()) {
      return fail(404, "This session could not be found.");
    }
    const members = await voiceMembers(env, id);
    if (after === null) return reply({members, signals: [], after: 0});
    const {results} = await env.DB.prepare(`SELECT sequence AS id, from_controller AS "from", kind, payload, sent_at AS time
      FROM session_voice_signals WHERE session_id=? AND to_controller=? AND sequence>? ORDER BY sequence LIMIT 80`)
      .bind(id, seat.controller, Number(after)).all();
    const signals = results.map(({payload, ...row}) => {
      try {return {...row, payload: JSON.parse(payload)};} catch {return null;}
    }).filter(Boolean);
    return reply({members, signals, after: signals.at(-1)?.id ?? Number(after)});
  }
  if (request.method !== "POST") return fail(405, "This action is unavailable.");
  const raw = await boundedBody(request, 65536);
  if (!raw) return fail(413, "The voice message is too large.");
  let input;
  try {input = JSON.parse(await raw.text());} catch {return fail(400, "The voice message could not be read.");}
  const seat = await authorizePlayerSeat(request, env, id, input?.controller);
  if (seat.error) return seat.error;
  const controller = seat.controller;
  if (!await env.DB.prepare("SELECT id FROM game_sessions WHERE id=?").bind(id).first()) {
    return fail(404, "This session could not be found.");
  }
  const player = await env.DB.prepare("SELECT username FROM session_players WHERE session_id=? AND controller=?")
    .bind(id, controller).first();
  if (!player) return fail(403, "Join the room before using voice.");
  const now = Date.now();
  const action = input.action;
  if (action === "leave") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM session_voice WHERE session_id=? AND controller=?").bind(id, controller),
      env.DB.prepare("DELETE FROM session_voice_signals WHERE session_id=? AND (from_controller=? OR to_controller=?)")
        .bind(id, controller, controller),
    ]);
    return reply({members: await voiceMembers(env, id, now)});
  }
  if (action === "ice") {
    const ice = await turnIceServers(env);
    return reply({...ice, members: await voiceMembers(env, id, now)});
  }
  if (!["join", "state", "heartbeat", "signal"].includes(action)) return fail(400, "Unknown voice action.");
  const muted = input.muted === true ? 1 : 0;
  const deafened = input.deafened === true ? 1 : 0;
  if (action === "join") {
    await env.DB.prepare(`INSERT INTO session_voice (session_id,controller,muted,deafened,joined_at,last_seen)
      VALUES (?,?,?,?,?,?) ON CONFLICT(session_id,controller) DO UPDATE SET muted=excluded.muted, deafened=excluded.deafened, last_seen=excluded.last_seen`)
      .bind(id, controller, muted, deafened, now, now).run();
  } else if (action === "state") {
    const live = await env.DB.prepare(`UPDATE session_voice SET last_seen=?, muted=?, deafened=?
      WHERE session_id=? AND controller=? RETURNING controller`).bind(now, muted, deafened, id, controller).first();
    if (!live) return fail(409, "Join voice before updating it.");
  } else {
    const live = await env.DB.prepare(`UPDATE session_voice SET last_seen=? WHERE session_id=? AND controller=? RETURNING controller`)
      .bind(now, id, controller).first();
    if (!live) return fail(409, "Join voice before updating it.");
  }
  if (action === "signal") {
    const signal = input.signal;
    const kind = signal?.kind;
    const to = signal?.to;
    const signalId = signal?.signalId;
    // ICE end-of-candidates uses a null payload; other kinds require a body.
    const payloadAllowed = kind === "ice" ? signal.payload !== undefined : signal.payload != null;
    if (typeof signalId !== "string" || !uuid.test(signalId) || typeof to !== "string" || !uuid.test(to) ||
        !["offer", "answer", "ice", "bye"].includes(kind) || !payloadAllowed) {
      return fail(400, "The voice signal was invalid.");
    }
    const payload = JSON.stringify(signal.payload);
    if (bytes(payload) > 48000) return fail(413, "The voice signal is too large.");
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO session_voice_signals (session_id,signal_id,from_controller,to_controller,kind,payload,sent_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT (session_id,signal_id) DO NOTHING`)
        .bind(id, signalId, controller, to, kind, payload, now),
      env.DB.prepare(`DELETE FROM session_voice_signals WHERE session_id=? AND sequence <= (
        SELECT sequence FROM session_voice_signals WHERE session_id=? ORDER BY sequence DESC LIMIT 1 OFFSET ?
      )`).bind(id, id, voiceSignalHistory),
      env.DB.prepare("DELETE FROM session_voice_signals WHERE session_id=? AND sent_at < ?").bind(id, now - 60000),
    ]);
  }
  await env.DB.prepare("DELETE FROM session_voice WHERE session_id=? AND last_seen < ?").bind(id, now - 45000).run();
  const members = await voiceMembers(env, id, now);
  if (action === "join") {
    const ice = await turnIceServers(env);
    return reply({members, ...ice});
  }
  return reply({members});
}

async function sessionChat(request, env, id, after) {
  if (request.method === "GET") {
    if (after !== null && (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after)))) {
      return fail(400,"The chat position was invalid.");
    }
    const {results} = await env.DB.prepare(`
      SELECT c.sequence AS id, c.author, c.body, c.sent_at AS time,
        c.profile_id AS profileId, p.image_id AS photo FROM session_chat c
      LEFT JOIN account_photos p ON p.user_id=c.profile_id
      WHERE c.session_id=? AND c.sequence>? ORDER BY c.sequence DESC LIMIT ?
    `).bind(id,Number(after),chatHistory).all();
    if (!results.length && after !== null) return new Response(null,{status:204,headers});
    if (!results.length && !await env.DB.prepare("SELECT id FROM game_sessions WHERE id=?").bind(id).first()) {
      return fail(404,"This session could not be found.");
    }
    return reply({messages:results.reverse().map(({profileId,photo,...message})=>photo?{...message,profileId,photo}:message)});
  }
  if (request.method !== "POST") return fail(405,"This action is unavailable.");
  const raw = await boundedBody(request,8192);
  if (!raw) return fail(413,"The chat message is too large.");
  let input;
  try {input = JSON.parse(await raw.text());} catch {return fail(400,"The chat message could not be read.");}
  const message = typeof input?.body === "string" ? input.body.trim() : "";
  const alias = typeof input?.alias === "string" ? input.alias.trim() : "";
  if (!message || message.length > 500 || typeof input.messageId !== "string" || !uuid.test(input.messageId) ||
      typeof input.sender !== "string" || !uuid.test(input.sender) || alias.length > 40) {
    return fail(400,"Enter a chat message up to 500 characters.");
  }
  const row = await env.DB.prepare("SELECT state FROM game_sessions WHERE id=?").bind(id).first();
  if (!row) return fail(404,"This session could not be found.");
  const account=await accounts.identity(request,env);
  if(account && input.sender!==account.id || !account && await env.DB.prepare("SELECT id FROM account_users WHERE id=?").bind(input.sender).first())return fail(403,"Sign in to send messages as this player.");
  const {battle} = JSON.parse(row.state);
  const character = battle.actors.find((actor) => actor.side === "party" && battle.controllers?.[actor.id] === input.sender);
  const player = await env.DB.prepare("SELECT username FROM session_players WHERE session_id=? AND controller=?")
    .bind(id,input.sender).first();
  const author = character?.name.slice(0,80) || player?.username || alias || "Guest " + input.sender.slice(0,4).toUpperCase();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO session_chat (session_id,message_id,author,body,sent_at,profile_id)
      VALUES (?,?,?,?,?,?) ON CONFLICT (session_id,message_id) DO NOTHING`).bind(id,input.messageId,author,message,Date.now(),character?null:account?.id??null),
    env.DB.prepare(`DELETE FROM session_chat WHERE session_id=? AND sequence <= (
      SELECT sequence FROM session_chat WHERE session_id=? ORDER BY sequence DESC LIMIT 1 OFFSET ?
    )`).bind(id,id,chatHistory),
  ]);
  return new Response(null,{status:204,headers});
}

async function removeRoom(request,env,id){
  const presented=await ownerHash(request);
  const account=await accounts.identity(request,env),linkedOwner=await accounts.roomOwner(env,id);
  if(linkedOwner?linkedOwner.user_id!==account?.id:!presented)return fail(403,'Deletion requires the room creator’s account or private browser credential.');
  const body=await boundedBody(request,2048);
  let input;try{input=body&&JSON.parse(await body.text());}catch{return fail(400,'The deletion request was invalid.');}
  if(!Number.isSafeInteger(input?.revision)||input.revision<0)return fail(400,'The deletion request was invalid.');
  const room=await env.DB.prepare('SELECT revision,owner_key_hash FROM game_sessions WHERE id=?').bind(id).first();
  if(!room)return fail(404,'This room has already been deleted.');
  // No controller ID, public owner value, first-member fallback, or state edit can prove ownership.
  if(!linkedOwner&&!ownsRoom(room.owner_key_hash,presented))return fail(403,'This browser does not hold the private creator credential for this room. Legacy rooms without a credential cannot be deleted.');
  const live='EXISTS (SELECT 1 FROM game_sessions WHERE id=? AND revision=?)';
  const statements=[
    env.DB.prepare(`DELETE FROM account_rooms WHERE room_id=? AND ${live}`).bind(id,id,input.revision),
    env.DB.prepare(`DELETE FROM session_chat WHERE session_id=? AND ${live}`).bind(id,id,input.revision),
    env.DB.prepare(`DELETE FROM session_voice_signals WHERE session_id=? AND ${live}`).bind(id,id,input.revision),
    env.DB.prepare(`DELETE FROM session_voice WHERE session_id=? AND ${live}`).bind(id,id,input.revision),
    env.DB.prepare(`DELETE FROM session_player_auth WHERE session_id=? AND ${live}`).bind(id,id,input.revision),
    env.DB.prepare(`DELETE FROM session_players WHERE session_id=? AND ${live}`).bind(id,id,input.revision),
  ];
  if(!env.BUCKET)statements.push(
    env.DB.prepare(`DELETE FROM session_image_chunks WHERE asset_id IN (SELECT asset_id FROM session_images WHERE asset_key=? OR asset_key LIKE ?) AND ${live}`).bind(id,id+'/%',id,input.revision),
    env.DB.prepare(`DELETE FROM session_images WHERE (asset_key=? OR asset_key LIKE ?) AND ${live}`).bind(id,id+'/%',id,input.revision),
  );
  statements.push(env.DB.prepare('DELETE FROM game_sessions WHERE id=? AND revision=?').bind(id,input.revision));
  const results=await env.DB.batch(statements);
  if(!results.at(-1).meta.changes)return fail(409,'The room changed while you were confirming deletion. Review it and try again.');
  if(env.BUCKET){let cursor;do{const page=await env.BUCKET.list({prefix:id,...(cursor?{cursor}:{})});if(page.objects.length)await env.BUCKET.delete(page.objects.map(o=>o.key));cursor=page.truncated?page.cursor:null;}while(cursor);}
  return new Response(null,{status:204,headers});
}

async function listRooms(request,env,url) {
  const presented=await ownerHash(request);
  if(request.method!=='GET') return fail(405,'This action is unavailable.');
  const account=await accounts.identity(request,env);
  const controller=account?.id??url.searchParams.get('controller');
  if(!account&&await env.DB.prepare("SELECT id FROM account_users WHERE id=?").bind(controller??"").first())return fail(403,"Sign in to view your account’s rooms.");
  if(!controller || !uuid.test(controller)) return fail(400,'The player ID was invalid.');
  const {results}=await env.DB.prepare(`SELECT s.id,
    json_extract(s.state,'$.room') AS room,
    COALESCE(json_extract(s.state,'$.currentMap.title'),json_extract(s.map,'$.title')) AS mapName,
    COALESCE(json_extract(s.state,'$.currentMap.key'),json_extract(s.map,'$.key')) AS mapKey,
    json_extract(s.map,'$.module') AS adventure,
    json_extract(s.state,'$.battle.round') AS round,
    (SELECT json_group_array(json_extract(value,'$.name')) FROM json_each(s.state,'$.battle.actors')
      WHERE json_extract(value,'$.side')='party') AS party,
    s.owner_key_hash AS ownerKeyHash,
    (SELECT user_id FROM account_rooms WHERE room_id=s.id AND role='owner') AS accountOwner,
    p.joined_at AS joinedAt,p.last_seen AS lastVisited
    FROM game_sessions s LEFT JOIN session_players p ON p.session_id=s.id AND p.controller=?
    WHERE p.controller=? OR EXISTS(SELECT 1 FROM account_rooms ar WHERE ar.room_id=s.id AND ar.user_id=?) ORDER BY COALESCE(json_extract(s.state,'$.room.updatedAt'),p.last_seen) DESC LIMIT 100`)
    .bind(controller,controller,account?.id??'').all();
  return reply({rooms:results.map(row=>{
    const room=row.room ? JSON.parse(row.room) : {};
    return {id:row.id,canDelete:row.accountOwner?row.accountOwner===account?.id:ownsRoom(row.ownerKeyHash,presented),name:room.name || row.mapName,adventure:room.adventure || row.adventure,
      adventureName:room.adventureName || row.adventure,mapName:row.mapName,mapKey:row.mapKey,
      party:JSON.parse(row.party || '[]'),round:row.round,createdAt:room.createdAt || row.joinedAt,
      updatedAt:room.updatedAt || row.lastVisited,lastVisited:row.lastVisited};
  })});
}

export async function sessionRequest(request, env) {
  const url = new URL(request.url);
  if(url.pathname.startsWith("/api/auth/")||url.pathname.startsWith("/api/account"))return accounts.route(request,env,{ownerHash,ownsRoom,validToken,boundedBody});
  const match = sessionPath.exec(url.pathname);
  if (url.pathname !== api && url.pathname !== "/api/rooms" && url.pathname !== "/api/ai/forecast" && !match) return fail(404,"Session endpoint not found.");
  if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) return fail(403,"Open Wayfarer to update this session.");
  try {
    if(url.pathname==="/api/rooms") return await listRooms(request,env,url);
    if(url.pathname==="/api/ai/forecast") {
      if (request.method !== 'POST') return fail(405, 'This action is unavailable.');
      const apiKey = request.headers.get('x-gemini-key')?.trim();
      if (!apiKey) return fail(400, 'A Gemini API key is required.');
      const model = request.headers.get('x-gemini-model') || 'gemini-3.8-flash';
      const targetUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
      const body = await request.text();
      const geminiRes = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key':apiKey },
        body
      });
      const data = await geminiRes.text();
      return new Response(data, {
        status: geminiRes.status,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...(geminiRes.headers.get('Retry-After')?{'Retry-After':geminiRes.headers.get('Retry-After')}:{})
        }
      });
    }
    if (!match && request.method === "POST") {
      return await create(request,env);
    }
    // The unlisted, randomly generated session ID is the guest's invitation and access credential.
    if (match?.[3]) return await sessionToken(request,env,match[1],match[3]);
    if (match?.[2] === "/players") return await sessionPlayers(request,env,match[1]);
    if (match?.[2] === "/voice") return await sessionVoice(request,env,match[1],url);
    if (match?.[2] === "/chat") return await sessionChat(request,env,match[1],url.searchParams.get("after"));
    if (match?.[2] && request.method === "GET") {
      const id = match[1];
      const row = await env.DB.prepare("SELECT artwork_type FROM game_sessions WHERE id=?").bind(id).first();
      const artwork = row?.artwork_type && await imageStore(env).get(id);
      return artwork ? new Response(artwork.body,{headers:{...headers,"Content-Type":row.artwork_type}}) : fail(404,"No shared map artwork.");
    }
    if (match && !match[2] && request.method === "GET") return await get(env,match[1],url.searchParams.get("after"));
    if (match && !match[2] && request.method === "DELETE") return await removeRoom(request,env,match[1]);
    if (match && !match[2] && request.method === "PUT") return await update(request,env,match[1]);
    return fail(405,"This action is unavailable.");
  } catch (error) {
    console.error("Wayfarer multiplayer request failed",error);
    return fail(503,"The shared session could not be reached. Try again shortly.");
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return sessionRequest(request, env);
    return env.ASSETS.fetch(request);
  },
};
