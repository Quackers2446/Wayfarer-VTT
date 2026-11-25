import {restParty,shortRestsLeft} from './class-actions.mjs';
import {advanceTime,rollDice,log,actorIsUp,occupies,canStand,placeToken,startInitiative,distanceFt,lineClear} from './combat.mjs';
import {withActionEvent,recordAction} from './action-events.mjs';
import {creatureActor,regionAt,cellCenter} from './encounters.mjs';
let database,promise;
const activeRests=new WeakSet();
export function loadRestEncounters(){return promise??=fetch(new URL('./rest-encounters.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('Dungeon encounter tables could not be loaded.');return r.json();}).then(value=>database=value).catch(error=>{promise=null;throw error;});}
export function restTableChoices(map){
 if(map.module==='training')return {policies:[],selection:null};
 if(!database)return {loading:true,policies:[],selection:null};
 const record=database.maps[map.module.toLowerCase()+'|'+map.id]??database.maps[map.module.toLowerCase()+'|'+map.asset]??{policies:[],selection:null};
 return {...record,policies:record.policies.map(id=>database.policies[id]).filter(Boolean)};
}
export function restPolicy(map,battle){const choices=restTableChoices(map),selected=battle.rest?.tableChoices?.[map.key]??choices.selection;return choices.policies.find(p=>p.id===selected);}
export function restBlocked(battle,long=false){return battle.round||battle.movement||battle.classReaction?'You can only rest out of combat.':!battle.actors.some(a=>a.side==='party'&&actorIsUp(a))?'A conscious party member is required to rest.':!long&&!shortRestsLeft(battle)?'Both short rests are spent. Take a long rest first.':'';}
const plain=text=>String(text).replace(/\{@\w+ ([^}]+)\}/g,(_,body)=>body.split('|')[2]||body.split('|')[0]);
export function restRiskSummary(policy){if(!policy)return 'No applicable random-encounter table for this map.';const gate=policy.chance?`${policy.chance.max-policy.chance.min+1} in ${policy.chance.faces}${policy.chance.authored?'':' (Wayfarer default)'}`:'source table includes no-encounter results';return `${policy.caption}: checks every ${policy.intervalHours<1?policy.intervalHours*60+' minutes':policy.intervalHours+' hours'}${policy.authoredInterval?'':' (Wayfarer default)'}; ${gate}. A triggered encounter interrupts recovery.`;}
function applies(policy,map,leader){if(!policy)return false;const region=regionAt(map,...cellCenter(map,leader));if(policy.areaIds&&!policy.areaIds.includes(region?.id))return false;if(policy.minArea){const n=/^(?:area\s*)?(\d+)/i.exec(region?.entry?.name??'')?.[1];if(!n||Number(n)<policy.minArea)return false;}return true;}
function placeEncounter(battle,map,leader,actors){
 const candidates=[];for(let y=0;y<map.rows;y++)for(let x=0;x<map.cols;x++){const dist=distanceFt(leader,{x,y});if(dist>=10&&dist<=60)candidates.push({x,y,dist});}
 candidates.sort((a,b)=>a.dist-b.dist||a.y-b.y||a.x-b.x);
 for(const actor of actors){const cell=candidates.find(c=>canStand(battle,actor,c.x,c.y,map)&&lineClear(battle,leader,c,map));if(!cell)throw Error('There is not enough clear space near the party for this encounter. No rest was spent.');placeToken(battle,actor,cell.x,cell.y,map);actor.sceneKey=map.key;actor.origin='rest:'+map.key;battle.actors.push(actor);}
}
export async function takeDungeonRest(battle,map,long=false,{leaderId,random=Math.random,loadMonster}={}){
 if(activeRests.has(battle))throw Error('A rest is already being resolved.');
 activeRests.add(battle);
 try{return await resolveDungeonRest(battle,map,long,{leaderId,random,loadMonster});}finally{activeRests.delete(battle);}
}
async function resolveDungeonRest(battle,map,long,{leaderId,random,loadMonster}){
 const blocked=restBlocked(battle,long);if(blocked)throw Error(blocked);
 if(map.module!=='training')await loadRestEncounters();const choices=restTableChoices(map),policy=restPolicy(map,battle);
 if(choices.policies.length&&!policy)throw Error('Choose the applicable random-encounter table in the Rest panel first.');
 const draft=structuredClone(battle),leader=draft.actors.find(a=>a.id===leaderId&&a.side==='party'&&!a.dead&&occupies(a))??draft.actors.find(a=>a.side==='party'&&!a.dead&&occupies(a));
 if(!leader)throw Error('Place a living party member on the map before resting.');
 const duration=long?28800:3600,interval=policy?.intervalHours*3600,progress=policy?(draft.rest?.encounterProgress?.[policy.id]??0):0;
 const eligible=applies(policy,map,leader),checks=eligible?Math.floor((progress+duration)/interval):0;
 let elapsed=duration,encounter=null,rolled=[],rolledChecks=0;
 withActionEvent(draft,leader,{action:(long?'Long':'Short')+' rest · encounter checks',kind:'rest'},()=>{
  log(draft,'The party attempts a '+(long?'long':'short')+' rest.');
  for(let index=0;index<checks;index++){
   rolledChecks++;
   const at=interval-progress+index*interval;
   if(policy.chance){const gate=rollDice('1d'+policy.chance.faces,{random,label:'Rest encounter check '+(index+1)});log(draft,`Rest check ${index+1}/${checks}: ${gate.total} on d${policy.chance.faces}.`);if(gate.total<policy.chance.min||gate.total>policy.chance.max)continue;}
   const roll=rollDice(policy.dice??'1d'+policy.faces,{random,label:policy.caption});
   const row=policy.rows.find(row=>roll.total>=row.min&&roll.total<=row.max);
   if(!row)throw Error('The source encounter table has an uncovered roll.');
   log(draft,policy.caption+' · '+roll.total+' — '+plain(row.text));
   if(row.none)continue;
   encounter=row;elapsed=at;
   rolled=row.creatures.map(ref=>({...ref,count:rollDice(ref.count,{random,label:ref.name+' encounter count'}).total}));
   if(rolled.some(r=>!Number.isInteger(r.count)||r.count<0)||rolled.reduce((sum,r)=>sum+r.count,0)>40)throw Error('This encounter is too large for the current map. No rest was spent.');
   break;
  }
 });
 const actors=[];
 if(encounter)for(const ref of rolled){
  if(!ref.count)continue;
  const data=database.monsters[ref.name.toLowerCase()+'|'+ref.source.toLowerCase()];
  const model=loadMonster?await loadMonster(ref):await creatureActor({...ref,data,side:encounter.neutral?'neutral':'hostile'});
  for(let n=0;n<ref.count;n++)actors.push({...structuredClone(model),id:crypto.randomUUID(),name:ref.count>1?model.name+' '+(n+1):model.name});
 }
 if(actors.length)placeEncounter(draft,map,leader,actors);
 draft.rest??={};draft.rest.encounterProgress??={};if(eligible)draft.rest.encounterProgress[policy.id]=(progress+elapsed)%interval;
 advanceTime(draft,elapsed);
 if(encounter){
  draft.rest.lastEncounter={table:policy.id,description:plain(encounter.text),at:draft.elapsed};
  log(draft,'Rest interrupted after '+Math.round(elapsed/60)+' minutes. No healing or rest resources were restored.');
  recordAction(draft,leader,{action:'Rest interrupted',kind:'rest',messages:[plain(encounter.text),'No healing or rest resources were restored.']});
  const hostile=actors.filter(a=>a.side==='hostile');
  if(hostile.length){const participants=new Set([...draft.actors.filter(a=>a.side==='party'&&occupies(a)&&!a.dead),...hostile].map(a=>a.id));startInitiative(draft,random,participants);}
 }else restParty(draft,long,{advance:false});
 Object.assign(battle,draft);return {completed:!encounter,checks:rolledChecks,plannedChecks:checks,elapsed,encounter,spawned:actors.map(a=>a.id)};
}
