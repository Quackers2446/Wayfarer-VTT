const api = "/api/sessions";
const sessionPath = /^\/api\/sessions\/([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})(\/artwork)?$/;
const maxMapBytes = 512 * 1024;
const maxStateBytes = 768 * 1024;
const maxImageBytes = 16 * 1024 * 1024;
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
      (actor.initiativeRoll == null || Number.isFinite(actor.initiativeRoll)) &&
      [actor.x,actor.y].every((value) => value == null || Number.isInteger(value)) &&
      [actor.attacks,actor.spells].every(Array.isArray) && record(actor.slots)) &&
    Array.isArray(battle.order) && battle.order.every((id) => typeof id === "string") &&
    Array.isArray(battle.log) && battle.log.every((line) => typeof line === "string") && record(battle.terrain) &&
    Number.isInteger(battle.round) && battle.round >= 0 && Number.isInteger(battle.turn) &&
    (!alignment || alignmentShape(alignment));
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

async function create(request, env) {
  const multipart = request.headers.get("Content-Type")?.startsWith("multipart/form-data;");
  const body = await boundedBody(request,maxMapBytes + maxStateBytes + (multipart ? maxImageBytes + 4096 : 0));
  if (!body) return fail(413,"The map or artwork is too large to share.");
  let input, artwork;
  try {
    if (multipart) {
      const form = await new Response(body,{headers:{"Content-Type":request.headers.get("Content-Type")}}).formData();
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
  const id = crypto.randomUUID();
  if (artwork) await env.BUCKET.put(id,artwork.stream(),{httpMetadata:{contentType:artwork.type}});
  try {
    await env.DB.prepare("INSERT INTO game_sessions (id,map,state,artwork_type) VALUES (?,?,?,?)")
      .bind(id,map,state,artwork?.type ?? null).run();
  } catch (error) {
    if (artwork) await env.BUCKET.delete(id).catch(() => {});
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
