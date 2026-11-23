import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {sessionRequest} from '../worker/session.mjs';
import {trainingMap,trainingActors} from '../dist/encounters.mjs';
import {newBattle} from '../dist/combat.mjs';
const sqlite=new DatabaseSync(':memory:');
for(const file of ['0000_shared_tables.sql','0001_session_chat.sql','0002_session_players.sql','0003_session_images.sql','0004_room_creator_auth.sql'])sqlite.exec(await readFile(new URL('../drizzle/'+file,import.meta.url),'utf8'));
const DB={prepare(sql){let values=[];return{bind(...args){values=args;return this;},async first(column){const row=sqlite.prepare(sql).get(...values);return column ? row?.[column]??null : row??null;},async all(){return{results:sqlite.prepare(sql).all(...values)};},async run(){const result=sqlite.prepare(sql).run(...values);return{meta:{changes:Number(result.changes)}};}};},async batch(statements){return Promise.all(statements.map(statement=>statement.run()));}};
const env={DB},origin='https://test.example',alice=crypto.randomUUID(),bob=crypto.randomUUID(),other=crypto.randomUUID();
const cookies=new Map();
async function api(path,{method='GET',body,as=alice}={}) {
 const request=new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookies.has(as)?{Cookie:cookies.get(as)}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const response=await sessionRequest(request,env);const cookie=response.headers.get('Set-Cookie');if(cookie)cookies.set(as,cookie.split(';')[0]);return response;
}
async function create(name) {
 const state={battle:{...newBattle(),actors:trainingActors()},alignment:null,...(name?{room:{name,adventure:'training',adventureName:'Practice yard'}}:{})};
 const response=await api('/api/sessions',{method:'POST',body:{map:trainingMap,state}});assert.equal(response.status,201,await response.clone().text());return(await response.json()).id;
}
async function join(id,controller,username) {const response=await api('/api/sessions/'+id+'/players',{method:'POST',as:controller,body:{controller,username}});assert.equal(response.status,200);}
const alpha=await create('Sunday campaign'),beta=await create('Friday campaign'),legacy=await create();
await join(alpha,alice,'Alice');await join(beta,alice,'Alice');await join(legacy,alice,'Alice');await join(alpha,bob,'Bob');
const list=async controller=>(await(await api('/api/rooms?controller='+controller,{as:controller})).json()).rooms;
assert.deepEqual(new Set((await list(alice)).map(room=>room.id)),new Set([alpha,beta,legacy]));
assert.deepEqual((await list(bob)).map(room=>room.id),[alpha]);assert.deepEqual(await list(other),[]);
assert.equal((await api('/api/rooms?controller=invalid')).status,400);
const saved=async id=>await(await api('/api/sessions/'+id)).json();
const first=await saved(alpha),second=await saved(beta),state=structuredClone(first.state);
state.battle.actors[0].hp=7;state.battle.actors[0].slots={1:{current:0,maximum:2}};state.battle.actors[0].resources={ki:{current:2,maximum:6}};
state.battle.controllers={[state.battle.actors[0].id]:alice};state.battle.terrain['3:4']='difficult';state.battle.story={visited:['room-one'],rescued:true};state.battle.log.push('Campaign progress');
state.battle.actors[1].hp=0;state.battle.actors[1].dead=true;
const update=await api('/api/sessions/'+alpha,{method:'PUT',body:{revision:first.revision,state}});assert.equal(update.status,200);
assert.deepEqual((await saved(beta)).state,second.state,'A same-map room never shares its party, monsters, resources, terrain or story');
assert.deepEqual((await saved(alpha)).state.battle,state.battle);
const conflict=await api('/api/sessions/'+alpha,{method:'PUT',body:{revision:first.revision,state}});assert.equal(conflict.status,409);
const room=(await list(alice)).find(room=>room.id===alpha);assert.equal(room.name,'Sunday campaign');assert.deepEqual(room.party,['Rowan']);assert.ok(room.updatedAt>=first.state.room.createdAt);
// Older clients must not accidentally erase the room identity on their next action.
const latest=await saved(alpha),oldClientState={battle:latest.state.battle,alignment:latest.state.alignment};
assert.equal((await api('/api/sessions/'+alpha,{method:'PUT',body:{revision:latest.revision,state:oldClientState}})).status,200);
assert.equal((await saved(alpha)).state.room.name,'Sunday campaign');assert.equal((await saved(alpha)).state.room.createdAt,first.state.room.createdAt);
const chat=await api('/api/sessions/'+alpha+'/chat',{method:'POST',body:{sender:alice,messageId:crypto.randomUUID(),body:'Sunday party only'}});assert.equal(chat.status,204);
assert.equal((await(await api('/api/sessions/'+alpha+'/chat')).json()).messages[0].body,'Sunday party only');
assert.deepEqual((await(await api('/api/sessions/'+beta+'/chat')).json()).messages,[]);
const invalid=await api('/api/sessions',{method:'POST',body:{map:trainingMap,state:{...state,room:{name:'\n'}}}});assert.equal(invalid.status,400);
assert.deepEqual((await saved(beta)).state,second.state);
console.log('Independent same-map adventure saves, named room discovery, membership isolation, legacy rooms, state revisions, resources/story persistence and metadata preservation verified.');
// Deletion uses the established room creator, checks the displayed revision, and isolates assets.
assert.equal((await list(alice)).find(room=>room.id===alpha).canDelete,true);
assert.equal((await list(bob)).find(room=>room.id===alpha).canDelete,false);
assert.equal((await api('/api/sessions/'+alpha,{method:'DELETE',as:bob,body:{controller:bob,revision:(await saved(alpha)).revision}})).status,403);
assert.equal((await api('/api/sessions/'+alpha,{method:'DELETE',body:{controller:alice,revision:0}})).status,409);
assert.equal((await saved(alpha)).state.room.name,'Sunday campaign');
for(const [key,asset] of [[alpha,'map-alpha'],[alpha+'/tokens/old-unused-token','token-alpha'],[beta,'map-beta']]){
 sqlite.prepare('INSERT INTO session_images VALUES (?,?,?,?)').run(key,asset,'image/png',1);
 sqlite.prepare('INSERT INTO session_image_chunks VALUES (?,?,?)').run(asset,0,new Uint8Array([1,2,3]));
}
assert.equal((await api('/api/sessions/'+alpha,{method:'DELETE',body:{controller:alice,revision:(await saved(alpha)).revision}})).status,204);
assert.equal((await api('/api/sessions/'+alpha)).status,404);assert.equal((await api('/api/sessions/'+alpha+'?after=0')).status,404);
assert(!sqlite.prepare('SELECT 1 FROM session_players WHERE session_id=?').get(alpha));
assert(!sqlite.prepare('SELECT 1 FROM session_chat WHERE session_id=?').get(alpha));
assert(!sqlite.prepare('SELECT 1 FROM session_images WHERE asset_id IN (?,?)').get('map-alpha','token-alpha'));
assert(!sqlite.prepare('SELECT 1 FROM session_image_chunks WHERE asset_id IN (?,?)').get('map-alpha','token-alpha'));
assert(sqlite.prepare('SELECT 1 FROM session_images WHERE asset_id=?').get('map-beta'));
assert.deepEqual((await saved(beta)).state,second.state);assert(!(await list(alice)).some(room=>room.id===alpha));assert(!(await list(bob)).some(room=>room.id===alpha));
const controlled=await api('/api/sessions',{method:'POST',body:{controller:alice,map:trainingMap,state:{battle:{...newBattle(),actors:trainingActors()},room:{name:'Owned room'}}}});
assert.equal(controlled.status,201);const owned=(await controlled.json()).id;await join(owned,bob,'Bob');await join(owned,alice,'Alice');
const ownerHashBefore=sqlite.prepare('SELECT owner_key_hash FROM game_sessions WHERE id=?').get(owned).owner_key_hash;const ownedState=await saved(owned);ownedState.state.room.ownerController=bob;
assert.equal((await api('/api/sessions/'+owned,{method:'PUT',body:{revision:ownedState.revision,state:ownedState.state}})).status,200);
assert.equal(sqlite.prepare('SELECT owner_key_hash FROM game_sessions WHERE id=?').get(owned).owner_key_hash,ownerHashBefore,'Saving shared state cannot transfer ownership');
assert.equal((await api('/api/sessions/'+owned,{method:'DELETE',as:bob,body:{controller:bob,revision:(await saved(owned)).revision}})).status,403);
assert.equal((await api('/api/sessions/'+owned,{method:'DELETE',body:{controller:alice,revision:(await saved(owned)).revision}})).status,204);
console.log('Private-credential deletion, guest denial, stale confirmations, immutable ownership, asset/chat/member cleanup and other-room isolation verified.');
// R2 deployments may never have installed the D1 image fallback tables.
const removedKeys=[];env.BUCKET={async list({prefix}){return{objects:[{key:prefix},{key:prefix+'/tokens/unused'}],truncated:false};},async delete(keys){removedKeys.push(...keys);}};
sqlite.exec('DROP TABLE session_image_chunks; DROP TABLE session_images;');
const r2response=await api('/api/sessions',{method:'POST',body:{controller:alice,map:trainingMap,state:{battle:{...newBattle(),actors:trainingActors()},room:{name:'R2 room'}}}});
assert.equal(r2response.status,201);const r2id=(await r2response.json()).id;
assert.equal((await api('/api/sessions/'+r2id,{method:'DELETE',body:{controller:alice,revision:0}})).status,204);
assert.deepEqual(removedKeys,[r2id,r2id+'/tokens/unused']);assert.equal((await api('/api/sessions/'+r2id)).status,404);
console.log('R2 room assets delete successfully without D1 image tables.');
