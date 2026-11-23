const api = "/api/sessions";
const sessionId = "[\\da-f]{8}-(?:[\\da-f]{4}-){3}[\\da-f]{12}";
const sessionPath = new RegExp(`^/api/sessions/(${sessionId})(/artwork|/chat|/players|/tokens/([\\da-f]{64}))?$`);
const uuid = new RegExp(`^${sessionId}$`);
const chatHistory = 200;
const tokenIdPattern = /^[\da-f]{64}$/;
const maxMapBytes = 512 * 1024;
const maxStateBytes = 768 * 1024;
const maxImageBytes = 16 * 1024 * 1024;
const maxTokenBytes = 1280 * 1024;
const maxSessionTokenBytes = 12 * 1024 * 1024;
const imageTypes = new Set(["image/png","image/jpeg","image/webp"]);
const headers = {"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const bytes = (text) => new TextEncoder().encode(text).byteLength;

function reply(value, status = 200) {
  return Response.json(value,{status,headers});
}

const fail = (status,message) => reply({message},status);
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
function validVision(v){return v==null || record(v) && (v.enabled==null || typeof v.enabled==='boolean') && optionalRange(v,'range',0,300) && optionalRange(v,'angle',1,360) && optionalRange(v,'facing',0,360);}
function validWalls(v){return v==null || record(v) && ['walls','doors'].every(type=>v[type]==null || Array.isArray(v[type]) && v[type].length<=2000 && v[type].every(s=>record(s) && ['x1','y1','x2','y2'].every(k=>Number.isFinite(s[k]) && Math.abs(s[k])<=90000) && (type!=='doors' || typeof s.id==='string' && ['open','closed','locked','secret'].includes(s.state))));}
function validFogSettings(v){return v==null || record(v) && ['sharedVision','remember','blockMovement'].every(k=>v[k]==null || typeof v[k]==='boolean') && optionalRange(v,'opacity',0,1) && optionalRange(v,'exploredOpacity',0,1) && optionalRange(v,'softness',0,5);}

function validState(state) {
  const battle = state?.battle;
  const alignment = state?.alignment;
  return validRoom(state?.room) && record(battle) && Array.isArray(battle.actors) && battle.actors.length <= 500 &&
    battle.actors.every((actor) => record(actor) && typeof actor.id === "string" && typeof actor.name === "string" &&
      validVision(actor.vision) && [actor.hp,actor.maxHp,actor.ac,actor.speed].every(Number.isFinite) && ["party","hostile","neutral"].includes(actor.side) &&
      [actor.tempHp,actor.successes,actor.failures].every((value) => value == null || Number.isFinite(value)) &&
      (actor.tokenImage == null || actor.side === "party" && typeof actor.tokenImage === "string" && tokenIdPattern.test(actor.tokenImage)) &&
      (actor.initiativeRoll == null || Number.isFinite(actor.initiativeRoll)) &&
      [actor.x,actor.y].every((value) => value == null || Number.isInteger(value)) &&
      [actor.attacks,actor.spells].every(Array.isArray) && record(actor.slots)) &&
    Array.isArray(battle.order) && battle.order.every((id) => typeof id === "string") &&
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
  if(input.controller && uuid.test(input.controller) && input.state.room)input.state.room.ownerController=input.controller;
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
    await env.DB.prepare("INSERT INTO game_sessions (id,map,state,artwork_type) VALUES (?,?,?,?)")
      .bind(id,map,state,artwork?.type ?? null).run();
  } catch (error) {
    await Promise.allSettled(uploaded.map((key) => imageStore(env).delete(key)));
    throw error;
  }
  return reply({id,revision:0},201);
}

async function get(env, id, after) {
  if (after === null) {
    const row = await env.DB.prepare("SELECT map,state,revision,artwork_type FROM game_sessions WHERE id=?").bind(id).first();
    if (!row) return fail(404,"This session could not be found. Check the invitation link.");
    return reply({map:JSON.parse(row.map),state:JSON.parse(row.state),revision:row.revision,hasArtwork:Boolean(row.artwork_type)});
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
  const metadata=await env.DB.prepare("SELECT json_extract(state,'$.room') AS room FROM game_sessions WHERE id=?").bind(id).first();
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
  const controller = input?.controller;
  if (typeof controller !== "string" || !uuid.test(controller)) return fail(400,"The player ID was invalid.");
  const choosingName = input.username !== undefined;
  const name = typeof input.username === "string" ? input.username.normalize("NFKC").trim() : "";
  if (choosingName && (!name || name.length > 24 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name))) {
    return fail(400,"Enter a username of up to 24 characters.");
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
    if (choosingName) return fail(409,"That username is already taken in this session.");
    return reply({player:null,players:[]});
  }
  const {results} = await env.DB.prepare(`SELECT controller AS id, username, last_seen FROM session_players
    WHERE session_id=? ORDER BY joined_at, controller`).bind(id).all();
  const players = results.map(({id,username,last_seen}) => ({id,username,online:now - last_seen < 60000}));
  return reply({player:player.username,players});
}

async function sessionChat(request, env, id, after) {
  if (request.method === "GET") {
    if (after !== null && (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after)))) {
      return fail(400,"The chat position was invalid.");
    }
    const {results} = await env.DB.prepare(`
      SELECT sequence AS id, author, body, sent_at AS time FROM session_chat
      WHERE session_id=? AND sequence>? ORDER BY sequence DESC LIMIT ?
    `).bind(id,Number(after),chatHistory).all();
    if (!results.length && after !== null) return new Response(null,{status:204,headers});
    if (!results.length && !await env.DB.prepare("SELECT id FROM game_sessions WHERE id=?").bind(id).first()) {
      return fail(404,"This session could not be found.");
    }
    return reply({messages:results.reverse()});
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
  const {battle} = JSON.parse(row.state);
  const character = battle.actors.find((actor) => actor.side === "party" && battle.controllers?.[actor.id] === input.sender);
  const player = await env.DB.prepare("SELECT username FROM session_players WHERE session_id=? AND controller=?")
    .bind(id,input.sender).first();
  const author = character?.name.slice(0,80) || player?.username || alias || "Guest " + input.sender.slice(0,4).toUpperCase();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO session_chat (session_id,message_id,author,body,sent_at)
      VALUES (?,?,?,?,?) ON CONFLICT (session_id,message_id) DO NOTHING`).bind(id,input.messageId,author,message,Date.now()),
    env.DB.prepare(`DELETE FROM session_chat WHERE session_id=? AND sequence <= (
      SELECT sequence FROM session_chat WHERE session_id=? ORDER BY sequence DESC LIMIT 1 OFFSET ?
    )`).bind(id,id,chatHistory),
  ]);
  return new Response(null,{status:204,headers});
}

async function removeRoom(request,env,id){
  let input;try{input=await request.json();}catch{return fail(400,'The deletion request was invalid.');}
  if(!uuid.test(input?.controller??'') || !Number.isSafeInteger(input?.revision))return fail(400,'The deletion request was invalid.');
  const room=await env.DB.prepare(`SELECT revision,COALESCE(json_extract(state,'$.room.ownerController'),(SELECT controller FROM session_players WHERE session_id=? ORDER BY joined_at,rowid LIMIT 1)) AS ownerController FROM game_sessions WHERE id=?`).bind(id,id).first();
  if(!room)return fail(404,'This room has already been deleted.');
  if(room.ownerController!==input.controller)return fail(403,'Only the room creator can delete this adventure.');
  const live='EXISTS (SELECT 1 FROM game_sessions WHERE id=? AND revision=?)';
  const statements=[
    env.DB.prepare(`DELETE FROM session_chat WHERE session_id=? AND ${live}`).bind(id,id,input.revision),
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
  if(request.method!=='GET') return fail(405,'This action is unavailable.');
  const controller=url.searchParams.get('controller');
  if(!controller || !uuid.test(controller)) return fail(400,'The player ID was invalid.');
  const {results}=await env.DB.prepare(`SELECT s.id,
    json_extract(s.state,'$.room') AS room,
    json_extract(s.map,'$.title') AS mapName,
    json_extract(s.map,'$.key') AS mapKey,
    json_extract(s.map,'$.module') AS adventure,
    json_extract(s.state,'$.battle.round') AS round,
    (SELECT json_group_array(json_extract(value,'$.name')) FROM json_each(s.state,'$.battle.actors')
      WHERE json_extract(value,'$.side')='party') AS party,
    COALESCE(json_extract(s.state,'$.room.ownerController'),(SELECT controller FROM session_players WHERE session_id=s.id ORDER BY joined_at,rowid LIMIT 1)) AS ownerController,
    p.joined_at AS joinedAt,p.last_seen AS lastVisited
    FROM game_sessions s JOIN session_players p ON p.session_id=s.id
    WHERE p.controller=? ORDER BY COALESCE(json_extract(s.state,'$.room.updatedAt'),p.last_seen) DESC LIMIT 100`)
    .bind(controller).all();
  return reply({rooms:results.map(row=>{
    const room=row.room ? JSON.parse(row.room) : {};
    return {id:row.id,canDelete:row.ownerController===controller,name:room.name || row.mapName,adventure:room.adventure || row.adventure,
      adventureName:room.adventureName || row.adventure,mapName:row.mapName,mapKey:row.mapKey,
      party:JSON.parse(row.party || '[]'),round:row.round,createdAt:room.createdAt || row.joinedAt,
      updatedAt:room.updatedAt || row.lastVisited,lastVisited:row.lastVisited};
  })});
}

export async function sessionRequest(request, env) {
  const url = new URL(request.url);
  const match = sessionPath.exec(url.pathname);
  if (url.pathname !== api && url.pathname !== "/api/rooms" && !match) return fail(404,"Session endpoint not found.");
  if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) return fail(403,"Open Wayfarer to update this session.");
  try {
    if(url.pathname==="/api/rooms") return await listRooms(request,env,url);
    if (!match && request.method === "POST") {
      return await create(request,env);
    }
    // The unlisted, randomly generated session ID is the guest's invitation and access credential.
    if (match?.[3]) return await sessionToken(request,env,match[1],match[3]);
    if (match?.[2] === "/players") return await sessionPlayers(request,env,match[1]);
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
