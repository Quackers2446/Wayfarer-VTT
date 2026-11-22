import assert from 'node:assert/strict';
import {diceModel,faceFrame,faceSymmetries,restingOrientation,cameraFacingOrientation,rotateVector,dot,sub,unit} from '../dist/dice-geometry.mjs';
for(const sides of [4,6,8,10,12,20]) {
  const model=diceModel(sides);assert.equal(model.faces.length,sides);
  assert.deepEqual(model.faces.map(face=>face.value).sort((a,b)=>a-b),Array.from({length:sides},(_,i)=>i+1));
  const edges=new Set();
  for(const [index,face] of model.faces.entries()) {
    assert.ok(face.indices.every(i=>Math.abs(dot(model.vertices[i],face.normal)-face.distance)<1e-6));
    for(let i=0;i<face.indices.length;i++) edges.add([face.indices[i],face.indices[(i+1)%face.indices.length]].sort((a,b)=>a-b).join(':'));
    const opposite=model.faces.find(other=>dot(face.normal,other.normal)<-.99999);
    if(opposite) assert.equal(face.value+opposite.value,sides+1);
    if(sides!==4) assert.ok(rotateVector(restingOrientation(model,face.value),face.normal)[1]>.99999);
    for(let target=0;target<sides;target++) {
      const rotations=faceSymmetries(model,index,target);assert.ok(rotations.length);
      for(const rotation of rotations) assert.ok(dot(rotateVector(rotation,face.normal),model.faces[target].normal)>.99999);
    }
  }
  assert.equal(model.vertices.length-edges.size+model.faces.length,2);
}
const d20=diceModel(20);assert.equal(d20.vertices.length,12);
const lengths=[];
for(const face of d20.faces) {
  assert.equal(face.indices.length,3);
  for(let i=0;i<3;i++) lengths.push(Math.hypot(...sub(d20.vertices[face.indices[i]],d20.vertices[face.indices[(i+1)%3]])));
}
assert.ok(Math.max(...lengths)-Math.min(...lengths)<1e-6,'All twenty faces must be equilateral');
for(let value=1;value<=20;value++) for(const position of [[-6,.8,0],[0,.8,0],[5,.8,-.4]]) {
  const camera=[0,6.5,3.8],up=unit([0,3.8,-6.5]),n=unit(sub(camera,position));
  const q=cameraFacingOrientation(d20,value,position,camera,up),frame=faceFrame(d20,d20.faces.findIndex(face=>face.value===value));
  assert.ok(dot(rotateVector(q,frame.n),n)>.999999,'The result face must point directly at the perspective camera');
  const projectedUp=unit(up.map((x,i)=>x-n[i]*dot(up,n)));
  assert.ok(dot(rotateVector(q,frame.v),projectedUp)>.999999,'The printed number must be upright across the screen');
}
assert.equal(diceModel(100),null,'Unsupported dice must never be drawn as d20s');
console.log('Solid topology, fixed numbering, hull symmetries and upright camera-facing results for all twenty d20 values across the screen verified.');
