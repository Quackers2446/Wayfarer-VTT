const api = "/api/sessions";
const sessionPath = /^\/api\/sessions\/([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})(\/artwork|\/tokens\/([\da-f]{64}))?$/;
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

function validState(state) {
  const battle = state?.battle;
  const alignment = state?.alignment;
  return record(battle) && Array.isArray(battle.actors) && battle.actors.length <= 500 &&
    battle.actors.every((actor) => record(actor) && typeof actor.id === "string" && typeof actor.name === "string" &&
      [actor.hp,actor.maxHp,actor.ac,actor.speed].every(Number.isFinite) && ["party","hostile","neutral"].includes(actor.side) &&
      [actor.tempHp,actor.successes,actor.failures].every((value) => value == null || Number.isFinite(value)) &&
      (actor.tokenImage == null || actor.side === "party" && typeof actor.tokenImage === "string" && tokenIdPattern.test(actor.tokenImage)) &&
      (actor.initiativeRoll == null || Number.isFinite(actor.initiativeRoll)) &&
      [actor.x,actor.y].every((value) => value == null || Number.isInteger(value)) &&
      [actor.attacks,actor.spells].every(Array.isArray) && record(actor.slots)) &&
    Array.isArray(battle.order) && battle.order.every((id) => typeof id === "string") &&
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
    const image = await env.BUCKET.get(key);
    return image ? new Response(image.body,{headers:{...headers,"Content-Type":image.httpMetadata.contentType}}) : fail(404,"No shared token image.");
  }
  if (request.method !== "PUT") return fail(405,"This action is unavailable.");
  if (!await env.DB.prepare("SELECT id FROM game_sessions WHERE id=?").bind(session).first()) {
    return fail(404,"This session could not be found.");
  }
  const body = await boundedBody(request,maxTokenBytes);
  const blob = body?.slice(0,body.size,request.headers.get("Content-Type") ?? "");
  if (!await validToken(blob,id)) return fail(400,"Choose a valid PNG, JPEG, or WebP token image.");
  await env.BUCKET.put(key,blob.stream(),{httpMetadata:{contentType:blob.type}});
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
      await env.BUCKET.put(id,artwork.stream(),{httpMetadata:{contentType:artwork.type}});
      uploaded.push(id);
    }
    for (const [hash,blob] of tokens) {
      const key = tokenKey(id,hash);
      await env.BUCKET.put(key,blob.stream(),{httpMetadata:{contentType:blob.type}});
      uploaded.push(key);
    }
    await env.DB.prepare("INSERT INTO game_sessions (id,map,state,artwork_type) VALUES (?,?,?,?)")
      .bind(id,map,state,artwork?.type ?? null).run();
  } catch (error) {
    await Promise.allSettled(uploaded.map((key) => env.BUCKET.delete(key)));
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
  const row = await env.DB.prepare("SELECT state,revision FROM game_sessions WHERE id=? AND revision>?").bind(id,Number(after)).first();
  return row ? reply({state:JSON.parse(row.state),revision:row.revision}) : new Response(null,{status:204,headers});
}

async function update(request, env, id) {
  const body = await boundedBody(request,maxStateBytes + 1024);
  if (!body) return fail(413,"The encounter is too large to share.");
  let input;
  try {input = JSON.parse(await body.text());} catch {return fail(400,"The update could not be read.");}
  if (!Number.isSafeInteger(input?.revision) || input.revision < 0 || !validState(input.state)) {
    return fail(400,"The update was invalid.");
  }
  const state = JSON.stringify(input.state);
  if (bytes(state) > maxStateBytes) return fail(413,"The encounter is too large to share.");
  const result = await env.DB.prepare("UPDATE game_sessions SET state=?, revision=revision+1 WHERE id=? AND revision=?")
    .bind(state,id,input.revision).run();
  if (result.meta.changes) return reply({revision:input.revision + 1});
  const current = await env.DB.prepare("SELECT state,revision FROM game_sessions WHERE id=?").bind(id).first();
  if (!current) return fail(404,"This session could not be found.");
  return reply({state:JSON.parse(current.state),revision:current.revision},409);
}

export async function sessionRequest(request, env) {
  const url = new URL(request.url);
  const match = sessionPath.exec(url.pathname);
  if (url.pathname !== api && !match) return fail(404,"Session endpoint not found.");
  if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) return fail(403,"Open Wayfarer to update this session.");
  try {
    if (!match && request.method === "POST") {
      if (!request.headers.get("oai-authenticated-user-id")) return fail(401,"Sign in to start a shared session.");
      return await create(request,env);
    }
    // The unlisted, randomly generated session ID is the guest's invitation and access credential.
    if (match?.[3]) return await sessionToken(request,env,match[1],match[3]);
    if (match?.[2] && request.method === "GET") {
      const id = match[1];
      const row = await env.DB.prepare("SELECT artwork_type FROM game_sessions WHERE id=?").bind(id).first();
      const artwork = row?.artwork_type && await env.BUCKET.get(id);
      return artwork ? new Response(artwork.body,{headers:{...headers,"Content-Type":row.artwork_type}}) : fail(404,"No shared map artwork.");
    }
    if (match && !match[2] && request.method === "GET") return await get(env,match[1],url.searchParams.get("after"));
    if (match && !match[2] && request.method === "PUT") return await update(request,env,match[1]);
    return fail(405,"This action is unavailable.");
  } catch (error) {
    console.error("Wayfarer multiplayer request failed",error);
    return fail(503,"The shared session could not be reached. Try again shortly.");
  }
}

export default {
  async fetch(request,env) {
    const {pathname} = new URL(request.url);
    if (pathname.startsWith("/api/")) return sessionRequest(request,env);
    const asset = new URL(pathname === "/" ? "/index.html" : pathname,request.url);
    return env.ASSETS.fetch(new Request(asset,request));
  },
};
