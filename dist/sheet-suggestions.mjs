import {attachSuggestions} from './search-suggestions.mjs';
import {loadRules} from './rules-library.mjs';
import {loadBuilderData,plain} from './character-builder-rules.mjs';
const damageType={S:'slashing',P:'piercing',B:'bludgeoning'};
function description(entries){return (entries??[]).flatMap(entry=>typeof entry==='string'?[plain(entry)]:[entry.name,entry.entry?plain(entry.entry):'',description(entry.entries??entry.items)]).filter(Boolean).join('\n\n');}
function set(form,name,value){const field=form.elements.namedItem(name);if(field){field.value=value??'';field.dispatchEvent(new Event('input',{bubbles:true}));}}
export function initSheetSuggestions(dialog){
 for(const input of dialog.querySelectorAll('[data-suggest]')){
  const kind=input.dataset.suggest,form=input.form;let chosenName=input.value;
  if(kind==='spells')input.addEventListener('input',()=>{if(input.value!==chosenName)set(form,'source','');});
  attachSuggestions(input,{
   options:async()=>{let records;
    if(kind==='spells')records=(await loadRules()).spells;
    else if(kind==='weapons')records=(await loadRules()).weapons;
    else records=(await loadBuilderData())[kind]??[];
    return records.map(record=>({label:record.name,detail:[record.source,kind==='spells'?(record.level?'Level '+record.level:'Cantrip')+' · '+record.edition:record.weaponCategory??(kind==='equipment'?'Equipment':'')].filter(Boolean).join(' · '),search:record.alias?.join(' '),record}));
   },
   select:({record})=>{
    chosenName=record.name;
    if(kind==='spells'){set(form,'source',record.source);set(form,'level',record.level);set(form,'note',description(record.entries));}
    if(kind==='equipment'){set(form,'weight',record.weight);set(form,'note',description(record.entries));}
    if(kind==='weapons'){set(form,'damage',[record.dmg1,damageType[record.dmgType]].filter(Boolean).join(' '));}
   }
  });
 }
}
