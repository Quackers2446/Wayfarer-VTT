import {readFile,readdir,writeFile} from 'node:fs/promises';
import {monsterAttack,repeatedAttacks} from '../dist/encounters.mjs';
import {adventureRestPolicies} from '../dist/rest-tables.mjs';
const root=new URL('../../5etools-v2.41.2/data/',import.meta.url),maps={},policies={},monsters={};
for(const file of await readdir(new URL('adventure/',root))){if(!/^adventure-.*\.json$/.test(file))continue;const data=JSON.parse(await readFile(new URL('adventure/'+file,root))),module=data.id??file.slice(10,-5),result=adventureRestPolicies(data,module);Object.assign(maps,result.maps);Object.assign(policies,result.policies);}
const required=new Set(Object.values(policies).flatMap(p=>p.rows.flatMap(r=>r.creatures.map(c=>c.name.toLowerCase()+'|'+c.source.toLowerCase()))));
const bestiary=new URL('bestiary/',root),raw=new Map();
for(const file of await readdir(bestiary)){if(!/^bestiary-.*\.json$/.test(file))continue;const data=JSON.parse(await readFile(new URL(file,bestiary)));for(const m of data.monster??[])raw.set(m.name?.toLowerCase()+'|'+m.source?.toLowerCase(),m);}
function resolve(m,depth=0){if(!m||depth>12)return null;const parent=m._copy?resolve(raw.get(m._copy.name.toLowerCase()+'|'+m._copy.source.toLowerCase()),depth+1):{};if(m._copy&&!parent)return null;const result={...structuredClone(parent),...structuredClone(m)};
 // Text substitutions do not change combat statistics. Unsupported structured
 // modifications are left to the existing source overrides / runtime behavior.
 for(const op of [m._copy?._mod?.['*']].flat().filter(Boolean))if(op.mode==='replaceTxt'){
  for(const field of ['action','trait'])if(result[field])result[field]=JSON.parse(JSON.stringify(result[field]).replace(new RegExp(op.replace,'gi'),op.with));
 }
 if(m._copy?._templates?.some(t=>t.name==='Reduced Threat')){result.hp.average=Math.floor(result.hp.average/2);if(['H','G'].includes(result.size?.[0]))result.size=['L'];for(const ability of ['str','dex','con','int','wis','cha'])(result.save??={})[ability]=String(Number(result.save?.[ability]??Math.floor((result[ability]-10)/2))-2);for(const field of ['action','trait'])if(result[field])result[field]=JSON.parse(JSON.stringify(result[field]).replace(/\{@(hit|dc) ([-+]?\d+)\}/g,(_,kind,n)=>'{@'+kind+' '+(Number(n)-2)+'}'));result.restXpMultiplier=.5;}
 return result;}
for(const id of required){const m=resolve(raw.get(id));if(!m?.hp?.average||!m.ac?.[0])continue;const keys=['name','source','size','hp','ac','speed','str','dex','con','int','wis','cha','save','cr','type','attachedItems','resist','immune','vulnerable','conditionImmune','tokenHref','hasToken','token','isNpc','restXpMultiplier'];const attacks=m.action?.flatMap(monsterAttack)??[];
 monsters[id]={...Object.fromEntries(keys.filter(k=>m[k]!=null).map(k=>[k,m[k]])),attacks,multiattack:repeatedAttacks(m.action,attacks),trait:(m.trait??[]).filter(t=>['Pack Tactics','Nimble Escape'].includes(t.name)).map(t=>({name:t.name}))};}
for(const policy of Object.values(policies))for(const row of policy.rows){
 if(row.none)row.text='No encounter.';
 else if(row.creatures.length)row.text=row.creatures.map(c=>c.count+' × '+c.name).join(', ');
 else row.text='A narrative encounter occurs. See the corresponding result in the adventure table.';
}
await writeFile(new URL('../dist/rest-encounters.json',import.meta.url),JSON.stringify({version:1,maps,policies,monsters}));
console.log(Object.keys(maps).length+' map references, '+Object.keys(policies).length+' scoped encounter tables, '+Object.keys(monsters).length+' available monster stat blocks.');
