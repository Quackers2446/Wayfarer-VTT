import assert from 'node:assert/strict';
import {applyDamage, castSpell, makeActor, newBattle} from '../dist/combat.mjs';
import {restParty} from '../dist/class-actions.mjs';
import {applyHestiasFury,hestiaWallPool} from '../dist/hestias-fury.mjs';
import {attackVisual,projectilePlaybackRate} from '../dist/attack-visuals.mjs';
import {readFile} from 'node:fs/promises';

const map={cols:40,rows:30,width:800,height:600,size:20,offsetX:0,offsetY:0,regions:[]};
const caster=applyHestiasFury(makeActor({id:'pebbly',name:'Pebbly',side:'party',hp:50,maxHp:50,x:3,y:4,
  spellDC:16,attacks:[{name:"Hestia's Fury (d10)"}],slots:{2:{current:2,maximum:2}}}));
const battle={...newBattle(),actors:[caster],spellRules:{}};
const [fireball,wall]=caster.spells;
const random=()=>.45;
applyDamage(battle,caster,16,'fire',false,random);
assert.equal(caster.hp,50);
applyDamage(battle,caster,3,'cold',false,random);
assert.equal(caster.hp,47);
for(let i=0;i<5;i++)castSpell(battle,caster,null,fireball,0,{map,square:{x:3,y:4}},random);
assert.equal(caster.hp,47,'Fire immunity applies inside Pebbly’s own Fireball');
assert.equal(caster.slots[2].current,2,'The weapon casts independently of wizard slots');
assert.throws(()=>castSpell(battle,caster,null,fireball,3,{map,square:{x:10,y:10}},random),/through Hestia/);
const options={map,square:{x:9,y:6},end:{x:9,y:10},hotSide:'left'};
for(let i=0;i<3;i++)castSpell(battle,caster,null,wall,0,options,random);
assert.equal(battle.spellZones.at(-1).name,'Wall of Fire');
assert.equal(caster.resources[hestiaWallPool].current,0);
assert.equal(applyHestiasFury(structuredClone(caster)).resources[hestiaWallPool].current,0,'Room hydration keeps spent charges');
assert.throws(()=>castSpell(battle,caster,null,wall,0,options,random),/expended/);
restParty(battle,false,{advance:false});
assert.equal(caster.resources[hestiaWallPool].current,0);
restParty(battle,true,{advance:false});
assert.equal(caster.resources[hestiaWallPool].current,3);
castSpell(battle,caster,null,wall,0,options,random);
assert.equal(caster.resources[hestiaWallPool].current,2);

const legacy=applyHestiasFury(makeActor({side:'party',attacks:[{name:"Hestia's Fury"}],slots:{4:{current:1,maximum:null}}}));
assert.equal(legacy.resources[hestiaWallPool].current,1);
assert.equal(legacy.slots[4],undefined,'Legacy charges are not available for wizard casting');
const target={x:6,y:4};
const mappings=[
  [{name:'Naginata'},'glaive'],
  [{name:"Hestia's Fury (d10)"},'flame-blade'],
  [{name:'Unarmed Strike',unarmed:true},'unarmed'],
  [{name:'Tentacle'},'tentacle'],
  [{name:'Staff of Gulpa Gor'},'staff'],
  [{name:'Inquisitor Spikes'},'spikes'],
  [{name:'Twin Flaming Daggers'},'dagger'],
  [{name:'Fallen Angel Katana (d10)'},'katana'],
  [{name:'Staff of Frost (d8)'},'staff'],
  [{name:'Obidian Dagger'},'dagger'],
];
for(const [weapon,clip] of mappings){
 const event=attackVisual(weapon,caster,target,20);
 assert.equal(event.visual.url,'/assets/animations/combat-'+clip+'.webm');
 assert((await readFile(new URL('../dist'+event.visual.url,import.meta.url))).length>1000);
}
for(const [feet,range] of [[5,5],[10,15],[20,30],[60,60],[90,90]]){
 assert.equal(attackVisual({name:'Shortbow',normalRange:80},caster,target,feet).attackRange,range);
}
const catalog=JSON.parse(await readFile(new URL('../dist/rules.json',import.meta.url),'utf8'));
for(const weapon of catalog.weapons){
 const ranged=weapon.type==='R';
 const attack={name:weapon.name,normalRange:ranged?Number(weapon.range.split('/')[0]):undefined};
 const visual=attackVisual(attack,caster,target,ranged?20:5);
 assert.ok(visual.attackMotion, weapon.name+' has a default attack effect');
 if(visual.visual.url)assert((await readFile(new URL('../dist'+visual.visual.url,import.meta.url))).length>1000);
 if(weapon.property?.includes('T') && !ranged){
  const throwVisual=attackVisual({...attack,name:weapon.name+' (thrown)',normalRange:20},caster,target,20);
  assert.ok(['projectile','drawn-projectile'].includes(throwVisual.attackMotion),weapon.name+' has a thrown effect');
 }
}
const shortArrow=attackVisual({name:'Longbow',normalRange:150},caster,target,20);
assert.equal(shortArrow.attackRange,30);
assert.equal(projectilePlaybackRate(shortArrow,.2),1.85,'Keep the launch');
assert.equal(projectilePlaybackRate(shortArrow,.46),1.85*30/20,'Accelerate the middle');
assert.equal(projectilePlaybackRate(shortArrow,.8),1.85,'Keep impact playback');
assert.equal(attackVisual({name:'Longbow',normalRange:150},caster,target,120).attackProjectile,'arrow');
console.log('All '+catalog.weapons.length+' catalog weapons, thrown variants and distance-aware projectile timing verified.');
console.log('Hestia’s item casts, fire immunity, long-rest charges, legacy room hydration and character combat clip mappings passed.');
