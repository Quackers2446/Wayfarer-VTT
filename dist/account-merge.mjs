const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const emptyWorkspace=()=>({characters:[],spellRules:{},active:null});
export function mergeWorkspaces(base,local,cloud){
 const conflicts=[],characters=[],spellRules={};
 function merge(kind,id,b,l,r){if(equal(l,r))return l;if(equal(l,b))return r;if(equal(r,b))return l;conflicts.push({kind,id,name:l?.name??r?.name??id,local:l,cloud:r});return l;}
 const index=items=>new Map((items??[]).map(item=>[item.id,item]));const b=index(base.characters),l=index(local.characters),r=index(cloud.characters);
 for(const id of new Set([...r.keys(),...l.keys(),...b.keys()])){const result=merge('character',id,b.get(id),l.get(id),r.get(id));if(result)characters.push(result);}
 for(const id of new Set([...Object.keys(cloud.spellRules??{}),...Object.keys(local.spellRules??{}),...Object.keys(base.spellRules??{})])){const result=merge('spell rule',id,base.spellRules?.[id],local.spellRules?.[id],cloud.spellRules?.[id]);if(result)spellRules[id]=result;}
 return {workspace:{characters,spellRules,active:equal(local.active,base.active)?cloud.active:local.active},conflicts};
}
export function importGuestWorkspace(cloud,guest){
 const result=structuredClone(cloud),conflicts=[];result.characters??=[];result.spellRules??={};
 for(const character of guest.characters??[]){const existing=result.characters.find(item=>item.id===character.id);if(!existing)result.characters.push(character);else if(!equal(existing,character)){const copy={...character,id:crypto.randomUUID(),name:character.name+' (imported copy)'};result.characters.push(copy);}}
 for(const [id,rule]of Object.entries(guest.spellRules??{})){if(!result.spellRules[id])result.spellRules[id]=rule;else if(!equal(result.spellRules[id],rule)){conflicts.push({kind:'spell rule',id,name:rule.name,local:rule,cloud:result.spellRules[id]});result.spellRules[id]=rule;}}
 if(!result.active)result.active=guest.active??null;
 return {workspace:result,conflicts};
}
