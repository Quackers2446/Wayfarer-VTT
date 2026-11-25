// Deterministic extraction of authored random encounter tables. No AI inference.
const key=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const number=s=>({one:1,two:2,three:3,four:4,six:6,eight:8,twelve:12,half:.5}[String(s).toLowerCase()]??Number(s));
const scalar=s=>typeof s==='string'?s:typeof s?.entry==='string'?s.entry:'';
function textOf(node){return (node.entries??[]).filter(v=>typeof v==='string').join(' ');}
function bounds(cell){if(cell?.roll){const r=cell.roll;return [r.exact??r.min,r.exact??r.max];}const s=scalar(cell).replace(/\{@[^ ]+ ([^}]+)\}/g,'$1').trim(),m=/^(\d+)(?:\s*[–—-]\s*(\d+))?$/.exec(s);return m?[Number(m[1]),Number(m[2]??m[1])]:null;}
function creatureRefs(text){const refs=[];for(const match of text.matchAll(/\{@creature ([^|}]+)(?:\|([^|}]*))?(?:\|[^}]*)?\}/g)){const before=text.slice(0,match.index),count=/\{@dice ([\dd+ -]+)(?:\|[^}]*)?\}\s*$/.exec(before)?.[1]??/\b(\d+)\s*$/.exec(before)?.[1]??/\b(one|two|three|four|six|eight|twelve)\s*$/i.exec(before)?.[1]??'1';refs.push({name:match[1],source:match[2]||'MM',count:Number.isFinite(number(count))?String(number(count)):count});}return refs;}
function tableRule(table,context,id,label){
 const dice=scalar(table.colLabels?.[0]).trim().replace(/^\{@dice ([^|}]+)(?:\|[^}]*)?\}$/i,'$1').replace(/\s+/g,'');
 if(!/^(?:\d*d(?:2|3|4|6|8|10|12|20|100))(?:\+\d*d(?:2|3|4|6|8|10|12|20|100))*$/i.test(dice)||!Array.isArray(table.rows))return null;
 const terms=[...dice.matchAll(/(\d*)d(\d+)/gi)],faces=terms.reduce((n,t)=>n+Number(t[1]||1)*Number(t[2]),0),minimum=terms.reduce((n,t)=>n+Number(t[1]||1),0),rows=[];if(faces>1000||minimum>20)return null;
 for(const raw of table.rows){const cells=Array.isArray(raw)?raw:raw.row;if(!Array.isArray(cells))return null;const range=bounds(cells[0])?.map(n=>n===0&&faces===100?100:n);if(!range||range[0]>range[1]||range.some(n=>!Number.isInteger(n)||n<1||n>faces))return null;const text=cells.slice(1).map(scalar).join(' ');if(!text)return null;const none=/\b(?:no encounter|nothing happens|no wandering monsters?)\b/i.test(text);rows.push({min:range[0],max:range[1],text:text.slice(0,1600),none,creatures:none?[]:creatureRefs(text),neutral:/\b(?:friendly|peaceful|nonhostile)\b/i.test(text)});}
 for(let n=minimum;n<=faces;n++)if(rows.filter(r=>n>=r.min&&n<=r.max).length!==1)return null;
 const frequency=/every\s+(\d+(?:\.\d+)?|one|two|three|four|six|eight|twelve|half)\s+(hours?|minutes?)/i.exec(context);
 const perDay=/(\d+|one|two|three|four) times per day/i.exec(context);
 const intervalHours=frequency?number(frequency[1])*(frequency[2].toLowerCase().startsWith('minute')?1/60:1):/each hour|hourly|every hour/i.test(context)?1:perDay?24/number(perDay[1]):1;
 let chance=null;
 if(!rows.some(r=>r.none)){
  const gate=/(?:on|occurs on) a roll of (\d+)(?: (or higher|or lower))?/i.exec(context),d=/\{@dice (?:1)?d(4|6|8|10|12|20|100)\}/i.exec(context);
  chance=gate&&d?{faces:Number(d[1]),min:gate[2]==='or lower'?1:Number(gate[1]),max:gate[2]==='or higher'?Number(d[1]):Number(gate[1]),authored:true}:{faces:6,min:1,max:1,authored:false};
 }
 const minArea=/in areas? (\d+) and beyond/i.exec(context)?.[1];
 return {id,label,caption:table.caption??label,faces,dice,rows,intervalHours,authoredInterval:Boolean(frequency||perDay||/each hour|hourly|every hour/i.test(context)),chance,...(minArea?{minArea:Number(minArea)}:{})};
}
export function adventureRestPolicies(adventure,module){
 if(adventure.adventureData)adventure=adventure.adventureData.find(a=>a.id.toLowerCase()===module.toLowerCase())??adventure.adventureData[0];
 const chapters=adventure.data??[],ids=new Map(),nodeIds=new WeakMap();let nextNode=0;
 function index(node){if(Array.isArray(node))node.forEach(index);else if(node&&typeof node==='object'){nodeIds.set(node,nextNode++);if(node.id)ids.set(node.id,node);Object.values(node).forEach(v=>{if(v&&typeof v==='object')index(v);});}}index(chapters);
 const policies={},maps={};
 for(const [chapterIndex,chapter] of chapters.entries()){
  const images=[],found=new Map();
  function collect(node,parents=[],randomSection=null){
   if(Array.isArray(node)){node.forEach(n=>collect(n,parents,randomSection));return;}
   if(!node||typeof node!=='object')return;
   const scope=/random encounters?|wandering monsters?/i.test(node.name??'')?node:randomSection;
   if(node.type==='image'&&['map','mapPlayer'].includes(node.imageType)&&node.grid?.type==='square')images.push({node,parents});
   if(node.type==='table'&&scope){const id=module.toLowerCase()+':'+(node.id??scope.id??chapterIndex)+':'+(node.caption??nodeIds.get(node)),context=[...parents.slice(-4),scope].map(textOf).join(' '),policy=tableRule(node,context,id,scope.name??node.caption??'Random encounters');if(policy){const room=[...parents].reverse().find(p=>/^(?:area\s*)?\d+[a-z]?[.: ]/i.test(p.name??'')&&p.id);if(room&&!/\b(?:dungeon|throughout|on this level|in areas?)\b/i.test(context))policy.areaIds=[room.id];found.set(id,{policy,scopeNames:parents.map(n=>n.name??'')});}}
   if(scope===node)for(const string of node.entries??[]){if(typeof string!=='string')continue;for(const match of string.matchAll(/\{@area [^|}]+\|([^|}]+)/g)){const linked=ids.get(match[1]);if(linked&&linked!==node&&!parents.includes(linked))collect(linked,[...parents,node],node);}}
   for(const [k,v] of Object.entries(node))if(k!=='rows'&&v&&typeof v==='object')collect(v,[...parents,node],scope);
  }
  collect(chapter);
  for(const {node,parents} of images){
   const context=key([node.title,...parents.map(p=>p.name)].join(' '));
   const choices=[...found.values()].map(entry=>({...entry,score:entry.scopeNames.filter(name=>name&&context.includes(key(name))).length+(context.includes(key(entry.policy.caption))?5:0)})).sort((a,b)=>b.score-a.score);
   if(!choices.length)continue;
   for(const {policy} of choices)policies[policy.id]=policy;
   const highest=choices[0].score,top=choices.filter(c=>c.score===highest),selection=top.length===1?top[0].policy.id:null;
   for(const ref of [node.id,node.href?.path,node.mapParent].filter(v=>typeof v==='string'))maps[module.toLowerCase()+'|'+ref]={policies:choices.map(c=>c.policy.id),selection};
  }
 }
 return {maps,policies};
}
