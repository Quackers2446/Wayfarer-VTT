import {createHash} from "node:crypto";
import {cp, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {relative, sep} from "node:path";
import {fileURLToPath} from "node:url";

// One shared, data-only validator is used by browser editing and room saves.
await cp(new URL('../dist/spell-rule-schema.mjs',import.meta.url),new URL('../worker/spell-rule-schema.mjs',import.meta.url));
const dist = new URL("../dist/",import.meta.url);
const client = new URL("client/",dist);
const server = new URL("server/",dist);
const localAnimationOutput = path => path === 'assets/animations/transparent' ||
  path.startsWith('assets/animations/_blfx-') ||
  (path.startsWith('assets/animations/') && (path.endsWith('.opaque.bak') || path.endsWith('.jb2a.bak')));
// Keep the built-in illustrations restricted to the reviewed 5etools source images.
const artwork=JSON.parse(await readFile(new URL('assets/artwork-sources.json',dist),'utf8'));
const approved=new Map(artwork.images.map(image=>[image.file,image.sha256])),found=new Set();
const animations=JSON.parse(await readFile(new URL('assets/animations/credits.json',dist),'utf8'));
for(const clip of animations.clips){
  if(!clip.file.startsWith('assets/animations/')||!/\.webm$/.test(clip.file)||clip.file.includes('..'))throw Error('Invalid animation asset path.');
  const hash=createHash('sha256').update(await readFile(new URL(clip.file,dist))).digest('hex');
  if(hash!==clip.sha256)throw Error('Animation differs from its credited source: '+clip.file);
}
async function verifyArtwork(directory,prefix) {
  for(const file of await readdir(directory,{withFileTypes:true})) {
    const path=prefix+file.name;
    if(localAnimationOutput(path)) continue;
    const url=new URL(file.name,directory);
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
// Local-only Spell FX preview / QA fixtures: served from dist/ by scripts/serve.py, never published.
const localOnly = new Set([
  "spell-fx-gallery.html",
  "spell-fx-gallery.mjs",
  "spell-fx-gallery.css",
  "attack-fx-gallery.html",
  "attack-fx-gallery.mjs",
  "attack-fx-gallery.css",
  "fixtures",
]);
for (const name of await readdir(dist)) {
  // Copy top-level client assets and the spell-library package the engine imports at runtime.
  if (localOnly.has(name)) continue;
  if (name === "assets" || name === "spell-library" || name === "compiled-features" || /\.(html|css|mjs|json)$/.test(name)) {
    await cp(new URL(name,dist),new URL(name,client),{
      recursive:true,
      filter: path => !localAnimationOutput(relative(fileURLToPath(dist),path).split(sep).join('/')),
    });
  }
}
const sessionCode = await readFile(new URL("../worker/session.mjs",import.meta.url),"utf8");
const roomOwnerCode = await readFile(new URL("../worker/room-owner.mjs",import.meta.url),"utf8");
const playerAuthCode = await readFile(new URL("../worker/player-auth.mjs",import.meta.url),"utf8");
const spellRuleSchemaCode = await readFile(new URL("../worker/spell-rule-schema.mjs",import.meta.url),"utf8");
const accountsCode=await readFile(new URL("../worker/accounts.mjs",import.meta.url),"utf8");
const bundledWorker = sessionCode
  .replace("import {accounts} from './accounts.mjs';",accountsCode.replace("import {validRuleSet} from './spell-rule-schema.mjs';",'').replace(/export /g,''))
  .replace(
    "import {newRoomOwner,ownerHash,ownsRoom} from './room-owner.mjs';",
    roomOwnerCode
  )
  .replace(
    "import {newPlayerCredential,playerCredentialHash,matchesPlayerCredential} from './player-auth.mjs';",
    playerAuthCode.replace(/export /g, "")
  )
  .replace(
    "import {validRuleSet} from './spell-rule-schema.mjs';",
    spellRuleSchemaCode.replace(/export /g, "")
  );
await writeFile(new URL("index.js",server),bundledWorker);
await writeFile(new URL("_worker.js",client),bundledWorker);
await writeFile(new URL("wrangler.json",server),JSON.stringify({
  name:"wayfarer-vtt",main:"index.js",compatibility_date:"2026-05-25",
  assets:{directory:"../client",binding:"ASSETS",html_handling:"none"},
  vars:{CF_ACCOUNT_ID:"1a15c3ffd6933ad42e67777406cb8a61",TURN_USAGE_CAP_GB:"750"},
  d1_databases:[{binding:"DB",database_id:"af23b966-91b0-416b-87f5-89140e7ddbd2"}],
},null,2));

await cp(new URL("../worker/accounts.mjs",import.meta.url),new URL("accounts.mjs",server));
await cp(new URL("../worker/spell-rule-schema.mjs",import.meta.url),new URL("spell-rule-schema.mjs",server));

await cp(new URL("../worker/spell-rule-schema.mjs",import.meta.url),new URL("spell-rule-schema.mjs",client));
