const eps=1e-7;
export const samePoint=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<1e-4;
export const cleanPoint=p=>({x:Math.round(p.x*10000)/10000,y:Math.round(p.y*10000)/10000});
export const segmentEnds=s=>[{x:s.x1,y:s.y1},{x:s.x2,y:s.y2}];
export function segmentIntersection(a,b,c,d) {
  const rx=b.x-a.x,ry=b.y-a.y,sx=d.x-c.x,sy=d.y-c.y,den=rx*sy-ry*sx,qx=c.x-a.x,qy=c.y-a.y;
  if(Math.abs(den)<eps) {
    if(Math.abs(qx*ry-qy*rx)>eps) return null;
    const len=rx*rx+ry*ry;if(len<eps)return null;
    const t0=(qx*rx+qy*ry)/len,t1=t0+(sx*rx+sy*ry)/len,lo=Math.max(0,Math.min(t0,t1)),hi=Math.min(1,Math.max(t0,t1));
    return hi>=lo-eps ? {x:a.x+lo*rx,y:a.y+lo*ry,t:lo,endT:hi} : null;
  }
  const t=(qx*sy-qy*sx)/den,u=(qx*ry-qy*rx)/den;
  return t>=-eps && t<=1+eps && u>=-eps && u<=1+eps ? {x:a.x+t*rx,y:a.y+t*ry,t} : null;
}
export const segmentsBlock=(a,b,c,d)=>{const hit=segmentIntersection(a,b,c,d);return Boolean(hit && (hit.endT??hit.t)>eps && hit.t<1-eps);};
export function wallVertices(data) {
  const points=[];
  for(const segment of [...(data?.walls ?? []),...(data?.doors ?? [])]) for(const point of segmentEnds(segment)) if(!points.some(p=>samePoint(p,point)))points.push(point);
  return points;
}
export function nearestVertex(data,point,scaleX,scaleY,radius=12,exclude) {
  let best=null,dist=radius;
  for(const p of wallVertices(data)) {
    if(exclude && samePoint(p,exclude))continue;
    const distance=Math.hypot((p.x-point.x)*scaleX,(p.y-point.y)*scaleY);
    if(distance<=dist){best=p;dist=distance;}
  }
  return best;
}
export function nearestWall(data,point,scaleX,scaleY,radius=10) {
  let best=null,distance=radius;
  for(const [type,segments] of [['walls',data?.walls ?? []],['doors',data?.doors ?? []]])for(const [index,s] of segments.entries()) {
    const ax=s.x1*scaleX,ay=s.y1*scaleY,dx=(s.x2-s.x1)*scaleX,dy=(s.y2-s.y1)*scaleY;
    const t=Math.max(0,Math.min(1,((point.x*scaleX-ax)*dx+(point.y*scaleY-ay)*dy)/(dx*dx+dy*dy||1)));
    const d=Math.hypot(point.x*scaleX-ax-t*dx,point.y*scaleY-ay-t*dy);
    if(d<=distance){distance=d;best={type,index,segment:s,point:cleanPoint({x:s.x1+t*(s.x2-s.x1),y:s.y1+t*(s.y2-s.y1)})};}
  }
  return best;
}
export function normalizeWalls(data) {
  const seen=new Set();
  data.walls=(data.walls ?? []).filter(s=>{if(samePoint(...segmentEnds(s)))return false;const key=segmentEnds(s).map(p=>p.x+','+p.y).sort().join('/');if(seen.has(key))return false;seen.add(key);return true;});
  data.doors=(data.doors ?? []).filter(s=>!samePoint(...segmentEnds(s)));return data;
}
export function moveVertex(data,from,to) {
  to=cleanPoint(to);
  for(const s of [...(data.walls ?? []),...(data.doors ?? [])]) {
    if(samePoint({x:s.x1,y:s.y1},from)){s.x1=to.x;s.y1=to.y;}
    if(samePoint({x:s.x2,y:s.y2},from)){s.x2=to.x;s.y2=to.y;}
  }
  return normalizeWalls(data);
}
export function splitWall(data,selection) {
  const s=data[selection.type]?.[selection.index],p=selection.point;if(!s || segmentEnds(s).some(end=>samePoint(end,p)))return;
  data[selection.type].splice(selection.index,1,{...s,x2:p.x,y2:p.y},{...s,id:s.id ? crypto.randomUUID() : undefined,x1:p.x,y1:p.y});
}
