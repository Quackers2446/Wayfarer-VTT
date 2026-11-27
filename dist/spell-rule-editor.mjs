import {loadRules,formatEntries} from './rules-library.mjs';
import {blankRule,starterRule,ruleId,ruleKey,ruleProblems,damageTypes,conditionsV2,triggers,spellShapes,migrateRule,blockTriggers} from './spell-rule-schema.mjs';
import {loadSpellRules,saveSpellRule,removeSpellRule,importSpellRules,starterRuleFor} from './spell-rule-store.mjs';
import {builtinRule,builtinList} from './spell-library/index.mjs';
import {knownRooms} from './adventure-rooms.mjs';
import {readSession,writeSession} from './multiplayer.mjs';
import {makeActor,newBattle,castSpell,startInitiative,endTurn,exploreToken} from './combat.mjs';
import {nativeSpellDefinitions} from './native-spell-definitions.mjs';
import {moveCustomSphere} from './custom-spells.mjs';
import {escape} from './format.mjs';
import {parseFoundrySpells,convertFoundrySpell,readyFoundryRules} from './foundry-spell-import.mjs';
import {spellAnimations,defaultSpellAnimation,resolveSpellAnimation,spellAnimationMode} from './spell-animation-library.mjs';
import {spellClipBlend} from './zone-visuals.mjs';
import {createSpellRulePreview,previewCastOptions,previewMap} from './spell-rule-preview.mjs';
const draftKey='wayfarer-spell-rule-drafts-v1';
const previewStage=createSpellRulePreview();
const option=(value,label,selected)=>`<option value="${escape(value)}"${selected?' selected':''}>${escape(label)}</option>`;
const input=(label,path,value,{type='number',min=0,max=600,step=1}={})=>`<label>${escape(label)}<input data-rule-field="${path}" type="${type}" value="${escape(value)}"${type==='number'?` min="${min}" max="${max}" step="${step}"`:''}></label>`;
const select=(label,path,value,choices)=>`<label>${escape(label)}<select data-rule-field="${path}">${choices.map(choice=>{const [key,name]=Array.isArray(choice)?choice:[choice,choice];return option(key,name,value===key);}).join('')}</select></label>`;
const check=(label,path,value)=>`<label class="rule-check"><input type="checkbox" data-rule-field="${path}"${value?' checked':''}>${escape(label)}</label>`;
export async function mountSpellRuleEditor(host){
 host.innerHTML='<p>Loading source spells…</p>';let catalog;try{catalog=[...(await loadRules()).spells].sort((a,b)=>a.name.localeCompare(b.name)||a.source.localeCompare(b.source));}catch(error){host.textContent=error.message;return;}if(!host.isConnected)return;
 let saved=loadSpellRules(),drafts={},selected,rule,query='',filter='all',preview,previewLevel=5,previewSlot=1,previewAbility=3,imports=[],importQuery='',animationQuery='';
 try{drafts=JSON.parse(localStorage.getItem(draftKey)||'{}');}catch{}
 const retain=()=>{if(!rule)return;drafts[rule.reference]=structuredClone(rule);try{localStorage.setItem(draftKey,JSON.stringify(drafts));}catch{}};
 const status=text=>{const element=host.querySelector('.rule-status');if(element)element.textContent=text;};
 function homebrewCatalogEntries(){
  const seen=new Set(catalog.map(spell=>ruleId(spell)));
  const extras=[];
  for(const entry of [...Object.values(saved),...Object.values(drafts)]){
   if(!entry?.reference||seen.has(entry.reference))continue;
   if(String(entry.source).toUpperCase()!=='HB'&&!String(entry.reference).startsWith('hb|'))continue;
   seen.add(entry.reference);
   extras.push({name:entry.name,source:entry.source||'HB',edition:entry.edition||'2014',level:entry.level||0,homebrew:true,entries:entry.notes? [entry.notes]:['Homebrew spell. Configure runnable effects or leave casts for manual adjudication.']});
  }
  return extras;
 }
 function builtinCatalogEntries(){
  const seen=new Set(catalog.map(spell=>ruleId(spell)));
  const extras=[];
  for(const rule of builtinList()){
   if(seen.has(rule.reference))continue;
   seen.add(rule.reference);
   extras.push({name:rule.name,source:rule.source||'PHB',edition:rule.edition||'2014',level:rule.level||0,builtinOnly:true,entries:['Built-in combat automation. Source text is not in the local 5etools catalog.']});
  }
  return extras;
 }
 function fullCatalog(){return [...catalog,...builtinCatalogEntries(),...homebrewCatalogEntries()].sort((a,b)=>a.name.localeCompare(b.name)||a.source.localeCompare(b.source));}
 function findCatalogSpell(id){
  return fullCatalog().find(spell=>ruleId(spell)===id)??(()=>{const builtin=builtinRule(id);return builtin?{name:builtin.name,source:builtin.source||'PHB',edition:builtin.edition||'2014',level:builtin.level||0,builtinOnly:true,entries:['Built-in combat automation.']}:null;})();
 }
 function choose(spell){try{retain();selected=spell;const id=ruleId(spell);const base=drafts[id]??saved[id]??starterRuleFor(spell);rule=migrateRule(structuredClone(base));preview=null;previewSlot=Math.max(1,rule.level||1);animationQuery='';render();}catch(error){status(error.message||String(error));}}
 function createHomebrewSpell(){
  const name=window.prompt('Homebrew spell name','Custom Spell')?.trim();
  if(!name)return;
  const level=Number(window.prompt('Spell level (0–9)','1'));
  if(!Number.isInteger(level)||level<0||level>9){status('Spell level must be 0–9.');return;}
  const spell={name,source:'HB',edition:'2014',level,homebrew:true,entries:['Homebrew spell. Add effect blocks to automate combat, or keep it as a manual cast from the sheet.']};
  if(!catalog.some(entry=>ruleId(entry)===ruleId(spell)))catalog.push(spell);
  const starter=migrateRule(blankRule(spell));
  starter.enabled=false;
  starter.importNotes=['Homebrew draft. Edit the starter effect (or replace it), enable when ready, and save. For table-only spells, add the name on a character sheet without saving automation here.'];
  drafts[starter.reference]=starter;
  try{localStorage.setItem(draftKey,JSON.stringify(drafts));}catch{}
  choose(spell);
  rule=starter;
  retain();
  render();
  status('Homebrew spell draft opened. Configure effects, then save. Characters should list source HB for this spell.');
 }
 function summary(){const badge=host.querySelector('.rule-save-state');if(badge)badge.textContent=JSON.stringify(rule)===JSON.stringify(saved[rule.reference])?'Saved':saved[rule.reference]?'Unsaved changes':'Unsaved draft';const p=ruleProblems(rule),target=host.querySelector('.rule-validation');if(target)target.textContent=p.length?p.join(' '):'Ready to test and save.';host.querySelector('[data-rule-action=save]')?.toggleAttribute('disabled',p.length>0);}
 function library(){
 const builtins=new Set(builtinList().map(r=>r.reference));
 const spells=fullCatalog();
 const matches=spells.filter(spell=>{const id=ruleId(spell);const q=!query||(spell.name+' '+spell.source).toLowerCase().includes(query.toLowerCase());if(!q)return false;if(filter==='all')return true;if(filter==='homebrew')return spell.homebrew||String(spell.source).toUpperCase()==='HB'||id.startsWith('hb|');if(filter===spell.edition)return true;if(filter==='saved')return Boolean(saved[id]);if(filter==='builtin')return builtins.has(id);if(filter.startsWith('level:'))return String(spell.level)===filter.slice(6);return true;});
 // Keep Built-in/FX spells near the top of broad lists so they stay in the first page and remain selectable.
 const ranked=filter==='builtin'||filter==='homebrew'?matches:[...matches].sort((a,b)=>{const rank=spell=>{const id=ruleId(spell);if(builtins.has(id))return 0;if(spell.homebrew||String(spell.source).toUpperCase()==='HB')return 2;return 1;};return rank(a)-rank(b)||a.name.localeCompare(b.name)||a.source.localeCompare(b.source);});
 host.querySelector('.rule-spell-list').innerHTML=ranked.slice(0,100).map(spell=>{const id=ruleId(spell);const tags=[spell.source,spell.edition,spell.level?'L'+spell.level:'Cantrip'];if(spell.homebrew||String(spell.source).toUpperCase()==='HB')tags.push('Homebrew');if(builtins.has(id))tags.push('Built-in');if(saved[id])tags.push('Override');if(defaultSpellAnimation(spell.name))tags.push('FX');return `<button type="button" data-rule-select="${escape(id)}" aria-pressed="${rule?.reference===id}"><strong>${escape(spell.name)}</strong><span class="rule-tags">${tags.map(t=>`<span class="rule-tag">${escape(t)}</span>`).join('')}</span></button>`;}).join('')||'<p>No matching spells.</p>';
 host.querySelector('.rule-search-count').textContent=matches.length>100?`Showing 100 of ${matches.length}. Search to narrow.`:`${matches.length} matching · ${builtins.size} built-in`;
 }
 function effects(){return rule.effects.map((effect,i)=>{const rolls=effect.damage??[];return `<section class="rule-section rule-effect"><h3 class="rule-section-title">Effect ${i+1}</h3><div class="rule-fields">
 ${select('Effect type','effects.'+i+'.kind',effect.kind??'damage',[['damage','Damage / condition'],['healing','Healing'],['effect','Status / condition'],['modifier','Attack / save modifier'],['summon','Summon'],['dispel','Dispel'],['teleport','Teleport'],['sleep','Sleep']])}
 ${select('When','effects.'+i+'.trigger',effect.trigger??'cast',blockTriggers.map(key=>[key,{cast:'On cast',enter:'First entry each turn',start:'Start of turn',end:'End of turn',ram:'Sphere rams a creature',step:'Each 5 ft through the area',beam:'Wall beam follow-up'}[key]]))}
 ${select('Affected area','effects.'+i+'.area',effect.area??'footprint',[['footprint','Spell footprint'],['nearby','Within nearby distance'],['hotSide','Wall + chosen hot side']])}
 ${effect.kind==='healing'?check('Exclude undead and constructs',`effects.${i}.excludeUndeadConstructs`,effect.excludeUndeadConstructs):`${select('Saving throw','effects.'+i+'.save',effect.save??'',[['','No save'],...['str','dex','con','int','wis','cha'].map(key=>[key,key.toUpperCase()])])}${select('On successful save','effects.'+i+'.onSave',effect.onSave??'none',[['half','Half damage'],['none','No damage']])}${select('Condition on failed save','effects.'+i+'.condition',effect.condition??'',conditionsV2.map(value=>[value,value||'No condition']))}`}${effect.status?.name?`<p class="rule-builtin-banner">Status: ${escape(effect.status.name)}${effect.status.riders?.length?' · includes attack riders':''}${effect.status.resist?.length?' · resistance':''}</p>`:''}</div>
 ${effect.kind==='modifier'?`<div class="rule-fields">${input('Attack roll modifier',`effects.${i}.modifiers.attack`,effect.modifiers?.attack??'1d4',{type:'text'})}${input('Saving throw modifier',`effects.${i}.modifiers.save`,effect.modifiers?.save??'1d4',{type:'text'})}</div>`:''}${rolls.map((damage,j)=>`<div class="rule-damage-row">${input(effect.kind==='healing'?'Healing dice':'Damage dice',`effects.${i}.damage.${j}.formula`,damage.formula,{type:'text'})}${effect.kind==='healing'?'':select('Damage type',`effects.${i}.damage.${j}.type`,damage.type,damageTypes)}${input(rule.level===0?'Extra dice per cantrip tier':'Extra per slot above base',`effects.${i}.damage.${j}.upcast`,damage.upcast,{type:'text'})}<button type="button" class="button outline small" data-rule-action="remove-damage" data-index="${i}" data-component="${j}">Remove roll</button></div><div class="rule-checks">${check('Add spellcasting ability modifier',`effects.${i}.damage.${j}.addAbility`,damage.addAbility)}${rule.level===0?check('Scale at caster levels 5, 11 and 17',`effects.${i}.damage.${j}.scaleWithCaster`,damage.scaleWithCaster):''}</div>`).join('')}
 <div class="rule-buttons"><button type="button" class="button outline small" data-rule-action="add-damage" data-index="${i}">Add dice component</button><button type="button" class="button outline small" data-rule-action="remove-effect" data-index="${i}">Remove effect</button></div></section>`;}).join('');}
 function animationMode(){return spellAnimationMode(rule.visual);}
 function filteredAnimationClips(){
  const needle=animationQuery.trim().toLowerCase();
  const key=ruleKey(rule.name);
  const matchedIds=new Set(spellAnimations.filter(clip=>clip.spells.includes(key)).map(clip=>clip.id));
  const scored=spellAnimations.filter(clip=>{
   if(!needle)return true;
   const hay=[clip.label,clip.id,clip.kind,...(clip.spells??[])].join(' ').toLowerCase();
   return hay.includes(needle);
  });
  return {relevant:scored.filter(clip=>matchedIds.has(clip.id)),other:scored.filter(clip=>!matchedIds.has(clip.id)),total:scored.length};
 }
 function animationListHtml(){
  const {relevant,other,total}=filteredAnimationClips();
  const limit=80;let shown=0;
  const renderClip=clip=>{
   if(shown>=limit)return'';
   shown+=1;
   const selected=rule.visual?.url===clip.url;
   const local=clip.url.startsWith('/');
   return `<button type="button" class="rule-animation-clip" data-animation-pick="${escape(clip.id)}" aria-pressed="${selected}"><strong>${escape(clip.label)}</strong><span class="rule-tags"><span class="rule-tag">${escape(clip.kind)}</span>${local?'<span class="rule-tag">Local</span>':''}${clip.spells.slice(0,2).map(name=>`<span class="rule-tag">${escape(name)}</span>`).join('')}</span></button>`;
  };
  const parts=[];
  if(relevant.length)parts.push(`<p class="rule-animation-group">Matched to this spell</p>${relevant.map(renderClip).join('')}`);
  if(other.length&&shown<limit)parts.push(`<p class="rule-animation-group">${relevant.length?'Other catalogue clips':'Catalogue clips'}</p>${other.map(renderClip).join('')}`);
  if(!parts.length)return'<p class="rule-animation-empty">No clips match that search.</p>';
  return parts.join('')+(total>limit?`<p class="rule-animation-more">Showing ${limit} of ${total}. Narrow the search.</p>`:'');
 }
 function animationPanel(){
  const mode=animationMode();
  const auto=defaultSpellAnimation(rule.name,rule);
  const selectedClip=mode==='catalogue'?spellAnimations.find(clip=>clip.url===rule.visual?.url):null;
  const homebrew=String(rule.source).toUpperCase()==='HB'||String(rule.reference).startsWith('hb|');
  const hint=homebrew&&!auto?.url?'<p class="rule-animation-hint">Homebrew names rarely auto-match. Pick a catalogue clip so casts and the test board play a video.</p>':'';
  const details=mode==='catalogue'||mode==='custom'?`<div class="rule-fields">${input('Animation video URL','visual.url',rule.visual?.url??'',{type:'text'})}${select('Playback style','visual.kind',rule.visual?.kind??'burst',[['burst','Burst at target / chosen point'],['ray','Ray (JB2A 30 ft clip layout)'],['cone','Cone from caster'],['line','Line / wall']])}${input('Animation scale','visual.scale',rule.visual?.scale??1,{min:.25,max:8,step:.25})}${input('Maximum playback (ms)','visual.duration',rule.visual?.duration??2500,{min:200,max:10000})}</div>`:'';
  const picker=mode==='catalogue'?`<label>Search clips<input class="rule-animation-search" type="search" value="${escape(animationQuery)}" placeholder="Clip name, linked spell, or id"></label><p class="rule-animation-selected">${selectedClip?'Selected · '+escape(selectedClip.label):'No clip selected yet — choose one below.'}</p><div class="rule-animation-list">${animationListHtml()}</div>`:'';
  return `<section class="rule-section"><h3 class="rule-section-title">Spell animation</h3><label>Animation mode<select class="rule-animation-mode"><option value="auto"${mode==='auto'?' selected':''}>Automatic${auto?' — '+escape(auto.label||'built-in color'):' — no matching free clip'}</option><option value="catalogue"${mode==='catalogue'?' selected':''}>Pick from catalogue</option><option value="none"${mode==='none'?' selected':''}>No animation</option><option value="custom"${mode==='custom'?' selected':''}>Custom video URL</option></select></label>${hint}<p>Included animations by <a href="https://jb2a.com/" target="_blank" rel="noopener">JB2A — Jules &amp; Ben</a>, <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>. <a href="/assets/animations/credits.json" target="_blank" rel="noopener">Sources and credits</a>.</p><p>Optional video played after the dice and before damage appears. Matching effects are selected automatically; catalogue picks persist on the spell rule for homebrew and overrides.</p>${picker}${details}<button type="button" class="button outline small" data-rule-action="preview-video">Preview video</button><div class="rule-video-preview"></div></section>`;
 }
 function targetingFields(){
 const native=rule.nativeKey&&nativeSpellDefinitions[rule.nativeKey];
 if(native){
  const target=native.teleport?'Map destination':native.cone?'Cone direction':native.area?'Map point · '+native.area+' ft radius':native.self?'Self':'Creature';
  return `<section class="rule-section"><h3 class="rule-section-title">Targeting &amp; casting</h3><p>${target}${native.range?' · '+native.range+' ft range':''} · ${native.bonus?'Bonus action':'Action'}</p><p>Set by the built-in spell library.</p></section>`;
 }
 const shape=rule.shape;
 return `<section class="rule-section"><h3 class="rule-section-title">Targeting &amp; casting</h3><div class="rule-fields">
 ${select('Casting cost','timing',rule.timing,[['action','Action'],['bonus','Bonus action'],['reaction','Reaction']])}
 ${select('Targeting','shape',shape,[['creature','Creature'],['target','Creature (legacy)'],['self','Self'],['point','Map point'],['circle','Circle / cylinder'],['cube','Cube'],['cone','Cone'],['line','Line'],['wall','Wall'],['ring','Ring'],['aura','Aura (follows caster)'],['movable','Movable sphere'],['sphere','Movable sphere (legacy)']])}
 ${shape!=='self'?input('Range (ft)','range',rule.range):''}
 ${shape==='target'?input('Base creature targets','targets.base',rule.targets?.base??1,{min:1,max:8})+input('Extra targets per higher slot','targets.perSlot',rule.targets?.perSlot??0,{min:0,max:3}):''}
 ${['circle','cone','ring','sphere'].includes(shape)?input(shape==='cone'?'Cone length (ft)':'Radius (ft)', 'radius',rule.radius,{max:100}):''}
 ${shape==='line'?input('Wall length (ft)','length',rule.length,{max:120}):''}
 </div>${shape==='target'?check('Uses a spell attack roll','attack',rule.attack):''}
 ${['point','circle','ring','sphere','line'].includes(shape)?'<p>Choose a square on the map within range. The square can be empty.</p>':''}</section>`;
 }
 function render(){
 host.innerHTML=`<section class="spell-rule-desk" aria-label="Spell library editor"><header class="rule-page-heading"><div><h1>Spell library</h1><p>Browse built-in combat automation, tweak a spell, create homebrew rules, and push overrides into a room.</p></div><div class="rule-buttons"><button class="button outline small" type="button" data-rule-action="create-homebrew">New homebrew spell</button><button class="button outline small" type="button" data-rule-action="export">Export library</button><button class="button outline small" type="button" data-rule-action="import">Import library</button><input type="file" accept="application/json,.json" class="rule-import" hidden></div></header>
 <details class="rule-foundry-import"${imports.length?' open':''}><summary>Import Foundry spells</summary><p>Choose a spell JSON export or text .db compendium. Spells with a runnable implementation can be imported together. Others show the missing capabilities and can be opened as drafts. Existing saved rules are preserved. Foundry scripts are not run.</p><label>Foundry spell file<input type="file" class="rule-foundry-file" accept=".json,.db,application/json"></label>${imports.length?`<label>Search imported spells<input class="rule-import-search" type="search" value="${escape(importQuery)}" placeholder="Spell name"></label><p>${imports.length} spells read · ${imports.filter(entry=>entry.status==='ready').length} ready to play · ${imports.filter(entry=>entry.status!=='ready').length} need support or source matching</p><button type="button" class="button primary small" data-rule-action="import-ready">Import runnable spells</button><div class="rule-import-list"></div>`:''}</details>
 <div class="rule-workspace"><aside class="rule-library" aria-label="Source spells"><label>Search spells<input class="rule-search" type="search" value="${escape(query)}" placeholder="Spell name or source"></label><label>Show<select class="rule-filter">${[['all','All spells'],['homebrew','Homebrew'],['builtin','Built-in automation'],['saved','Your overrides'],['2014','2014'],['2024','2024'],['level:0','Cantrips'],['level:1','Level 1'],['level:2','Level 2'],['level:3','Level 3'],['level:4','Level 4'],['level:5','Level 5']].map(([value,name])=>option(value,name,value===filter)).join('')}</select></label><p class="rule-search-count"></p><div class="rule-spell-list"></div></aside>
 <div class="rule-editor-main">${rule?`<header class="rule-selected-heading"><div><h2>${escape(rule.name)}</h2><p>${escape(selected.source)} · ${escape(rule.edition)} · ${rule.level?'Level '+rule.level:'Cantrip'} · <span class="rule-save-state"></span></p></div>${check('Enabled','enabled',rule.enabled)}</header>
 ${rule.importNotes?.length?`<aside class="rule-import-review" aria-label="Foundry import review"><h3>Review this import</h3><ul>${rule.importNotes.map(note=>`<li>${escape(note)}</li>`).join('')}</ul></aside>`:''}
 <details class="rule-source"><summary>Read source spell</summary>${formatEntries(selected.entries)}${formatEntries(selected.entriesHigherLevel)}</details>
 ${animationPanel()}
 ${rule.nativeKey?'<p class="rule-import-review">This import uses Wayfarer’s existing spell implementation, including its special targeting and scaling. Animation settings can be changed here.</p>':builtinRule(rule.reference)&&!saved[rule.reference]?'<p class="rule-builtin-banner">Built-in automation is active for this spell. Saving creates a personal override; rooms keep using the built-in until you apply the library.</p>':''}${targetingFields()}<div${rule.nativeKey?' hidden':''}>
 <section class="rule-section"><h3 class="rule-section-title">Duration &amp; map effect</h3><div class="rule-fields">${input('Duration (seconds)','duration',rule.duration,{max:86400})}${input('Nearby distance (ft)','nearby',rule.nearby,{max:30})}${input('Sphere movement per bonus action (ft)','move',rule.move,{max:60})}</div><div class="rule-checks">${check('Leave a persistent area','persistent',rule.persistent)}${check('Requires concentration','concentration',rule.concentration)}${check('Ends after caster’s next turn','endNextTurn',rule.endNextTurn)}${check('Difficult terrain','difficult',rule.difficult)}${check('Blocks vision (not physical movement)','blocksVision',rule.blocksVision)}${check('Deflects ranged weapon attacks','blocksRanged',rule.blocksRanged)}${check('Blocks physical movement','blocksMovement',rule.blocksMovement)}</div></section>
 <div class="rule-effects">${effects()}</div><button class="button outline small" type="button" data-rule-action="add-effect">Add effect block</button>
 </div><p class="rule-validation" role="status"></p><div class="rule-buttons"><button type="button" class="button primary" data-rule-action="save">Save rules</button><button type="button" class="button outline" data-rule-action="starter">Restore starter</button>${saved[rule.reference]?'<button type="button" class="button outline" data-rule-action="revert">Revert to saved</button><button type="button" class="button outline" data-rule-action="delete">Remove saved override</button>':''}</div>
 <section class="rule-preview" aria-label="Spell test encounter"><h3>Test encounter</h3><p>Private board for these draft rules — dice are off so cast videos and persistent-zone loops play immediately. Your characters and rooms stay untouched.</p><div class="rule-fields"><label>Caster level<input data-preview-field="level" type="number" min="1" max="20" value="${previewLevel}"></label>${rule.level?`<label>Spell slot level<input data-preview-field="slot" type="number" min="${rule.level}" max="9" value="${previewSlot}"></label>`:''}<label>Spellcasting modifier<input data-preview-field="ability" type="number" min="-5" max="10" value="${previewAbility}"></label></div><div class="rule-preview-stage"><div class="board-frame rule-preview-board" style="--map-ratio:${previewMap.width}/${previewMap.height}"><div class="rule-preview-grid" id="rule-preview-grid"><canvas class="board-raster" width="${previewMap.width}" height="${previewMap.height}" aria-label="Spell test board"></canvas></div><div class="combat-cues" aria-live="polite" aria-atomic="true"></div></div></div><div class="rule-buttons"><button type="button" class="button outline small" data-rule-action="test">Test cast</button><button type="button" class="button outline small" data-rule-action="next-turn">Advance turns</button><button type="button" class="button outline small" data-rule-action="test-move">Test entering area</button>${['sphere','movable'].includes(rule.shape)?'<button type="button" class="button outline small" data-rule-action="test-ram">Test sphere ram</button>':''}</div><div class="rule-preview-results" role="log">No test run yet.</div></section>
 <section class="rule-publish"><h3>Apply saved library to a room</h3><p>New rooms use your saved library. Update an existing room here between encounters. Existing spell areas keep the rules they were cast with.</p><label>Adventure room<select class="rule-room"><option value="">Choose a saved room</option>${knownRooms().map(room=>option(room.id,room.name,false)).join('')}</select></label><button type="button" class="button outline small" data-rule-action="publish">Apply saved rules</button></section>`:'<p>Choose a source spell to begin.</p>'}
 <p class="rule-status" role="status"></p><p class="rule-editor-note">The editor supports the listed grid effects. Heights, vertical flight, unusual interactions and effects without a matching block still require manual adjudication.</p></div></div></section>`;
 library();importList();summary();drawPreview();
 }
 function importList(){const list=host.querySelector('.rule-import-list');if(!list)return;const matches=imports.map((entry,index)=>({entry,index})).filter(({entry})=>entry.name.toLowerCase().includes(importQuery.toLowerCase()));list.innerHTML=matches.slice(0,100).map(({entry,index})=>`<div><strong>${escape(entry.name)}</strong><small>${entry.status==='ready'?'Ready to play':'Needs support / review'}</small> ${entry.rule?`<button type="button" class="button outline small" data-rule-import-index="${index}">${entry.status==='ready'?'Open spell':'Review limitations'}</button>`:`<small>${escape(entry.notes[0])}</small>`}</div>`).join('')+(matches.length>100?'<p>Showing the first 100 results. Search to narrow the list.</p>':matches.length?'':'<p>No matching imported spells.</p>');}
 function drawPreview(){
  if(!rule){previewStage.reset();return;}
  const stage=host.querySelector('.rule-preview-stage');
  const idleActors=[{id:'preview-caster',name:'Test caster',side:'party',x:2,y:6,hp:60,maxHp:60},{id:'preview-target',name:'Test target',side:'hostile',x:10,y:6,hp:60,maxHp:60},{id:'preview-other',name:'Nearby target',side:'hostile',x:11,y:7,hp:60,maxHp:60}];
  previewStage.mount(stage,preview?.battle??null,{
   map:previewMap,
   selected:preview?.caster?.id??'preview-caster',
   footprint:previewStage.footprintFor(rule),
   actors:preview?.battle?undefined:idleActors,
  });
 }
 function test(action){
  if(ruleProblems(rule).length){status(ruleProblems(rule).join(' '));return;}
  try{
   if(action==='test'||!preview){
    const battle=newBattle();
    const caster=makeActor({id:'preview-caster',name:'Test caster',side:'party',x:2,y:6,hp:60,maxHp:60,initiative:100,level:previewLevel,spellAbility:previewAbility,spellDC:15,spellAttack:7,slots:{[previewSlot]:{current:3,maximum:3}}});
    const wallish=['wall','line'].includes(rule.shape);
    const target=makeActor({id:'preview-target',name:'Test target',x:rule.shape==='target'||rule.shape==='creature'?2+Math.min(8,Math.floor(rule.range/5)):wallish?8:10,y:6,hp:rule.effects.some(effect=>effect.kind==='healing')||['cure wounds','healing word'].includes(rule.nativeKey)?10:60,maxHp:60,ac:12,saves:{dex:0}});
    const other=makeActor({id:'preview-other',name:'Nearby target',x:11,y:7,hp:60,maxHp:60,saves:{dex:2}});
    battle.actors=[caster,target,other];
    battle.spellRules={[rule.reference]:structuredClone(rule)};
    startInitiative(battle,()=>.45);
    const cast=previewCastOptions(rule);
    castSpell(battle,caster,['target','creature'].includes(rule.shape)&&!nativeSpellDefinitions[rule.nativeKey]?.area?target:null,{name:rule.name,key:rule.name.toLowerCase(),reference:rule.reference,edition:rule.edition,level:rule.level},rule.level?previewSlot:0,cast,()=>.45);
    preview={battle,map:previewMap,caster,target};
   }
   else if(action==='next-turn'){for(let i=0;i<3;i++)endTurn(preview.battle,()=>.45);}
   else if(action==='test-ram'){preview.battle.bonusUsed=false;const zone=preview.battle.spellZones?.find(zone=>zone.custom);moveCustomSphere(preview.battle,preview.caster,zone?.id,{x:preview.target.x,y:preview.target.y},preview.map,()=>.45);}
   else{preview.battle.round=0;preview.target.x=6;preview.target.y=6;exploreToken(preview.battle,preview.target,['wall','line'].includes(rule.shape)?8:9,6,preview.map,()=>false);}
   const result=host.querySelector('.rule-preview-results');result.textContent=preview.battle.log.slice(-18).join('\n')+'\nCaster level: '+previewLevel+(rule.level?' · Slot level: '+previewSlot+' · Slots remaining: '+preview.caster.slots[previewSlot].current:' · Cantrip (no slot)');drawPreview();
  }catch(error){host.querySelector('.rule-preview-results').textContent=error.message;}
 }
 host.addEventListener('input',event=>{if(event.target.dataset.previewField){const field=event.target.dataset.previewField,value=Number(event.target.value);if(!Number.isInteger(value)||!event.target.checkValidity())return;if(field==='level')previewLevel=value;else if(field==='slot')previewSlot=value;else previewAbility=value;preview=null;host.querySelector('.rule-preview-results').textContent='Preview settings changed. Test cast to see the result.';drawPreview();return;}if(event.target.matches('.rule-import-search')){importQuery=event.target.value;importList();return;}if(event.target.matches('.rule-search')){query=event.target.value;library();return;}if(event.target.matches('.rule-animation-search')){animationQuery=event.target.value;const list=host.querySelector('.rule-animation-list');if(list)list.innerHTML=animationListHtml();return;}const path=event.target.dataset.ruleField;if(!path)return;if(path.startsWith('targets.')&&!rule.targets)rule.targets={base:1,perSlot:0};if(path.startsWith('visual.')&&!rule.visual)rule.visual={url:'',kind:'burst',scale:1,duration:2500,mode:'custom'};const parts=path.split('.');let value=rule;for(const part of parts.slice(0,-1))value=value[part];value[parts.at(-1)]=event.target.type==='checkbox'?event.target.checked:event.target.type==='number'?Number(event.target.value):event.target.value;if(path.startsWith('visual.')&&animationMode()==='custom')rule.visual.mode='custom';if(path==='shape'){
 if(rule.shape!=='target'){delete rule.targets;rule.attack=false;}
 retain();preview=null;render();host.querySelector('[data-rule-field=shape]')?.focus();return;
 }if(path.startsWith('effects.')&&path.endsWith('.kind')){if(value.kind==='modifier'){value.modifiers={attack:'1d4',save:'1d4'};value.damage=[];value.condition='';rule.attack=false;if(!rule.duration)rule.duration=60;}else if(value.kind==='healing'){value.save='';value.condition='';value.excludeUndeadConstructs=rule.edition==='2014';rule.attack=false;}retain();preview=null;render();return;}retain();preview=null;summary();drawPreview();});
 host.addEventListener('change',event=>{if(event.target.matches('.rule-animation-mode')){const mode=event.target.value;if(mode==='auto')delete rule.visual;else if(mode==='none')rule.visual={url:'',kind:'burst',scale:1,duration:2500};else if(mode==='catalogue'){const key=ruleKey(rule.name);rule.visual=structuredClone(spellAnimations.find(clip=>clip.url===rule.visual?.url)??spellAnimations.find(clip=>clip.spells.includes(key)&&clip.url.startsWith('/'))??spellAnimations.find(clip=>clip.url.startsWith('/'))??spellAnimations[0]??{url:'',kind:'burst',scale:1,duration:2500});}else rule.visual={url:rule.visual?.url?.startsWith('https')?rule.visual.url:'',kind:rule.visual?.kind??'burst',scale:rule.visual?.scale??1,duration:rule.visual?.duration??2500,mode:'custom'};retain();render();}if(event.target.matches('.rule-foundry-file'))void(async()=>{try{const file=event.target.files[0];if(!file||file.size>10*1024*1024)throw Error('Choose a Foundry export up to 10 MB.');imports=parseFoundrySpells(await file.text()).map(item=>convertFoundrySpell(item,catalog));importQuery='';render();status('Foundry spells loaded. Choose Review draft to inspect a spell.');}catch(error){status(error.message);}})();if(event.target.matches('.rule-filter')){filter=event.target.value;library();}if(event.target.matches('.rule-import'))void(async()=>{try{const file=event.target.files[0];if(!file||file.size>1024*1024)throw Error('Choose a rules JSON file up to 1 MB.');importSpellRules(JSON.parse(await file.text()));saved=loadSpellRules();render();status('Rules imported. Rooms keep their current versions until you apply an update.');}catch(error){status(error.message);}})();});
 host.addEventListener('click',event=>{const imported=event.target.closest('[data-rule-import-index]');if(imported){const entry=imports[Number(imported.dataset.ruleImportIndex)];if(entry?.rule){choose(entry.spell);rule=structuredClone(entry.rule);rule.importNotes=[...entry.notes];retain();render();status(entry.status==='ready'?'Runnable spell opened. Save it or use Import runnable spells to add all supported entries.':'Partial import opened. Listed capabilities need support before this can replace existing rules.');}return;}const choice=event.target.closest('[data-rule-select]');if(choice){const spell=findCatalogSpell(choice.dataset.ruleSelect);if(spell)choose(spell);return;}const clipPick=event.target.closest('[data-animation-pick]');if(clipPick){const clip=spellAnimations.find(entry=>entry.id===clipPick.dataset.animationPick);if(clip){rule.visual=structuredClone(clip);retain();render();host.querySelector(`[data-animation-pick="${CSS.escape(clip.id)}"]`)?.focus();}return;}const control=event.target.closest('[data-rule-action]');if(!control)return;const action=control.dataset.ruleAction,index=Number(control.dataset.index),component=Number(control.dataset.component);
  try{
   if(action==='create-homebrew'){createHomebrewSpell();return;}
   if(action==='import-ready'){const ready=readyFoundryRules(imports,saved),count=Object.keys(ready).length;if(count){importSpellRules(ready);saved=loadSpellRules();for(const [id,value] of Object.entries(ready))drafts[id]=structuredClone(value);if(ready[rule.reference])rule=structuredClone(ready[rule.reference]);retain();render();}status(count+' runnable spells imported. Existing overrides were preserved. Apply the saved library to a room to use new rules there.');}
   else if(action==='preview-video'){const errors=ruleProblems(rule).filter(message=>message.includes('animation'));if(errors.length)throw Error(errors.join(' '));const visual=resolveSpellAnimation(rule.name,rule);if(visual?.builtin)throw Error('This built-in effect plays on the game board. Choose a catalogue clip to preview a video here.');if(!visual?.url)throw Error('Choose an animation video URL first.');const video=document.createElement('video');video.src=visual.url;video.controls=true;video.muted=true;video.playsInline=true;const blend=spellClipBlend(visual,visual.id??rule.name);if(blend)video.dataset.blend=blend;video.addEventListener('error',()=>status('This animation could not be loaded. Check the video URL and its hosting permissions.'),{once:true});host.querySelector('.rule-video-preview').replaceChildren(video);void video.play().catch(()=>{});}
   else if(action==='save'){const savedRule=saveSpellRule(rule);saved=loadSpellRules();rule=structuredClone(savedRule);retain();render();status('Saved. New rooms use this version. Apply the library below to update an existing room.');}
   else if(action==='revert'){rule=structuredClone(saved[rule.reference]);retain();render();status('Restored the saved version.');}
   else if(action==='starter'){rule=migrateRule(starterRuleFor(selected));retain();render();}
   else if(action==='delete'){removeSpellRule(rule.reference);saved=loadSpellRules();delete drafts[rule.reference];rule=migrateRule(starterRuleFor(selected));retain();render();status('Saved override removed. Existing rooms keep their saved copies.');}
   else if(action==='add-effect'){if(rule.effects.length>=12)throw Error('Use up to 12 effect blocks.');rule.effects.push(structuredClone(blankRule(selected).effects[0]));retain();render();}
   else if(action==='remove-effect'){rule.effects.splice(index,1);retain();render();}
   else if(action==='add-damage'){const block=rule.effects[index];block.damage??=[];if(block.damage.length>=4)throw Error('Use up to four damage components.');block.damage.push({formula:'1d6',type:'fire',upcast:''});retain();render();}
   else if(action==='remove-damage'){(rule.effects[index].damage??[]).splice(component,1);retain();render();}
   else if(action==='export'){const blob=new Blob([JSON.stringify(loadSpellRules(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='wayfarer-spell-rules.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
   else if(action==='import')host.querySelector('.rule-import').click();
   else if(action==='publish')void(async()=>{const id=host.querySelector('.rule-room').value;if(!id){status('Choose a room.');return;}control.disabled=true;status('Updating room rules…');try{for(let attempt=0;attempt<3;attempt++){const snapshot=await readSession(id);if(snapshot.state.battle.round)throw Error('Finish this room’s combat before updating spell rules.');snapshot.state.battle.spellRules=structuredClone(loadSpellRules());const result=await writeSession(id,snapshot.revision,snapshot.state);if(!result.state){status('Room updated. Future casts use the saved library.');return;}}throw Error('The room is busy. Try again after the next action.');}catch(error){status(error.message);}finally{control.disabled=false;}})();
   else test(action);
  }catch(error){status(error.message);}
 });
 if(sessionStorage.getItem('wayfarer-create-homebrew-spell')){sessionStorage.removeItem('wayfarer-create-homebrew-spell');createHomebrewSpell();if(rule)return;}
 const first=catalog.find(spell=>spell.name==='Wall of Fire'&&spell.source==='PHB')??catalog[0];choose(first);
}
