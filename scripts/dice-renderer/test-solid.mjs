import assert from 'node:assert/strict';
import {dieGeometry} from './scene.mjs';
import {diceModel} from '../../dist/dice-geometry.mjs';
for(const sides of [4,6,8,10,12,20]){
 const geometry=dieGeometry(diceModel(sides)),edges=new Map();
 for(const mesh of [geometry.main,geometry.trim]){const a=mesh.getAttribute('position').array;for(let i=0;i<a.length;i+=9){const u=[a[i+3]-a[i],a[i+4]-a[i+1],a[i+5]-a[i+2]],v=[a[i+6]-a[i],a[i+7]-a[i+1],a[i+8]-a[i+2]],n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];assert(n.reduce((s,x,k)=>s+x*a[i+k],0)>0,`d${sides} triangles must face outward`);const points=[0,3,6].map(offset=>Array.from(a.slice(i+offset,i+offset+3)).map(v=>v.toFixed(5)).join(','));for(let j=0;j<3;j++){const key=[points[j],points[(j+1)%3]].sort().join('/');edges.set(key,(edges.get(key)??0)+1);}}}
 assert([...edges.values()].every(count=>count===2),`d${sides} must be a closed surface without gaps or duplicate bevel edges`);
 geometry.main.dispose();geometry.trim.dispose();
}
console.log('All six dice form closed surfaces across face, bevel and corner seams.');
