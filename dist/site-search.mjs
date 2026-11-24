import {registerSuggestions} from './search-suggestions.mjs';
import {loadRules,spellKey} from './rules-library.mjs';
import {loadSpellRules} from './spell-rule-store.mjs';
let monsters;
registerSuggestions('.rule-search',{
 options:async input=>{const filter=input.closest('.rule-library').querySelector('.rule-filter').value,saved=filter==='saved'?loadSpellRules():{};return (await loadRules()).spells.filter(spell=>filter==='all'||spell.edition===filter||filter==='saved'&&saved[spellKey(spell)]).map(spell=>({label:spell.name,detail:spell.source+' · '+spell.edition+' · '+(spell.level?'Level '+spell.level:'Cantrip'),id:spellKey(spell)}));},
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
