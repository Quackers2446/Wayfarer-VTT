export const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
export const sub=(a,b)=>a.map((x,i)=>x-b[i]);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const unit=a=>{const length=Math.hypot(...a);return a.map(x=>x/length);};
export const mean=points=>points[0].map((_,i)=>points.reduce((sum,p)=>sum+p[i],0)/points.length);

function hull(vertices) {
  const faces=new Map();
  for(let a=0;a<vertices.length;a++) for(let b=a+1;b<vertices.length;b++) for(let c=b+1;c<vertices.length;c++) {
    let normal=cross(sub(vertices[b],vertices[a]),sub(vertices[c],vertices[a]));
    if(Math.hypot(...normal)<1e-7) continue;
    normal=unit(normal);let distance=dot(normal,vertices[a]);
    if(distance<0) {normal=normal.map(x=>-x);distance=-distance;}
    if(vertices.some(v=>dot(normal,v)>distance+1e-6)) continue;
    const indices=vertices.flatMap((v,i)=>Math.abs(dot(normal,v)-distance)<1e-6 ? [i] : []);
    const key=indices.join(',');if(faces.has(key)) continue;
    const center=mean(indices.map(i=>vertices[i])),u=unit(sub(vertices[indices[0]],center)),v=cross(normal,u);
    indices.sort((i,j)=>Math.atan2(dot(sub(vertices[i],center),v),dot(sub(vertices[i],center),u))-Math.atan2(dot(sub(vertices[j],center),v),dot(sub(vertices[j],center),u)));
    faces.set(key,{indices,normal,center,distance});
  }
  return {vertices,faces:[...faces.values()]};
}

function model(points,sides) {
  const radius=Math.max(...points.map(p=>Math.hypot(...p)));
  const mesh=hull(points.map(p=>p.map(x=>x/radius)));
  const sequence=sides===20 ? [20,2,14,8,16,4,10,6,12,18] : Array.from({length:sides/2},(_,i)=>i+1);
  let pair=0;
  for(const face of mesh.faces) {
    if(face.value) continue;
    const opposite=mesh.faces.find(other=>dot(face.normal,other.normal)<-.99999);
    face.value=opposite ? sequence[pair++] : mesh.faces.indexOf(face)+1;
    if(opposite) opposite.value=sides+1-face.value;
  }
  return {...mesh,sides};
}

const phi=(1+Math.sqrt(5))/2,icosahedron=[];
for(const a of [-1,1]) for(const b of [-phi,phi]) icosahedron.push([0,a,b],[a,b,0],[b,0,a]);
const antiprism=hull(Array.from({length:10},(_,i)=>[Math.cos(i*Math.PI/5),i%2 ? -.52 : .52,Math.sin(i*Math.PI/5)]));
const models={
  4:model([[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],4),
  6:model([-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>[x,y,z]))),6),
  8:model([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],8),
  10:model(antiprism.faces.map(face=>face.normal.map(x=>x/face.distance)),10),
  20:model(icosahedron,20),
};
models[12]=model(models[20].faces.map(face=>face.normal),12);
export const diceModel=sides=>models[sides] ?? null;

export function faceFrame(mesh,index,corner=0) {
  const face=mesh.faces[index],v=unit(sub(mesh.vertices[face.indices[corner]],face.center));
  return {u:unit(cross(v,face.normal)),v,n:face.normal};
}

export function rotateVector(q,v) {
  const [x,y,z,w]=q,uv=cross([x,y,z],v),uuv=cross([x,y,z],uv);
  return v.map((n,i)=>n+2*(w*uv[i]+uuv[i]));
}

export function multiplyQuaternion(a,b) {
  const [x,y,z,w]=a,[X,Y,Z,W]=b;
  return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];
}

// Rotation between complete face frames also keeps the printed numbers upright.
export function frameRotation(from,to) {
  const a=[from.u,from.v,from.n],b=[to.u,to.v,to.n];
  const m=Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>a.reduce((sum,v,i)=>sum+b[i][r]*v[c],0)));
  const trace=m[0][0]+m[1][1]+m[2][2];let q;
  if(trace>0) {const s=Math.sqrt(trace+1)*2;q=[(m[2][1]-m[1][2])/s,(m[0][2]-m[2][0])/s,(m[1][0]-m[0][1])/s,s/4];}
  else {
    const i=m[1][1]>m[0][0] ? m[2][2]>m[1][1] ? 2 : 1 : m[2][2]>m[0][0] ? 2 : 0,j=(i+1)%3,k=(i+2)%3;
    const s=Math.sqrt(1+m[i][i]-m[j][j]-m[k][k])*2;q=[0,0,0,(m[k][j]-m[j][k])/s];q[i]=s/4;q[j]=(m[j][i]+m[i][j])/s;q[k]=(m[k][i]+m[i][k])/s;
  }
  const length=Math.hypot(...q);return q.map(x=>x/length);
}

export function faceSymmetries(mesh,from,to) {
  return mesh.faces[to].indices.map((_,corner)=>frameRotation(faceFrame(mesh,from),faceFrame(mesh,to,corner)))
    .filter(q=>mesh.vertices.every(vertex=>{const p=rotateVector(q,vertex);return mesh.vertices.some(v=>Math.hypot(...sub(p,v))<1e-5);}));
}

export function restingOrientation(mesh,value) {
  if(mesh.sides===4) {
    const n=unit(mesh.vertices[value-1]),v=unit(cross(n,[1,.1,0]));
    return frameRotation({u:cross(v,n),v,n},{u:[1,0,0],v:[0,0,-1],n:[0,1,0]});
  }
  const index=mesh.faces.findIndex(face=>face.value===value);
  return frameRotation(faceFrame(mesh,index),{u:[1,0,0],v:[0,0,-1],n:[0,1,0]});
}

export function cameraFacingOrientation(mesh,value,position,cameraPosition,cameraUp) {
  const n=unit(sub(cameraPosition,position));
  const v=unit(cameraUp.map((x,i)=>x-n[i]*dot(cameraUp,n)));
  const index=mesh.faces.findIndex(face=>face.value===value);
  return frameRotation(faceFrame(mesh,index),{u:unit(cross(v,n)),v,n});
}
