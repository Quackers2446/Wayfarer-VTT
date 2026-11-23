import assert from 'node:assert/strict';
import {simulateThrow} from './scene.mjs';
import {multiplyQuaternion,rotateVector} from '../../dist/dice-geometry.mjs';
let seed=12345;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
const values=[4,6,8,10,12,20].flatMap(faces=>Array.from({length:faces},(_,i)=>({faces,value:i+1,group:0})));
for(const value of values) {
  const {dice,frames}=simulateThrow([value],{random});const die=dice[0];
  const orientation=multiplyQuaternion(frames.at(-1)[0].slice(3),die.numbering);
  const faces=die.faces===4 ? die.model.vertices.map((v,i)=>({value:i+1,normal:v})) : die.model.faces;
  const upper=faces.map(face=>({value:face.value,height:rotateVector(orientation,face.normal)[1]})).sort((a,b)=>b.height-a.height)[0];
  assert.equal(upper.value,value.value);assert.ok(upper.height>.95);
  assert.ok(frames.some((frame,i)=>i && frame[0][1]>frames[i-1][0][1]),'The solid must physically bounce');
  assert.ok(frames.every(frame=>frame[0].every(Number.isFinite)));
}
const mixed=[{faces:20,value:1,group:0,discarded:true},{faces:20,value:20,group:0},{faces:6,value:4,group:1},{faces:10,value:9,group:1}];
const before=JSON.stringify(mixed),{dice}=simulateThrow(mixed,{width:374,height:180,random});
assert.equal(JSON.stringify(mixed),before,'Presentation cannot modify recorded dice');
for(const die of dice) {
 const q=multiplyQuaternion(die.body.quaternion.toArray(),die.numbering);
 const upper=die.model.faces.map(face=>({value:face.value,height:rotateVector(q,face.normal)[1]})).sort((a,b)=>b.height-a.height)[0];
 assert.equal(upper.value,die.value);
 assert.ok(die.body.position.y>=0);
}
console.log('All d4, d6, d8, d10, d12 and d20 results settle correctly; mixed dice and advantage preserve their original results.');
