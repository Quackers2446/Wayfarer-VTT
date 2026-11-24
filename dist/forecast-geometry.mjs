import {cleanPoint,segmentEnds,segmentIntersection,samePoint} from './wall-geometry.mjs';
const length=s=>Math.hypot(s.x2-s.x1,s.y2-s.y1);
const segment=(a,b)=>({x1:a.x,y1:a.y,x2:b.x,y2:b.y});
const canonical=s=>s.x1>s.x2||s.x1===s.x2&&s.y1>s.y2?segment(...segmentEnds(s).reverse()):s;
const project=(p,s)=>{const dx=s.x2-s.x1,dy=s.y2-s.y1,t=((p.x-s.x1)*dx+(p.y-s.y1)*dy)/(dx*dx+dy*dy||1);return {t,x:s.x1+t*dx,y:s.y1+t*dy};};
function mergeLines(lines,tolerance,doors=false){
 const output=[];
 for(let line of lines.map(canonical)){
  let merged=true;
  while(merged){merged=false;for(let i=0;i<output.length;i++){
   const other=output[i],a=project({x:line.x1,y:line.y1},other),b=project({x:line.x2,y:line.y2},other),len=length(other),span=Math.abs(b.t-a.t)*len;
   if(Math.hypot(a.x-line.x1,a.y-line.y1)>tolerance||Math.hypot(b.x-line.x2,b.y-line.y2)>tolerance||span<length(line)*.995)continue;
   const lo=Math.min(a.t,b.t),hi=Math.max(a.t,b.t),overlap=(Math.min(1,hi)-Math.max(0,lo))*len;
   if(doors?overlap<Math.min(len,length(line))*.45:overlap < -tolerance)continue;
   // Keep one shared line; never bridge a doorway-sized gap or merge adjacent door leaves.
   const from=Math.min(0,lo),to=Math.max(1,hi),dx=other.x2-other.x1,dy=other.y2-other.y1;
   line=segment(cleanPoint({x:other.x1+from*dx,y:other.y1+from*dy}),cleanPoint({x:other.x1+to*dx,y:other.y1+to*dy}));output.splice(i,1);merged=true;break;
  }}output.push(line);
 }
 return output;
}
export function cleanForecastGeometry({rawWalls=[],rawDoors=[],map,snapThreshold=.22,minSegmentLength=.15}={}){
 if(!map?.cols||!map?.rows)throw Error('Valid map grid metadata is required.');
 const convert=([x,y])=>cleanPoint({x:Math.max(0,Math.min(map.cols,(x/1000*map.width-(map.offsetX??0))/(map.cellWidth??map.size??50))),y:Math.max(0,Math.min(map.rows,(y/1000*map.height-(map.offsetY??0))/(map.cellHeight??map.size??50)))});
 const read=records=>(Array.isArray(records)?records:[]).filter(s=>Array.isArray(s)&&s.length===4&&s.every(Number.isFinite)).map(s=>segment(convert(s.slice(0,2)),convert(s.slice(2,4)))).filter(s=>length(s)>=minSegmentLength);
 let walls=read(rawWalls),doors=read(rawDoors);
 if(walls.length+doors.length>6000)throw Error('Too many forecast segments. Scan smaller map sections.');
 const clusters=[];
 for(const s of [...walls,...doors])for(const [index,p]of segmentEnds(s).entries()){
  let cluster=clusters.find(c=>Math.hypot(c.x-p.x,c.y-p.y)<=snapThreshold);
  if(!cluster){cluster={x:p.x,y:p.y,members:[]};clusters.push(cluster);}
  cluster.members.push({s,index,p});cluster.x=cluster.members.reduce((sum,m)=>sum+m.p.x,0)/cluster.members.length;cluster.y=cluster.members.reduce((sum,m)=>sum+m.p.y,0)/cluster.members.length;
 }
 // Reuse each cluster's final position for every member; no movement-grid snapping.
 for(const c of clusters){const p=cleanPoint(c);for(const {s,index}of c.members){s[index?'x2':'x1']=p.x;s[index?'y2':'y1']=p.y;}}
 for(const s of [...walls,...doors]){
  if(Math.abs(s.x2-s.x1)<=snapThreshold&&Math.abs(s.x2-s.x1)<length(s)*.035){const x=(s.x1+s.x2)/2;s.x1=s.x2=x;}
  if(Math.abs(s.y2-s.y1)<=snapThreshold&&Math.abs(s.y2-s.y1)<length(s)*.035){const y=(s.y1+s.y2)/2;s.y1=s.y2=y;}
 }
 walls=mergeLines(walls.filter(s=>length(s)>=minSegmentLength),snapThreshold);doors=mergeLines(doors.filter(s=>length(s)>=minSegmentLength),snapThreshold,true);
 // Snap endpoints to the nearest interior junction, including across overlapping scan tiles.
 const all=[...walls,...doors],moves=new Map(),pointKey=p=>p.x+':'+p.y;
 for(const s of all)for(const p of segmentEnds(s)){
  let best=null,distance=snapThreshold;
  for(const other of all){if(other===s)continue;const q=project(p,other),d=Math.hypot(p.x-q.x,p.y-q.y);if(q.t>=0&&q.t<=1&&d>1e-5&&d<distance){best=cleanPoint(q);distance=d;}}
  if(best)moves.set(pointKey(p),best);
 }
 for(const s of all)for(const [index,p]of segmentEnds(s).entries()){const q=moves.get(pointKey(p));if(q){s[index?'x2':'x1']=q.x;s[index?'y2':'y1']=q.y;}}
 // Align each doorway to a nearby parallel wall, then carve every door from that wall.
 for(const door of doors){let nearest,best=snapThreshold*1.5;
  for(const wall of walls){const a=project({x:door.x1,y:door.y1},wall),b=project({x:door.x2,y:door.y2},wall),d=Math.max(Math.hypot(a.x-door.x1,a.y-door.y1),Math.hypot(b.x-door.x2,b.y-door.y2));if(d<=best&&Math.abs(b.t-a.t)*length(wall)>=length(door)*.98&&Math.min(a.t,b.t)<=1&&Math.max(a.t,b.t)>=0){nearest=[a,b];best=d;}}
  if(nearest)Object.assign(door,segment(...nearest.map(cleanPoint)));
 }
 const carved=[];
 for(const wall of walls){const intervals=[];
  for(const door of doors){const [p,q]=segmentEnds(door),a=project(p,wall),b=project(q,wall),d=Math.max(Math.hypot(a.x-p.x,a.y-p.y),Math.hypot(b.x-q.x,b.y-q.y));if(d>snapThreshold*.1||Math.abs(b.t-a.t)*length(wall)<length(door)*.98)continue;const lo=Math.max(0,Math.min(a.t,b.t)),hi=Math.min(1,Math.max(a.t,b.t));if(hi>lo)intervals.push([lo,hi]);}
  intervals.sort((a,b)=>a[0]-b[0]);let start=0;const dx=wall.x2-wall.x1,dy=wall.y2-wall.y1,at=t=>cleanPoint({x:wall.x1+t*dx,y:wall.y1+t*dy});
  for(const [lo,hi]of intervals){if((lo-start)*length(wall)>=minSegmentLength)carved.push(segment(at(start),at(lo)));start=Math.max(start,hi);}if((1-start)*length(wall)>=minSegmentLength)carved.push(segment(at(start),at(1)));
 }
 // Split at real intersections so the wall editor exposes a draggable shared vertex.
 const split=[];
 for(const wall of carved){const [a,b]=segmentEnds(wall),cuts=[0,1];for(const other of [...carved,...doors]){if(other===wall)continue;const hit=segmentIntersection(a,b,...segmentEnds(other));if(hit&&hit.t>1e-5&&hit.t<1-1e-5)cuts.push(hit.t);}
  cuts.sort((a,b)=>a-b);for(let i=1;i<cuts.length;i++)if((cuts[i]-cuts[i-1])*length(wall)>=minSegmentLength){const at=t=>cleanPoint({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});split.push(segment(at(cuts[i-1]),at(cuts[i])));}
 }
 const dedupe=lines=>{const seen=new Set();return lines.map(canonical).filter(s=>{const k=segmentEnds(s).map(p=>p.x+','+p.y).join('/');if(seen.has(k)||samePoint(...segmentEnds(s)))return false;seen.add(k);return true;});};
 const result={manual:true,walls:dedupe(split),doors:dedupe(doors).map(door=>({...door,id:crypto.randomUUID(),state:'closed',label:'Door'}))};
 if(result.walls.length>2000||result.doors.length>2000)throw Error('This forecast exceeds the room wall limit. Scan a smaller map.');
 return result;
}
