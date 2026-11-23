import assert from 'node:assert/strict';
import {simulateThrow} from './scene.mjs';
import {diceCamera,diceSafeRect} from '../../dist/dice-layout.mjs';
import {multiplyQuaternion,rotateVector,restingFrame,dot} from '../../dist/dice-geometry.mjs';
let seed=173;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
const viewports=[[1440,1000],[390,844],[844,390],[3440,1440]],insets={top:100,bottom:180,left:16,right:16};
for(const [width,height] of viewports) for(const count of [1,6,16]) for(const quiet of [false,true]) {
 const values=Array.from({length:count},(_,i)=>({faces:[20,4,6,8,10,12][i%6],value:2,group:i%2}));
 const {dice,frames,table}=simulateThrow(values,{width,height,insets,quiet,random});
 for(const [targetWidth,targetHeight] of [[width,height],[height,width]]) {
  const camera=diceCamera(targetWidth,targetHeight,table,insets),safe=diceSafeRect(targetWidth,targetHeight,insets);
  for(const frame of frames) for(let i=0;i<dice.length;i++) {
   const die=dice[i],pose=frame[i],q=multiplyQuaternion(pose.slice(3),die.numbering);
   for(const vertex of die.model.vertices) {
    const point=rotateVector(q,vertex),x=targetWidth/2+(pose[0]+point[0]*die.radius-camera.x)*camera.scale,y=targetHeight/2+(pose[2]+point[2]*die.radius-camera.z)*camera.scale;
    assert.ok(x>=safe.left-1e-6 && x<=safe.left+safe.width+1e-6,`${die.faces}-sided die clips horizontally at ${width}x${height}`);
    assert.ok(y>=safe.top-1e-6 && y<=safe.top+safe.height+1e-6,`${die.faces}-sided die clips vertically at ${width}x${height}`);
   }
  }
 }
 for(let i=0;i<dice.length;i++) {
  const die=dice[i],q=multiplyQuaternion(frames.at(-1)[i].slice(3),die.numbering),face=restingFrame(die.model,die.value);
  assert.ok(dot(rotateVector(q,face.n),[0,1,0])>.999999,'The reading face/vertex is straight up from the flat table');
  assert.ok(dot(rotateVector(q,face.v),[0,0,-1])>.999999,'Numbers point upright in the overhead view');
  if(die.faces===20) {
   const result=die.model.faces.find(face=>face.value===die.value),center=rotateVector(q,result.center);
   const radii=result.indices.map(index=>{const p=rotateVector(q,die.model.vertices[index]);return Math.hypot(p[0]-center[0],p[2]-center[2]);});
   assert.ok(Math.max(...radii)-Math.min(...radii)<1e-6,'The result triangle must appear equilateral, with every corner equally far from its number');
   assert.ok(Math.hypot(center[0],center[2])<1e-6,'The result face is centered on the die silhouette');
  }
 }
}
console.log('Every physical frame stays inside the full-screen safe area for all six dice, 1/6/16-die pools, portrait/landscape/ultrawide screens, static fallback layout and rotation; results are centered, upright and directly overhead.');
