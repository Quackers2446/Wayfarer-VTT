import assert from "node:assert/strict";
import {buildActionBar,filterActionBar,hotbarDetailModel,renderActionBar,renderActionResources,toggleHotbarFilter} from "../dist/action-bar.mjs";
import {makeActor,newBattle} from "../dist/combat.mjs";

const monk=makeActor({side:"party",name:"Monk",hp:50,swings:2,resources:{ki:{name:"Ki",current:9,maximum:9}},
  classRules:{edition:"2014",unarmoredMonk:true,traits:["Flurry of Blows","Martial Arts","Patient Defense","Stunning Strike"]}});
const battle={...newBattle(),actors:[monk],round:1,order:[monk.id]};
const weapon={mode:"weapon",usable:true,data:{name:"Unarmed Strike",damage:"1d6+4",bonus:7}};
let entries=buildActionBar(monk,battle,[weapon]);
const find=id=>entries.find(entry=>entry.id===id);
assert.match(find("feature:flurry").reason,/Attack action first/);
assert.equal(find("feature:patient-defense").reason,"");
assert.equal(find("passive:stunning-strike").timing,"hit");
assert.ok(!filterActionBar(entries,"all","bonus").some(entry=>entry.mode==="weapon"));
assert.ok(filterActionBar(entries,"all","resource:ki").some(entry=>entry.actionId==="arm-stun"));

Object.assign(battle,{action:"attack",attacksMade:1,martialAttack:true});
entries=buildActionBar(monk,battle,[weapon]);
assert.equal(find("feature:flurry").reason,"");
assert.equal(find("weapon:Unarmed Strike").reason,"","Extra Attack remains available after the first attack");
assert.match(find("common:dash").reason,/action has already/);
Object.assign(battle,{bonusUsed:true,flurry:2});
entries=buildActionBar(monk,battle,[weapon]);
assert.match(find("feature:patient-defense").reason,/bonus action/);
assert.equal(find("feature:flurry-strike").reason,"");
const filtered=renderActionBar(entries,monk,{tab:"spell",filter:"slot:3"});
assert.ok(filtered.includes("Follow-up strikes"),"Flurry strikes remain accessible across tabs and filters");
assert.ok(filtered.includes('data-id="feature:flurry-strike"'));
monk.resources.ki.current=0;
Object.assign(battle,{bonusUsed:false});
entries=buildActionBar(monk,battle,[weapon]);
assert.match(find("feature:patient-defense").reason,/Not enough Ki/);
assert.match(find("passive:stunning-strike").reason,/Not enough Ki/);
monk.stunArmed=true;
entries=buildActionBar(monk,battle,[weapon]);
assert.equal(find("passive:stunning-strike").reason,"","A depleted toggle can still be turned off");
entries=buildActionBar(monk,battle,[weapon],{canAct:false});
assert.match(find("weapon:Unarmed Strike").reason,/another player/);
assert.equal(find("reference:features").reason,"");

const caster=makeActor({side:"party",name:"Caster",hp:20,slots:{1:{current:0,maximum:4},2:{current:1,maximum:2}},
  resources:{pactMagic:{name:"Pact Magic",current:1,maximum:2,slotLevel:3}}});
Object.assign(battle,{actors:[caster],order:[caster.id],action:null,attacksMade:0,flurry:0});
const spell=(name,level,extra={})=>({mode:"spell",usable:true,data:{name,key:name.toLowerCase(),level,timing:"action",...extra}});
const spells=[spell("Cantrip",0),spell("Magic Missile",1),spell("Fireball",3),spell("Unprepared",1,{prepared:false}),
  {...spell("Unimplemented",1),usable:false,manual:true}];
entries=buildActionBar(caster,battle,spells);
assert.equal(find("spell:fireball").reason,"","A Pact slot can cover a spell without an ordinary slot");
assert.match(find("spell:unprepared").reason,/not prepared/);
assert.match(find("spell:unimplemented").reason,/manual ruling/);
assert.deepEqual(filterActionBar(entries,"spell","slot:1").map(entry=>entry.level),[1,1,1]);
assert.deepEqual(filterActionBar(entries,"spell","slot:2").map(entry=>entry.level),[]);
assert.deepEqual(filterActionBar(entries,"spell","slot:1,slot:3").map(entry=>entry.level).sort(),[1,1,1,3]);
assert.ok(filterActionBar(entries,"spell","pact:3").some(entry=>entry.level===3));
assert.equal(toggleHotbarFilter("","slot:1"),"slot:1");
assert.equal(toggleHotbarFilter("slot:1","slot:3"),"slot:1,slot:3");
assert.equal(toggleHotbarFilter("slot:1,slot:3","slot:1"),"slot:3");
assert.equal(toggleHotbarFilter("slot:1,slot:3","slot:3"),"slot:1");
assert.ok(filterActionBar(entries,"spell","","missile").every(entry=>/missile/i.test(entry.name)));
assert.ok(renderActionBar(entries,caster,{tab:"spell",query:""}).includes('id="hotbar-search"'));
caster.resources.pactMagic.current=0;
entries=buildActionBar(caster,battle,spells);
assert.match(find("spell:fireball").reason,/No spell slot/);
assert.equal(find("spell:magic missile").reason,"","Upcasting remains possible with only a higher slot");
entries=buildActionBar(caster,battle,spells,{filter:"pact:3"});
assert.match(find("spell:fireball").reason,/No (spell slot|Pact Magic)/,'Pact-level filter keeps exhausted level 3 casts blocked');
assert.equal(find("spell:magic missile").reason,"","Exact-level Pact filter does not lock lower-level ordinary slots");
entries=buildActionBar(caster,battle,spells,{filter:"slot:1"});
assert.match(find("spell:magic missile").reason,/No level 1 spell slots/,'An exhausted selected level must not silently upcast');
battle.cast={bonus:true};
entries=buildActionBar(caster,battle,spells);
assert.match(find("spell:magic missile").reason,/only cast a cantrip/);
assert.equal(find("spell:cantrip").reason,"");
const resources=renderActionResources(caster,battle);
assert.ok(resources.includes('data-id="pact:3"'));
assert.ok(resources.includes('data-id="slot:2"'));

// Non-SRD / entry-less catalog spells still get mechanical hotbar facts.
const tipCaster=makeActor({side:"party",name:"Tip Caster",hp:20,slots:{}});
Object.assign(battle,{actors:[tipCaster],order:[tipCaster.id],cast:null,action:null});
const tipSpells=[
  {mode:"spell",usable:true,data:{name:"Thunderclap",key:"thunderclap",reference:"xge|thunderclap",level:0,timing:"action"}},
  {mode:"spell",usable:true,data:{name:"Thorn Whip",key:"thorn whip",reference:"phb|thorn whip",level:0,timing:"action"}},
];
entries=buildActionBar(tipCaster,battle,tipSpells);
const thunder=find("spell:xge|thunderclap");
assert.ok(thunder.stats.some(stat=>/1d6\+?\s*thunder/i.test(stat)),"Thunderclap shows damage: "+JSON.stringify(thunder.stats));
assert.ok(thunder.stats.some(stat=>/con save/i.test(stat)),"Thunderclap shows save: "+JSON.stringify(thunder.stats));
assert.ok(thunder.description && !/^cantrip$/i.test(thunder.description.trim()),"Thunderclap description is more than Cantrip: "+thunder.description);
const whip=find("spell:phb|thorn whip");
assert.ok(whip.stats.some(stat=>/1d6\+?\s*piercing/i.test(stat)),"Thorn Whip shows damage: "+JSON.stringify(whip.stats));
assert.ok(whip.stats.some(stat=>/melee spell attack/i.test(stat)),"Thorn Whip shows attack: "+JSON.stringify(whip.stats));
assert.match(renderActionBar(entries,tipCaster,{tab:"spell"}),/1d6\+ thunder|1d6 thunder/i);

monk.resources.ki.current=9;
const detailBattle={...newBattle(),actors:[monk],round:1,order:[monk.id],action:"attack",attacksMade:1};
const detailEntries=buildActionBar(monk,detailBattle,[weapon]);
const weaponDetail=hotbarDetailModel(detailEntries.find(e=>e.mode==="weapon"),monk);
assert.equal(weaponDetail.mode,"weapon");
assert.ok(weaponDetail.facts.some(([label])=>label==="Damage"));
assert.ok(weaponDetail.facts.some(([label])=>label==="Attack"));
const spellDetail=hotbarDetailModel(thunder,tipCaster);
assert.equal(spellDetail.spellKey,"xge|thunderclap");
assert.ok(spellDetail.facts.some(([label])=>/^(Level|Damage|Save)$/.test(label)));
const abilityDetail=hotbarDetailModel(detailEntries.find(e=>e.id==="feature:patient-defense"),monk);
assert.equal(abilityDetail.mode,"feature");
assert.ok(abilityDetail.subtitle.includes("Ability"));
const potionDetail=hotbarDetailModel({id:"potion:Potion of Healing",name:"Potion of Healing",mode:"potion",timing:"action",
  description:"Restore hit points with this item.",stats:["2d4+2 healing","3 remaining"],data:{name:"Potion of Healing",formula:"2d4+2",quantity:3}},monk);
assert.ok(potionDetail.facts.some(([label,value])=>label==="Healing"&&value==="2d4+2"));

caster.concentration={name:"Flaming Sphere",expires:(battle.elapsed??0)+60};
Object.assign(battle,{actors:[caster],order:[caster.id],action:null,round:1});
entries=buildActionBar(caster,battle,spells);
assert.ok(find("common:end-concentration"),"Concentrating casters get an End Concentration control");
assert.equal(find("common:end-concentration").reason,"");
assert.ok(find("common:end-concentration").stats.some(stat=>/Flaming Sphere|rounds left/.test(stat)));

console.log("Hotbar budgets, Extra Attack, Ki requirements, persistent Flurry follow-ups, ownership, casting restrictions, slot filters and spell tip facts verified.");
