import {cp, mkdir, readdir, rm, writeFile} from "node:fs/promises";

const dist = new URL("../dist/",import.meta.url);
const client = new URL("client/",dist);
const server = new URL("server/",dist);
await rm(client,{recursive:true,force:true});
await mkdir(client,{recursive:true});
await mkdir(server,{recursive:true});
for (const name of await readdir(dist)) {
  if (name === "assets" || /\.(html|css|mjs|json)$/.test(name)) {
    await cp(new URL(name,dist),new URL(name,client),{recursive:true});
  }
}
await cp(new URL("../worker/session.mjs",import.meta.url),new URL("index.js",server));
await cp(new URL("../worker/session.mjs",import.meta.url),new URL("_worker.js",client));
await writeFile(new URL("wrangler.json",server),JSON.stringify({
  name:"wayfarer-vtt",main:"index.js",compatibility_date:"2026-05-25",
  assets:{directory:"../client",binding:"ASSETS",html_handling:"none"},
  d1_databases:[{binding:"DB",database_id:"af23b966-91b0-416b-87f5-89140e7ddbd2"}],
  r2_buckets:[{binding:"BUCKET",bucket_name:"wayfarer-art"}],
},null,2));
