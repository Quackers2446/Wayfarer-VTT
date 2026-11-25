import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spellAnimations,defaultSpellAnimation} from '../dist/spell-animation-library.mjs';
const exec=promisify(execFile),base=new URL('../dist/',import.meta.url),file=new URL('assets/animations/credits.json',base),credits=JSON.parse(await readFile(file));
const defaults=[...new Set(spellAnimations.flatMap(clip=>clip.spells))].map(name=>defaultSpellAnimation(name));
for(const name of ['Wall of Fire','Wall of Force'])defaults.push(defaultSpellAnimation(name,{shape:'ring'}));
const pending=[...new Map(defaults.filter(clip=>clip?.url.startsWith('https:')).map(clip=>[clip.url,clip])).values()];
console.log('Bundling '+pending.length+' additional automatic defaults.');
let index=0;
async function worker(){while(index<pending.length){const clip=pending[index++],relative='assets/animations/'+clip.id+'.webm',path=new URL(relative,base),temporary=new URL(relative+'.download',base);try{
 await exec('curl',['--fail','-sL','--retry','2','--retry-all-errors','--retry-delay','1','--connect-timeout','15','--max-time','90','--max-filesize','25000000',clip.url,'-o',fileURLToPath(temporary)]);
 const bytes=await readFile(temporary),probe=JSON.parse((await exec('ffprobe',['-v','quiet','-show_format','-of','json',fileURLToPath(temporary)])).stdout);
 await rename(temporary,path);const record={id:clip.id,file:relative,source:clip.url,sha256:createHash('sha256').update(bytes).digest('hex'),duration:Number(probe.format.duration)};
 credits.clips.push(record);console.log(clip.spells[0]+': '+bytes.length+' bytes');
 }catch(error){await rm(temporary,{force:true});throw error;}}}
const results=await Promise.allSettled(Array.from({length:4},worker));
await writeFile(file,JSON.stringify(credits,null,2)+'\n');
for(const result of results)if(result.status==='rejected')throw result.reason;
console.log(credits.clips.length+' credited local default clips. Regenerate the animation index next.');
