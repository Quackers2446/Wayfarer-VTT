import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spellAnimations,defaultSpellAnimation,resolveSpellAnimation,spellAnimationMode,spellAnimationSuppressed,breathAnimation,spellVisualEvent} from '../dist/spell-animation-library.mjs';
import {spellVisualValid,blankRule,migrateRule,ruleProblems} from '../dist/spell-rule-schema.mjs';
import {animationSourceRevision} from '../dist/spell-animation-index.mjs';
import {builtinList} from '../dist/spell-library/index.mjs';
assert.match(animationSourceRevision,/^[a-f0-9]{40}$/);
assert.ok(spellAnimations.length>300);
assert.equal(new Set(spellAnimations.map(clip=>clip.id)).size,spellAnimations.length);
for(const clip of spellAnimations){assert.ok(clip.spells.length);assert.ok(spellVisualValid(clip),clip.label);if(clip.url.startsWith('https:'))assert.ok(clip.url.includes(animationSourceRevision));assert.ok(!clip.url.includes('/TMFX/'));}
for(const name of ['Fireball','Burning Hands','Cone of Cold','Ray of Frost','Wall of Fire','Black Tentacles','Evard’s Black Tentacles','Bigby’s Hand','Arcane Hand','Healing Word'])assert.ok(defaultSpellAnimation(name),name);
assert.equal(defaultSpellAnimation('Burning Hands').kind,'cone');
assert.equal(defaultSpellAnimation('Wall of Fire').kind,'line');
assert.equal(defaultSpellAnimation('Spirit Guardians').anchor,'caster');
assert.match(defaultSpellAnimation('Wall of Fire',{shape:'ring'}).url,/ring/i);
assert.equal(defaultSpellAnimation('Invented Spell'),undefined);
console.log(spellAnimations.length+' video variants automatically match their spells; aliases, caster/target anchors, cone/wall defaults and pinned sources verified.');

const {nativeSpellDefinitions}=await import('../dist/native-spell-definitions.mjs');
const names=[...Object.entries(nativeSpellDefinitions).filter(([,spell])=>(spell.level??0)<=4).map(([name])=>name),
 'bless','bane','flaming sphere','ice storm','wall of fire'];
for(const name of names){
 const visual=defaultSpellAnimation(name);
 assert.ok(visual?.url||visual?.builtin,name+' has a runnable effect');
 assert.ok(spellVisualValid(visual),name);
 if(visual.url?.startsWith('/'))assert((await readFile(new URL('../dist'+visual.url,import.meta.url))).length>1000);
}
for(const type of ['acid','cold','fire','lightning','poison'])assert.equal(breathAnimation(type).kind,'cone');
const caster={x:1,y:2},target={x:2,y:2},ally={x:3,y:2};
const bless=spellVisualEvent(defaultSpellAnimation('Bless'),caster,target,{targets:[ally]});
assert.equal(bless.visualTargets[0].x,3);
assert.equal(spellVisualEvent(breathAnimation('poison'),caster,target,{square:ally}).visualPoint.x,1);
const fallback=defaultSpellAnimation('My custom ray',{attack:true,shape:'target',level:4,effects:[{kind:'damage',damage:[{type:'cold'}]}]});
assert.equal(fallback.kind,'ray');assert.equal(fallback.builtin,'cold');
console.log(names.length+' supported spells and cast actions covered, with directed breath and multi-target effects.');

// Every built-in combat spell resolves to a local video clip.
const builtins=builtinList();
for(const rule of builtins){
 const visual=defaultSpellAnimation(rule.name,rule);
 assert.ok(visual?.url?.startsWith('/assets/animations/'),rule.name+' should use a bundled video');
 assert.ok(spellVisualValid(visual),rule.name);
 assert((await readFile(new URL('../dist'+visual.url,import.meta.url))).length>1000,rule.name+' clip exists');
}
assert.equal(defaultSpellAnimation('Tasha\'s Caustic Brew',builtins.find(r=>r.name==="Tasha's Caustic Brew")).kind,'line');
assert.equal(defaultSpellAnimation('Chill Touch',builtins.find(r=>r.name==='Chill Touch')).kind,'ray');
assert.equal(defaultSpellAnimation('Fear',builtins.find(r=>r.name==='Fear')).kind,'cone');
console.log(builtins.length+' built-in spells have local animation clips.');

// Scenario coverage: wall vs ring, distance variants, sphere move footprint.
{
  const {pickDistanceClip,allowsWallRing,formRule,spellVisualEvent,clipFeet}=await import('../dist/spell-animation-library.mjs');
  const {customSpellRule}=await import('../dist/spell-rule-store.mjs');
  const {setup,map}=await import('./spell-test-kit.mjs');
  const {moveCustomSphere}=await import('../dist/custom-spells.mjs');
  const wall=customSpellRule('phb|wall of fire',{});
  assert.ok(allowsWallRing(wall),'Wall of Fire can be cast as a ring');
  assert.match(defaultSpellAnimation('Wall of Fire',formRule(wall,'wall')).url,/yellow-300x100/);
  assert.doesNotMatch(defaultSpellAnimation('Wall of Fire',formRule(wall,'wall')).url,/yellow-500x100/);
  assert.match(defaultSpellAnimation('Wall of Fire',formRule(wall,'ring')).url,/ring/i);
  const bolts=spellAnimations.filter(clip=>clip.spells.includes('fire bolt')&&clip.kind==='ray');
  assert.equal(clipFeet(pickDistanceClip(bolts,5)),5,'short Fire Bolt uses a 5 ft clip');
  assert.equal(clipFeet(pickDistanceClip(bolts,45)),60,'mid Fire Bolt steps up to 60 ft');
  assert.equal(clipFeet(pickDistanceClip(bolts,100)),90,'long Fire Bolt uses the longest clip');
  const line=setup('phb|wall of fire');
  line.cast(null,{square:{x:4,y:10},end:{x:10,y:10},form:'wall'});
  const lineEvent=line.battle.actionEvents.at(-1);
  assert.equal(lineEvent.visual.kind,'line');
  assert.equal(lineEvent.visualEnd,true);
  assert.equal(line.battle.spellZones.at(-1).rule.shape,'wall');
  const ring=setup('phb|wall of fire');
  ring.cast(null,{square:{x:6,y:10},form:'ring',hotSide:'inside'});
  const ringEvent=ring.battle.actionEvents.at(-1);
  assert.match(ringEvent.visual.url,/ring/i);
  assert.equal(ringEvent.visualDiameter,4);
  assert.equal(ring.battle.spellZones.at(-1).rule.shape,'ring');
  const near=setup('phb|scorching ray',{targets:[{x:3,y:10,ac:5}]});
  near.cast(near.targets[0]);
  assert.equal(near.battle.actionEvents.at(-1).visualClipFeet,5);
  assert.equal(near.battle.actionEvents.at(-1).attackDistance,5);
  const sphere=setup('phb|flaming sphere',{targets:[{x:10,y:10}]});
  sphere.cast(null,{square:{x:5,y:10}});
  assert.equal(sphere.battle.actionEvents.at(-1).visualDiameter,1,'sphere cast is one square');
  const zone=sphere.battle.spellZones.at(-1);
  sphere.fresh();
  moveCustomSphere(sphere.battle,sphere.caster,zone.id,{x:7,y:10},map);
  const moved=sphere.battle.actionEvents.at(-1);
  assert.equal(moved.visualDiameter,1,'sphere move keeps the footprint');
  assert.equal(moved.visualFrom.x,5);
  assert.equal(moved.visualPoint.x,7);
  assert.equal(moved.attackDistance,10);
  const cone=setup('phb|burning hands',{targets:[{x:4,y:10}]});
  cone.cast(null,{square:{x:6,y:10}});
  assert.equal(cone.battle.actionEvents.at(-1).visual.kind,'cone');
  assert.equal(cone.battle.actionEvents.at(-1).visualLength,3);
  const bolt=setup('phb|lightning bolt',{targets:[{x:8,y:10}]});
  bolt.cast(null,{square:{x:8,y:10}});
  assert.equal(bolt.battle.actionEvents.at(-1).visual.kind,'line');
  assert.equal(bolt.battle.actionEvents.at(-1).visualLength,20);
  console.log('Wall/ring forms, distance-picked rays, cones, lines and flaming-sphere moves verified.');
}

// Persistent-zone looping overlays cover every built-in persistent spell.
{
  const {zoneLoopVisual, zoneDiameter} = await import('../dist/zone-visuals.mjs');
  const {zoneLoopCatalog, zoneLoopDownloads} = await import('../dist/zone-loop-catalog.mjs');
  const {access} = await import('node:fs/promises');
  for (const clip of zoneLoopCatalog) {
    assert.ok(spellVisualValid(clip), clip.id);
    assert.equal(clip.loop, true);
    if (clip.url.startsWith('/')) {
      await access(new URL('../dist' + clip.url, import.meta.url));
      assert((await readFile(new URL('../dist' + clip.url, import.meta.url))).length > 1000, clip.id);
    }
  }
  for (const clip of zoneLoopDownloads) assert.ok(clip.source?.includes('JB2A_DnD5e'));
  const persistent = builtins.filter((rule) => rule.persistent);
  assert.ok(persistent.length >= 20, 'expected the persistent built-in set');
  for (const rule of persistent) {
    const zone = {id: 'z-' + rule.reference, name: rule.name, rule, square: {x: 5, y: 5}, cells: ['5:5', '6:5']};
    const visual = zoneLoopVisual(zone);
    assert.ok(visual?.url?.startsWith('/assets/animations/'), rule.name + ' zone loop');
    assert.ok(spellVisualValid(visual), rule.name + ' zone visual');
    assert.equal(visual.loop, true);
    assert((await readFile(new URL('../dist' + visual.url, import.meta.url))).length > 1000, rule.name);
  }
  const wall = zoneLoopVisual({name: 'Wall of Fire', rule: {name: 'Wall of Fire', shape: 'wall', radius: 10}, square: {x: 2, y: 2}, end: {x: 8, y: 2}, cells: ['2:2']});
  assert.equal(wall.kind, 'line');
  const ring = zoneLoopVisual({name: 'Wall of Fire', rule: {name: 'Wall of Fire', shape: 'ring', radius: 10}, square: {x: 5, y: 5}, cells: ['5:5']});
  assert.match(ring.url, /ring/i);
  const sphere = zoneLoopVisual({name: 'Flaming Sphere', rule: {name: 'Flaming Sphere', shape: 'movable', radius: 0}, square: {x: 4, y: 4}, cells: ['4:4']});
  assert.equal(zoneDiameter({rule: {shape: 'movable', radius: 0}}), 1);
  assert.match(sphere.url, /flamingsphere/i);
  const aura = zoneLoopVisual({name: 'Spirit Guardians', rule: {name: 'Spirit Guardians', shape: 'aura', radius: 15}, follow: true, square: {x: 3, y: 3}, cells: ['3:3']});
  assert.ok(aura.url);
  // Explicit “no animation” must suppress zone loops (and aim previews that use zoneLoopVisual).
  const wallNoneRule = {name: 'Wall of Fire', shape: 'wall', radius: 10, visual: {url: '', kind: 'burst', scale: 1, duration: 2500}};
  assert.equal(spellAnimationSuppressed(wallNoneRule), true);
  assert.equal(resolveSpellAnimation(wallNoneRule.name, wallNoneRule).url, '');
  assert.equal(
    zoneLoopVisual({name: 'Wall of Fire', rule: wallNoneRule, square: {x: 2, y: 2}, end: {x: 8, y: 2}, cells: ['2:2']}),
    null,
    'Wall of Fire with no-animation override must not play a catalogue zone loop',
  );
  const ringNone = zoneLoopVisual({name: 'Wall of Fire', rule: {...wallNoneRule, shape: 'ring'}, square: {x: 5, y: 5}, cells: ['5:5']});
  assert.equal(ringNone, null, 'ring form also suppresses the zone loop when visual is none');
  assert.ok(
    zoneLoopVisual({name: 'Wall of Fire', rule: {name: 'Wall of Fire', shape: 'wall', radius: 10}, square: {x: 2, y: 2}, end: {x: 8, y: 2}, cells: ['2:2']})?.url,
    'auto mode still receives the catalogue loop',
  );
  const {zoneOverlayAllowed} = await import('../dist/zone-visuals.mjs');
  const wallZone = {cells: ['2:2', '3:2', '4:2', '5:2', '6:2', '7:2', '8:2'], square: {x: 2, y: 2}, end: {x: 8, y: 2}};
  assert.equal(zoneOverlayAllowed(wallZone, {fogEnabled: false}), true);
  assert.equal(zoneOverlayAllowed(wallZone, {fogEnabled: true, sight: new Set(['2:2'])}), false, 'one visible square must not show the full wall video');
  assert.equal(zoneOverlayAllowed(wallZone, {fogEnabled: true, sight: new Set(wallZone.cells)}), true);
  assert.equal(zoneOverlayAllowed(wallZone, {fogEnabled: true, sight: new Set(wallZone.cells.slice(0, -1))}), false);
  console.log(persistent.length + ' persistent built-ins have looping zone overlays (wall/ring/sphere/aura covered); fog hides partial walls.');
}

// Homebrew / custom spells: catalogue clip overrides persist and win at resolve + cast time.
{
  const clip = spellAnimations.find((entry) => entry.url.startsWith('/assets/animations/') && entry.kind === 'burst')
    ?? spellAnimations.find((entry) => entry.url.startsWith('/assets/animations/'));
  assert.ok(clip, 'need a local catalogue clip for override tests');
  const spell = {name: 'Starflare Bolt', source: 'HB', edition: '2014', level: 1};
  const rule = migrateRule(blankRule(spell));
  rule.enabled = true;
  rule.visual = structuredClone(clip);
  assert.deepEqual(ruleProblems(rule), [], 'HB rule with catalogue visual validates');
  const withoutOverride = structuredClone(rule); delete withoutOverride.visual;
  assert.ok(!defaultSpellAnimation(withoutOverride.name, withoutOverride)?.url, 'invented HB names do not auto-match a free video clip');
  assert.equal(resolveSpellAnimation(rule.name, rule).url, clip.url, 'resolve prefers the saved override');
  const none = {...rule, visual: {url: '', kind: 'burst', scale: 1, duration: 2500}};
  assert.equal(resolveSpellAnimation(none.name, none).url, '', 'explicit none keeps an empty url');
  assert.equal(spellAnimationMode(none.visual), 'none');
  assert.equal(spellAnimationMode(undefined), 'auto');
  assert.equal(spellAnimationMode(rule.visual), 'catalogue');
  // Switching from a bundled clip to Custom URL clears the local path but must stay in custom mode
  // so the empty URL field remains visible (does not snap to None).
  const fromCatalogueToCustom = {
    url: '',
    kind: rule.visual.kind ?? 'burst',
    scale: rule.visual.scale ?? 1,
    duration: rule.visual.duration ?? 2500,
    mode: 'custom',
  };
  assert.equal(spellAnimationMode(fromCatalogueToCustom), 'custom', 'empty custom URL stays in Custom URL mode');
  assert.equal(spellAnimationMode({url: '', kind: 'burst', scale: 1, duration: 2500}), 'none');
  assert.equal(
    spellAnimationMode({url: 'https://example.com/clip.webm', kind: 'burst', scale: 1, duration: 2500, mode: 'custom'}),
    'custom',
  );
  assert.equal(resolveSpellAnimation(withoutOverride.name, withoutOverride)?.url, defaultSpellAnimation(withoutOverride.name, withoutOverride)?.url);

  globalThis.localStorage = {
    store: Object.create(null),
    getItem(key) { return Object.hasOwn(this.store, key) ? this.store[key] : null; },
    setItem(key, value) { this.store[key] = String(value); },
    removeItem(key) { delete this.store[key]; },
  };
  const {saveSpellRule, loadSpellRules, removeSpellRule} = await import('../dist/spell-rule-store.mjs');
  const saved = saveSpellRule(rule);
  assert.equal(loadSpellRules()[rule.reference].visual.url, clip.url, 'saved HB override stores the clip url');
  assert.equal(saved.visual.id, clip.id);

  const {setup} = await import('./spell-test-kit.mjs');
  const kit = setup(rule.reference, {rule: structuredClone(loadSpellRules()[rule.reference])});
  kit.cast(kit.targets[0]);
  assert.equal(kit.battle.actionEvents.at(-1).visual.url, clip.url, 'cast plays the saved catalogue override');

  // Named spells also honor a manual catalogue pick over auto-match.
  const fireball = builtins.find((entry) => entry.name === 'Fireball');
  const other = spellAnimations.find((entry) => entry.url.startsWith('/assets/animations/') && entry.url !== defaultSpellAnimation('Fireball', fireball).url);
  assert.ok(other);
  const overridden = {...structuredClone(fireball), visual: structuredClone(other)};
  assert.equal(resolveSpellAnimation(overridden.name, overridden).url, other.url);
  removeSpellRule(rule.reference);
  console.log('Homebrew animation overrides save, resolve, and play on cast.');
}