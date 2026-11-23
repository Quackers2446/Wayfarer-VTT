import assert from 'node:assert/strict';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
globalThis.localStorage={getItem:()=>JSON.stringify(ids.map(id=>({id,name:'QA room'})))};
const states=new Map(ids.map((id,index)=>[id,{revision:1,state:{room:{name:'Room '+index},battle:{actors:[{id:'party:hero',side:'party',tokenImage:'old',hp:20}],sheets:{'party:hero':{tokenImage:'old'}}}}}]));
let conflicted=false;const writes=[];
globalThis.fetch=async (url,init={})=>{
 const id=url.split('/').at(-1),snapshot=states.get(id);assert(snapshot);
 if(!init.method) return Response.json(structuredClone(snapshot));
 assert.equal(init.method,'PUT');const body=JSON.parse(init.body);writes.push(id);
 if(!conflicted){conflicted=true;snapshot.revision++;snapshot.state.battle.actors[0].hp=7;return Response.json(snapshot,{status:409});}
 assert.equal(body.revision,snapshot.revision);snapshot.state=body.state;snapshot.revision++;return Response.json({revision:snapshot.revision});
};
const {syncCharacterTokenRooms}=await import('../dist/token-room-sync.mjs');
assert.deepEqual(await syncCharacterTokenRooms('hero',undefined,{exclude:ids[2]}),[]);
assert.equal(states.get(ids[0]).state.battle.actors[0].hp,7,'Concurrent damage must survive token update retries');
assert.equal(states.get(ids[0]).state.battle.actors[0].tokenImage,undefined);
assert.equal(states.get(ids[1]).state.battle.sheets['party:hero'].tokenImage,undefined);
assert.equal(states.get(ids[2]).state.battle.actors[0].tokenImage,'old');assert(!writes.includes(ids[2]));
console.log('Cross-room token removal, sheet syncing, current-room exclusion and revision-conflict preservation verified.');
