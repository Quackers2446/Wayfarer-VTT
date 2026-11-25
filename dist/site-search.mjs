import {registerSuggestions} from './search-suggestions.mjs';
import {loadRules,spellKey} from './rules-library.mjs';
import {loadSpellRules} from './spell-rule-store.mjs';
import {builtinList} from './spell-library/index.mjs';
let monsters;
registerSuggestions('.rule-search',{
 options:async input=>{
  const filter=input.closest('.rule-library').querySelector('.rule-filter').value;
  const saved=loadSpellRules();
  const builtins=new Set(builtinList().map(rule=>rule.reference));
  const spells=(await loadRules()).spells;
  const seen=new Set(spells.map(spell=>spellKey(spell)));
  const extras=[];
  for(const rule of builtinList()){
   if(seen.has(rule.reference))continue;
   seen.add(rule.reference);
   extras.push({name:rule.name,source:rule.source||'PHB',edition:rule.edition||'2014',level:rule.level||0});
  }
  return [...spells,...extras].filter(spell=>{
   const id=spellKey(spell);
   if(filter==='all')return true;
   if(filter==='homebrew')return String(spell.source).toUpperCase()==='HB'||id.startsWith('hb|');
   if(filter==='2014'||filter==='2024')return spell.edition===filter;
   if(filter==='saved')return Boolean(saved[id]);
   if(filter==='builtin')return builtins.has(id);
   if(filter.startsWith('level:'))return String(spell.level)===filter.slice(6);
   return true;
  }).map(spell=>({label:spell.name,detail:spell.source+' · '+spell.edition+' · '+(spell.level?'Level '+spell.level:'Cantrip')+(builtins.has(spellKey(spell))?' · Built-in':''),id:spellKey(spell)}));
 },
 select:(item,input)=>[...input.closest('.rule-library').querySelectorAll('[data-rule-select]')].find(button=>button.dataset.ruleSelect===item.id)?.click()
});
registerSuggestions('[data-choice-search]',{
 options:input=>[...input.closest('[data-choice-id]').querySelectorAll('.builder-option')].filter(row=>!row.querySelector('input')?.disabled).map(row=>({label:row.querySelector('.builder-spell-name,strong')?.textContent??'',detail:row.querySelector('small,.builder-spell-tags')?.textContent.trim(),row})),
 select:item=>{item.row.scrollIntoView({block:'nearest',behavior:'smooth'});}
});
registerSuggestions('.feature-choice-search',{
 options:input=>[...input.closest('.feature-choice').querySelectorAll('option')].filter(option=>!option.disabled).map(option=>({label:option.textContent,detail:option.selected?'Selected':'Class feature option'}))
});
registerSuggestions('#creature-name',{
 options:async()=>{monsters??=fetch('monster-search.json').then(response=>{if(!response.ok)throw Error('Monster suggestions unavailable');return response.json();}).catch(error=>{monsters=null;throw error;});return (await monsters).map(record=>({label:record.name,detail:record.source+(record.cr?' · CR '+record.cr:''),source:record.source}));},
 select:(item,input)=>{const source=input.closest('form').querySelector('#creature-source');if(source){source.value=item.source;source.dispatchEvent(new Event('input',{bubbles:true}));}}
});
