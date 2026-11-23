export const crExperience={'0':10,'1/8':25,'1/4':50,'1/2':100,'1':200,'2':450,'3':700,'4':1100,'5':1800,'6':2300,'7':2900,'8':3900,'9':5000,'10':5900,'11':7200,'12':8400,'13':10000,'14':11500,'15':13000,'16':15000,'17':18000,'18':20000,'19':22000,'20':25000,'21':33000,'22':41000,'23':50000,'24':62000,'25':75000,'26':90000,'27':105000,'28':120000,'29':135000,'30':155000};
export const xpForCR=cr=>{if(Number.isFinite(cr?.xp))return Math.max(0,cr.xp);const value=typeof cr==='object'?cr?.cr:cr;return crExperience[String(value)] ?? 0;};
export const itemFromReference=ref=>{const [name,source='PHB']=String(ref).split('|');return {name:name.replace(/\b\w/g,c=>c.toUpperCase()),reference:source.toLowerCase()+'|'+name.toLowerCase(),quantity:1};};
export function awardDefeatXP(battle,victim,killer,writeLog){
  if(!battle.round || victim.side!=='hostile' || victim.xpAwarded || !victim.dead)return;
  victim.xpAwarded=true;
  const ids=battle.encounterParticipants ?? battle.order;
  const party=battle.actors.filter(actor=>actor.side==='party' && ids.includes(actor.id)).sort((a,b)=>a.id.localeCompare(b.id));
  const total=Number.isFinite(victim.rewardXp)?victim.rewardXp:xpForCR(victim.cr);if(!total || !party.length)return;
  const base=Math.floor(total/party.length),remainder=total%party.length,awards=[];
  for(const [index,actor] of party.entries()){
    const share=base+(index<remainder?1:0),bonus=actor.id===killer?.id?Math.floor(share*.2):0,gained=share+bonus;
    actor.xp=(Number(actor.xp)||0)+gained;actor.earnedXp=(actor.earnedXp??0)+gained;
    actor.rewardsRevision=(actor.rewardsRevision??0)+1;awards.push({actor:actor.id,name:actor.name,xp:gained,bonus});
  }
  victim.xpAwards=awards;writeLog?.(battle,`${victim.name} defeated · ${awards.map(a=>`${a.name} +${a.xp} XP${a.bonus?' (includes '+a.bonus+' final-blow bonus)':''}`).join(' · ')}.`);
}
let database;
export async function prepareMonsterRewards(battle){
  const missing=battle.actors.filter(a=>a.side!=='party' && !a.rewardsPrepared && (a.statName || a.source));if(!missing.length)return;
  database ??= fetch(new URL('./monster-rewards.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('Monster rewards could not be loaded.');return r.json();}).catch(e=>{database=null;throw e;});
  const records=await database;
  for(const actor of missing){const record=records[(actor.statName??actor.name.replace(/\s\d+$/,'')).toLowerCase()+'|'+(actor.source??'MM').toLowerCase()];if(record){actor.cr ??= record.cr;actor.rewardXp ??= record.xp;if(!actor.lootInitialized){actor.loot ??= structuredClone(record.items);actor.lootInitialized=true;}}actor.rewardsPrepared=true;}
}
