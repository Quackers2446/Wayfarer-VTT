import {cleanPoint,segmentEnds} from './wall-geometry.mjs';

// Divide the artwork into overlapping crops; coordinates always refer to each crop's full rectangle.
export function forecastTiles(width,height,{detail=true,maxTiles=6,overlap=96}={}){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Valid map dimensions are required.');
 if(!detail)return [{x:0,y:0,width,height,index:0,total:1}];
 let core=1152;while(Math.ceil(width/core)*Math.ceil(height/core)>maxTiles)core=Math.ceil(core*1.1);
 const cols=Math.ceil(width/core),rows=Math.ceil(height/core),tiles=[];
 for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
  const x=Math.max(0,Math.floor(col*width/cols)-overlap),y=Math.max(0,Math.floor(row*height/rows)-overlap),right=Math.min(width,Math.ceil((col+1)*width/cols)+overlap),bottom=Math.min(height,Math.ceil((row+1)*height/rows)+overlap);
  tiles.push({x,y,width:right-x,height:bottom-y,index:tiles.length,total:cols*rows});
 }
 return tiles;
}
export function tileSegments(segments,tile,width,height){
 return (Array.isArray(segments)?segments:[]).filter(s=>Array.isArray(s)&&s.length===4&&s.every(Number.isFinite)&&s.every(n=>n>=0&&n<=1000)).map(s=>[(tile.x+s[0]*tile.width/1000)/width*1000,(tile.y+s[1]*tile.height/1000)/height*1000,(tile.x+s[2]*tile.width/1000)/width*1000,(tile.y+s[3]*tile.height/1000)/height*1000]);
}
// Image evidence only makes small corrections. It never invents or removes walls.
export function refineForecastPixels(data,map,image){
 const {width,height,data:pixels}=image,sx=width/map.width,sy=height/map.height,cw=(map.cellWidth??map.size)*sx,ch=(map.cellHeight??map.size)*sy;
 const point=p=>({x:(p.x*(map.cellWidth??map.size)+(map.offsetX??0))*sx,y:(p.y*(map.cellHeight??map.size)+(map.offsetY??0))*sy});
 const ink=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=width||y>=height)return 0;const i=(y*width+x)*4;if(pixels[i+3]<200)return 0;return Math.max(0,1-(.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2])/110);};
 const score=(a,b,offset,horizontal)=>{const length=Math.hypot(b.x-a.x,b.y-a.y),count=Math.min(400,Math.max(12,Math.ceil(length/4)));let total=0;for(let i=0;i<count;i++){const t=(i+.5)/count,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;let strip=0;for(let j=-2;j<=2;j++)strip+=ink(x+(horizontal?0:offset+j),y+(horizontal?offset+j:0));total+=strip/5;}return total/count;};
 const changes=new Map(),key=p=>p.x+':'+p.y,parent=new Map();
 const find=k=>{if(!parent.has(k))parent.set(k,k);let root=k;while(parent.get(root)!==root)root=parent.get(root);while(parent.get(k)!==k){const next=parent.get(k);parent.set(k,root);k=next;}return root;};
 for(const line of [...data.walls,...data.doors]){const [a,b]=segmentEnds(line),axis=Math.abs(a.y-b.y)<1e-4?'y':Math.abs(a.x-b.x)<1e-4?'x':null;if(axis){const left=find(key(a)+'|'+axis),right=find(key(b)+'|'+axis);parent.set(left,right);}}

 let adjusted=0;
 for(const wall of data.walls){const ends=segmentEnds(wall),[a,b]=ends.map(point),dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y),horizontal=dy<.2,vertical=dx<.2;if(!horizontal&&!vertical)continue;if(Math.hypot(dx,dy)<Math.min(cw,ch))continue;
  const radius=Math.max(2,Math.min(12,Math.round((horizontal?ch:cw)*.4))),base=score(a,b,0,horizontal);let best=base,offset=0;
  for(let d=-radius;d<=radius;d++){const support=score(a,b,d,horizontal)-Math.abs(d)*.001;if(support>best){best=support;offset=d;}}
  if(!offset||best<.32||best-base<.08)continue;adjusted++;
  for(const end of ends){const axis=horizontal?'y':'x',k=find(key(end)+'|'+axis),delta=offset/(horizontal?ch:cw),change=changes.get(k)??[];change.push({delta,weight:Math.hypot(dx,dy)});changes.set(k,change);}
 }
 const move=point=>{const result={...point};for(const axis of ['x','y']){const delta=changes.get(find(key(point)+'|'+axis));if(delta)result[axis]+=delta.reduce((sum,item)=>sum+item.delta*item.weight,0)/delta.reduce((sum,item)=>sum+item.weight,0);}return cleanPoint(result);};
 const remap=segment=>{const [a,b]=segmentEnds(segment).map(move);return {...segment,x1:a.x,y1:a.y,x2:b.x,y2:b.y};};
 const result={manual:true,walls:data.walls.map(remap),doors:data.doors.map(remap)},weakWalls=[];
 result.walls.forEach((wall,index)=>{const [a,b]=segmentEnds(wall).map(point),horizontal=Math.abs(b.y-a.y)<1,vertical=Math.abs(b.x-a.x)<1;if((horizontal||vertical)&&Math.hypot(b.x-a.x,b.y-a.y)>Math.min(cw,ch)*2&&score(a,b,0,horizontal)<.14)weakWalls.push(index);});
 return {data:result,adjusted,weakWalls};
}

export function renderForecastTile(source,tile,{maxDim=1536,quality=.94}={}){
 const scale=Math.min(1,maxDim/Math.max(tile.width,tile.height)),canvas=document.createElement('canvas');canvas.width=Math.round(tile.width*scale);canvas.height=Math.round(tile.height*scale);const context=canvas.getContext('2d');context.fillStyle='#d4c7a1';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(source,tile.x,tile.y,tile.width,tile.height,0,0,canvas.width,canvas.height);return {base64:canvas.toDataURL('image/jpeg',quality).split(',')[1],mimeType:'image/jpeg'};
}
export function forecastImageData(source,maxDim=3072){
 const width=source.naturalWidth||source.width,height=source.naturalHeight||source.height,scale=Math.min(1,maxDim/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(source,0,0,canvas.width,canvas.height);return context.getImageData(0,0,canvas.width,canvas.height);
}
export async function scanForecastTiles(source,{detail=true,scan,signal,onProgress=()=>{},render=renderForecastTile}){
 const width=source.naturalWidth||source.width,height=source.naturalHeight||source.height,tiles=forecastTiles(width,height,{detail}),walls=[],doors=[];
 for(const tile of tiles){
  signal?.throwIfAborted();
  const section=`Section ${tile.index+1}/${tile.total}`;
  onProgress(`${section} · tracing walls and doors…`);
  const result=await scan({...render(source,tile,{maxDim:detail?1536:1280}),signal,contextText:`${section}. This image is a crop of a ${width} × ${height} map. Its original bounds are (${tile.x},${tile.y}) to (${tile.x+tile.width},${tile.y+tile.height}). All output coordinates must be normalized 0..1000 relative to THIS image crop, not the full map. Trace partial visible walls up to a crop edge without adding an edge wall. Return all visible structural segments, not just the outer room outlines.`,onProgress:progress=>onProgress(`${section} · ${progress.message}`)});
  signal?.throwIfAborted();
  walls.push(...tileSegments(result.walls,tile,width,height));doors.push(...tileSegments(result.doors,tile,width,height));
 }
 return {walls,doors,sections:tiles.length};
}
