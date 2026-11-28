import assert from 'node:assert/strict';
import {shouldPlayCombatVictory} from '../dist/combat-victory.mjs';
import {makeActor,newBattle} from '../dist/combat.mjs';

const living = makeActor({name: 'Goblin', side: 'hostile', hp: 7, maxHp: 7, x: 3, y: 2});
const corpse = makeActor({name: 'Orc', side: 'hostile', hp: 0, maxHp: 15, dead: true, x: 4, y: 2});
const hero = makeActor({name: 'Hero', side: 'party', hp: 20, maxHp: 20, x: 1, y: 1});

assert.equal(shouldPlayCombatVictory(0, {...newBattle(), round: 0, actors: [hero, corpse]}), false, 'not mid-combat');
assert.equal(shouldPlayCombatVictory(2, {...newBattle(), round: 2, actors: [hero, corpse]}), false, 'still in combat');
assert.equal(shouldPlayCombatVictory(2, {...newBattle(), round: 0, actors: [hero, living]}), false, 'hostile still up');
assert.equal(shouldPlayCombatVictory(2, {...newBattle(), round: 0, actors: [hero, corpse]}), true, 'cleared fight');
assert.equal(shouldPlayCombatVictory(3, {...newBattle(), round: 0, actors: [hero, corpse]}, {partyWiped: true}), false, 'party wiped');
assert.equal(shouldPlayCombatVictory(1, {...newBattle(), round: 0, actors: [hero, living]}, {}), false);

console.log('Combat victory gate: cleared fights only; skips flee/truce-with-hostiles and party wipe.');
