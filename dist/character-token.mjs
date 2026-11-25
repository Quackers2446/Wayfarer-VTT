import {escape} from "./format.mjs";

const imageTypes = new Set(["image/png","image/jpeg","image/webp"]);
const tokenSize = 512;
const maxFileSize = 16*1024*1024;
const tokenIdPattern = /^[a-f\d]{64}$/;
const sessionIdPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/;
const portraits = new Map();

function database() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open("wayfarer-character-tokens-v1",1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storedImage(id, blob) {
  const db = await database();
  return new Promise((resolve,reject) => {
    const tx = db.transaction("images",blob ? "readwrite" : "readonly");
    const images = tx.objectStore("images");
    const request = blob ? images.put(blob,id) : images.get(id);
    tx.oncomplete = () => {db.close(); resolve(request.result);};
    tx.onabort = tx.onerror = () => {db.close(); reject(tx.error);};
  });
}

export async function decodeImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {URL.revokeObjectURL(url);}
}

export async function prepareTokenImage(file, maxEdge = tokenSize) {
  if (!imageTypes.has(file.type) || file.size > maxFileSize) {
    throw new Error("Choose a PNG, JPEG, or WebP image up to 16 MB.");
  }
  const image = await decodeImage(file).catch(() => null);
  if (!image?.naturalWidth || !image.naturalHeight) throw new Error("This image could not be opened.");
  const edge = Math.min(image.naturalWidth,image.naturalHeight);
  const size = Math.min(maxEdge,edge);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image,(image.naturalWidth-edge)/2,(image.naturalHeight-edge)/2,edge,edge,0,0,size,size);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve,"image/webp",.92));
  if (!blob) throw new Error("This image could not be converted into a token.");
  const digest = await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
  const id = Array.from(new Uint8Array(digest),(byte) => byte.toString(16).padStart(2,"0")).join("");
  return {id, blob};
}

export async function saveTokenImage(file) {
  const {id, blob} = await prepareTokenImage(file);
  await storedImage(id,blob);
  return id;
}

const tokenURL = (session,id) => `/api/sessions/${session}/tokens/${id}`;

async function removeImage(id) {
  const db = await database();
  return new Promise((resolve,reject) => {
    const tx = db.transaction("images","readwrite");
    tx.objectStore("images").delete(id);
    tx.oncomplete = () => {db.close(); resolve();};
    tx.onabort = tx.onerror = () => {db.close(); reject(tx.error);};
  });
}

async function matchesId(id, blob) {
  if (!(blob instanceof Blob) || !blob.size) return false;
  const digest = await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest),(byte) => byte.toString(16).padStart(2,"0")).join("") === id;
}

// A stored image is only trusted when its bytes still hash to its id; damaged copies are discarded.
async function verifiedImage(id) {
  const blob = await storedImage(id).catch(() => null);
  if (!blob) return null;
  if (await matchesId(id,blob)) return blob;
  await removeImage(id).catch(() => null);
  return null;
}

async function accountTokenImage(id, signal) {
  const response = await fetch("/api/account/tokens/"+id,{signal});
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!imageTypes.has(blob.type) || !await matchesId(id,blob)) return null;
  await storedImage(id,blob).catch(() => null);
  return blob;
}

export async function localTokenBlob(id) {
  const blob = await verifiedImage(id) ?? await accountTokenImage(id).catch(() => null);
  if (!blob) throw new Error("Choose the character’s token image again to share it.");
  return blob;
}

export async function uploadSessionToken(session,id) {
  const blob = await localTokenBlob(id);
  const response = await fetch(tokenURL(session,id),{method:"PUT",body:blob,signal:AbortSignal.timeout(12000)});
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? "The token could not be shared. Try again.");
  }
}

function portraitEntry(id, session) {
  if (typeof id !== "string" || !tokenIdPattern.test(id) || (session && !sessionIdPattern.test(session))) return null;
  const key = `${session ?? ""}/${id}`;
  let entry = portraits.get(key);
  if (entry) return entry;
  if (portraits.size >= 128) portraits.delete(portraits.keys().next().value);
  entry = {waiting:new Set()};
  portraits.set(key,entry);
  entry.promise = (async () => {
    let blob = await verifiedImage(id);
    if (!blob && session) {
      const response = await fetch(tokenURL(session,id),{signal:AbortSignal.timeout(12000)});
      if (response.ok) blob = await response.blob();
    }
    if (!blob) blob = await accountTokenImage(id,AbortSignal.timeout(12000));
    if (blob) entry.artwork = {image:await decodeImage(blob),path:id,type:"character"};
    return entry.artwork;
  })().catch(() => undefined).then((artwork) => {
    entry.done = true;
    if (artwork) for (const callback of entry.waiting) callback();
    entry.waiting.clear();
    if (!artwork) setTimeout(() => {if (portraits.get(key) === entry) portraits.delete(key);},15000);
    return artwork;
  });
  return entry;
}

export function characterTokenArtwork(id, session, onReady) {
  const entry = portraitEntry(id,session);
  if (entry && !entry.done) entry.waiting.add(onReady);
  return entry?.artwork;
}

export function tokenPortrait(initials, id, session) {
  return `<span data-token-initial>${escape(initials)}</span>${id && tokenIdPattern.test(id) ?
    `<canvas class="character-token-portrait" data-character-token="${id}"${session && sessionIdPattern.test(session) ?
      ` data-token-session="${session}"` : ""} hidden></canvas>` : ""}`;
}

export function paintCharacterPortraits(scope) {
  for (const canvas of scope.querySelectorAll("canvas[data-character-token]")) {
    const {characterToken,tokenSession} = canvas.dataset;
    portraitEntry(characterToken,tokenSession)?.promise.then((artwork) => {
      if (!artwork || !canvas.isConnected) return;
      canvas.width = canvas.height = 144;
      canvas.getContext("2d").drawImage(artwork.image,0,0,144,144);
      canvas.hidden = false;
      canvas.previousElementSibling.hidden = true;
    });
  }
}
