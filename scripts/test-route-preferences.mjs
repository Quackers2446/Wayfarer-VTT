import assert from 'node:assert/strict';
import {newBattle,makeActor,previewMovement,startInitiative,joinInitiative,currentActor,moveLeft,endTurn} from '../dist/combat.mjs';
const map={cols:15,rows:15,width:750,height:750,size:50,offsetX:0,offsetY:0,regions:[]};
const diagonals=(actor,path)=>{let count=0,p=actor;for(const step of path){if(step.x!==p.x&&step.y!==p.y)count++;p=step;}return count;};
for(const combat of [false,true])for(const [x,y,steps,expectedDiagonals] of [[10,5,5,0],[0,5,5,0],[5,10,5,0],[5,0,5,0],[10,7,5,2],[10,10,5,5]]){
 const actor=makeActor({name:'Walker',side:'party',hp:30,x:5,y:5,initiative:30,speed:60}),enemy=makeActor({name:'Enemy',hp:50,x:14,y:14,initiative:0}),battle={...newBattle(),actors:[actor,enemy]};if(combat)startInitiative(battle,()=>.5);
 const route=previewMovement(battle,actor,x,y,map);assert(route);assert.equal(route.cost,steps*5,'Diagonal and cardinal steps keep equal costs');assert.equal(diagonals(actor,route.path),expectedDiagonals,'Equal-cost routes prefer cardinal steps');
}
{
 const actor=makeActor({name:'Walker',side:'party',hp:30,x:1,y:3,speed:60}),battle={...newBattle(),actors:[actor],terrain:{'2:3':'wall'}};
 const route=previewMovement(battle,actor,5,3,map);assert(route);assert(route.path.some(step=>step.y!==3));assert(!route.path.some(step=>step.x===2&&step.y===3),'Straight preference cannot cross an obstacle');
}
{
 const a=makeActor({name:'Active',side:'party',hp:30,x:2,y:2,initiative:20}),enemy=makeActor({name:'Enemy',hp:50,x:8,y:8,initiative:0}),battle={...newBattle(),actors:[a,enemy]};startInitiative(battle,()=>.5);battle.action='attack';battle.spent=10;battle.bonusUsed=true;
 const current=currentActor(battle),newcomer=makeActor({name:'Arrival',side:'party',hp:30,x:3,y:2,initiative:-5});battle.actors.push(newcomer);joinInitiative(battle,newcomer,()=>.5);assert.equal(currentActor(battle),current);assert.equal(battle.action,'attack');assert.equal(battle.spent,10);assert.equal(battle.bonusUsed,true);assert(battle.encounterParticipants.includes(newcomer.id));assert(battle.order.includes(newcomer.id));assert.equal(battle.order.filter(id=>id===newcomer.id).length,1);joinInitiative(battle,newcomer);assert.equal(battle.order.filter(id=>id===newcomer.id).length,1);endTurn(battle,()=>.5);assert.equal(currentActor(battle),enemy);endTurn(battle,()=>.5);assert.equal(currentActor(battle),newcomer);assert.equal(moveLeft(battle,newcomer),30);assert.equal(battle.action,null);
}
console.log('Straight cardinal routes, unchanged diagonal cost, obstacle avoidance and mid-combat initiative insertion preserve active turn budgets and encounter participation.');
