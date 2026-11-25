import {roomRoster} from "./encounters.mjs";
import {bestiaryTokenPath, hostedMapImage, mapImage, monsterFluff, monsterRecord, ruleKey} from "./rules-library.mjs";

const cache = new Map();
const queue = [];
let running = 0;
const parallelism = 5;
const cacheLimit = 128;
const retryDelay = 45000;

function cleanArtworkPath(value) {
  const path = typeof value === "string" ? value : value?.path ?? value?.url;
  if (!path) return null;
  if (!/^[a-z][a-z\d+.-]*:/i.test(path)) {
    return path.replace(/^\/?img\//,"");
  }
  try {
    const url = new URL(path);
    if (url.protocol !== "https:") return null;
    let match;
    if (["5e.tools","2014.5e.tools","cdn.5e.tools"].includes(url.hostname)) {
      match = url.pathname.match(/^\/(?:\d{4}\/)?img\/(.+)$/);
    } else if (url.hostname === "raw.githubusercontent.com") {
      match = url.pathname.match(/^\/5etools-mirror-[23]\/5etools(?:-2014)?-img\/[^/]+\/(.+)$/);
    }
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

const creatureName = (actor) => actor.statName ?? actor.name.replace(/\s+\d+$/, "");

export function monsterArtKey(actor, map) {
  if (actor.statName && actor.source) return actor.source.toLowerCase()+"|"+ruleKey(actor.statName);
  if (actor.tokenArt) return "asset|"+actor.tokenArt;
  if (actor.id.startsWith("party:") || map.module === "training") return "";
  return map.module+"|"+(actor.origin ?? "")+"|"+ruleKey(creatureName(actor));
}

async function identify(actor, map) {
  if (actor.statName && actor.source) {
    return await monsterRecord(actor.statName,actor.source) ?? {name:actor.statName,source:actor.source};
  }
  const name = creatureName(actor);
  const normalized = ruleKey(name);
  const room = map.regions.find((region) => (region.key ?? region.id) === actor.origin);
  const reference = room && roomRoster(map,room).find((entry) =>
    [entry.nickname,entry.name].filter(Boolean).some((value) => ruleKey(value) === normalized));
  if (reference) {
    const record = await monsterRecord(reference.name,reference.source);
    if (record) return record;
  }
  const sources = [...new Set([actor.source,map.module,"MM","XMM"].filter(Boolean))];
  const records = await Promise.all(sources.map((source) => monsterRecord(name,source)));
  return records.find(Boolean) ?? {name,source:sources[0] ?? "MM"};
}

async function *illustrations(name, source, visited = new Set()) {
  const key = source+"|"+name;
  if (visited.size>=6 || visited.has(key)) return;
  visited.add(key);
  const fluff = await monsterFluff(name,source);
  for (const illustration of fluff?.images ?? []) {
    const path = cleanArtworkPath(illustration.href);
    if (path) yield {path,type:"illustration"};
  }
  if (fluff?._copy?.name && fluff._copy.source) {
    yield *illustrations(fluff._copy.name,fluff._copy.source,visited);
  }
}

async function *recordArtwork(record, visited = new Set()) {
  const key = record.source+"|"+record.name;
  if (visited.size>=8 || visited.has(key)) return;
  visited.add(key);
  const primary = cleanArtworkPath(record.tokenHref ?? record.tokenUrl);
  if (primary) yield {path:primary,type:"token"};
  if (record.token?.name && record.token.source) yield {path:bestiaryTokenPath(record.token),type:"token"};
  if (record.hasToken) yield {path:bestiaryTokenPath(record),type:"token"};
  yield *illustrations(record.name,record.source);

  if (record._copy?.name && record._copy.source) {
    const parent = await monsterRecord(record._copy.name,record._copy.source);
    if (parent) yield *recordArtwork(parent,visited);
  }
  if (!record.hasToken) yield {path:bestiaryTokenPath(record),type:"token"};
}

export async function *monsterArtworkSources(actor,map) {
  const known = cleanArtworkPath(actor.tokenArt);
  if (known) yield {path:known,type:"token"};
  if (!actor.statName && !actor.source && map.module==="training") return;
  const record = await identify(actor,map);
  if (record) yield *recordArtwork(record);
}

async function decodeArtwork(blob) {
  const url=URL.createObjectURL(blob);
  try {
    const image=new Image();
    image.src=url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function resolveArtwork(actor,map) {
  const seen = new Set();
  for await (const candidate of monsterArtworkSources(actor,map)) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    const local = await mapImage(candidate.path).catch(() => null);
    if (local) {
      const image = await decodeArtwork(local).catch(() => null);
      if (image) return {...candidate,image};
    }
    const remote = await hostedMapImage(candidate.path,AbortSignal.timeout(9500));
    if (remote) {
      const image = await decodeArtwork(remote).catch(() => null);
      if (image) return {...candidate,image};
    }
  }
  return null;
}

function drain() {
  while (running<parallelism && queue.length) {
    const job = queue.shift();
    running += 1;
    resolveArtwork(job.actor,job.map).catch(() => null).then((artwork) => {
      cache.set(job.key,{artwork,retryAt:artwork ? Infinity : Date.now()+retryDelay});
      if (cache.size>cacheLimit) {
        const old = [...cache].find(([key,value]) => key!==job.key && !value.pending);
        if (old) cache.delete(old[0]);
      }
      if (artwork) job.onReady();
    }).finally(() => {
      running -= 1;
      drain();
    });
  }
}

export function monsterArtwork(actor,map,onReady) {
  const key = monsterArtKey(actor,map);
  if (!key) return null;
  const entry=cache.get(key);
  if (entry?.pending) return null;
  if (entry?.artwork) {
    cache.delete(key);
    cache.set(key,entry);
    return entry.artwork;
  }
  if (entry?.retryAt>Date.now()) return null;
  cache.set(key,{pending:true});
  queue.push({key,actor,map,onReady});
  drain();
  return null;
}

export function drawMonsterArtwork(context, artwork, centerX,centerY,size,{contain=false}={}) {
  const {image,type}=artwork;
  const bound=!contain && type==="illustration" ? Math.min(image.naturalWidth,image.naturalHeight) :
    Math.max(image.naturalWidth,image.naturalHeight);
  const ratio=size/bound;
  const width=image.naturalWidth*ratio, height=image.naturalHeight*ratio;
  context.drawImage(image,centerX-width/2,centerY-height/2,width,height);
}
