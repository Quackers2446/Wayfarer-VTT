import {createHash} from "node:crypto";
import {cp, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";

const dist = new URL("../dist/",import.meta.url);
const client = new URL("client/",dist);
const server = new URL("server/",dist);
// Keep the built-in illustrations restricted to the reviewed 5etools source images.
const artwork=JSON.parse(await readFile(new URL('assets/artwork-sources.json',dist),'utf8'));
const approved=new Map(artwork.images.map(image=>[image.file,image.sha256])),found=new Set();
async function verifyArtwork(directory,prefix) {
  for(const file of await readdir(directory,{withFileTypes:true})) {
    const path=prefix+file.name,url=new URL(file.name,directory);
    if(file.isDirectory()) await verifyArtwork(new URL(file.name+'/',directory),path+'/');
    else if(/\.(png|jpe?g|webp|avif|gif)$/i.test(file.name)) {
      const hash=createHash('sha256').update(await readFile(url)).digest('hex');
      if(approved.get(path)!==hash) throw new Error('Unapproved built-in artwork: '+path+'. Use artwork referenced by 5etools and update artwork-sources.json.');
      found.add(path);
    }
  }
}
await verifyArtwork(new URL('assets/',dist),'assets/');
for(const path of approved.keys()) if(!found.has(path)) throw new Error('Missing approved artwork: '+path);
await rm(client,{recursive:true,force:true});
await mkdir(client,{recursive:true});
await mkdir(server,{recursive:true});
for (const name of await readdir(dist)) {
  if (name === "assets" || /\.(html|css|mjs|json)$/.test(name)) {
    await cp(new URL(name,dist),new URL(name,client),{recursive:true});
  }
}
const sessionCode = await readFile(new URL("../worker/session.mjs",import.meta.url),"utf8");
const roomOwnerCode = await readFile(new URL("../worker/room-owner.mjs",import.meta.url),"utf8");
const bundledWorker = sessionCode.replace(
  "import {newRoomOwner,ownerHash,ownsRoom} from './room-owner.mjs';",
  roomOwnerCode
);
await writeFile(new URL("index.js",server),bundledWorker);
await writeFile(new URL("_worker.js",client),bundledWorker);
await writeFile(new URL("wrangler.json",server),JSON.stringify({
  name:"wayfarer-vtt",main:"index.js",compatibility_date:"2026-05-25",
  assets:{directory:"../client",binding:"ASSETS",html_handling:"none"},
  d1_databases:[{binding:"DB",database_id:"af23b966-91b0-416b-87f5-89140e7ddbd2"}],
  r2_buckets:[{binding:"BUCKET",bucket_name:"wayfarer-art"}],
},null,2));
