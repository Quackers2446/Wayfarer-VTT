import assert from 'node:assert/strict';
import {forecastTiles,tileSegments,refineForecastPixels,scanForecastTiles} from '../dist/forecast-quality.mjs';
import {cleanForecastGeometry} from '../dist/forecast-geometry.mjs';
const tiles=forecastTiles(2280,3000);assert.equal(tiles.length,6);assert(tiles.every(tile=>tile.width<=1536&&tile.height<=1536));assert(tiles[0].x+tiles[0].width>tiles[1].x,'Sections overlap rather than leave boundary gaps');assert.equal(tiles.at(-1).y+tiles.at(-1).height,3000);assert.equal(forecastTiles(10000,8000).length<=6,true);
const converted=tileSegments([[0,0,1000,1000],['bad',1,2,3],[0,0,NaN,1],[0,0,1001,1]],tiles[1],2280,3000);assert.equal(converted.length,1);assert(Math.abs(converted[0][0]-tiles[1].x/2280*1000)<1e-8);assert(Math.abs(converted[0][2]-(tiles[1].x+tiles[1].width)/2280*1000)<1e-8);
const map={width:1000,height:1000,cols:20,rows:20,size:50};
{
 const result=cleanForecastGeometry({map,rawWalls:[[100,200,900,200],[400,200,1000,200]],rawDoors:[[200,200,300,200],[600,200,700,200],[700,200,600,200]]});assert.equal(result.doors.length,2);assert.equal(result.walls.length,3);assert(result.walls.some(w=>w.x1===6&&w.x2===12));assert(!result.walls.some(w=>w.x1<5&&w.x2>5),'All door intervals are carved, including the second door on a merged wall');
}
{
 const result=cleanForecastGeometry({map,rawWalls:[[100,100,900,100],[500,100,500,900]],rawDoors:[]});assert.equal(result.walls.length,3);assert.equal(result.walls.filter(w=>w.x1===10&&w.y1===2||w.x2===10&&w.y2===2).length,3,'T-junction is a shared draggable vertex');
 const free=cleanForecastGeometry({map,rawWalls:[[115,215,415,215]],rawDoors:[]});assert.equal(free.walls[0].x1,2.3);assert.equal(free.walls[0].y1,4.3,'Vertices are not forced onto grid lines');
 const paired=cleanForecastGeometry({map,rawWalls:[[100,200,900,200]],rawDoors:[[300,200,350,200],[370,200,420,200]]});assert.equal(paired.doors.length,2);assert(paired.walls.some(w=>w.x1===7&&w.x2===7.4),'Two door leaves retain their intervening wall');
 const corridor=cleanForecastGeometry({map,rawWalls:[[100,100,100,900],[150,100,150,900]],rawDoors:[]});assert.equal(corridor.walls.length,2,'Both corridor boundaries remain separate');
}
{
 const pixels=new Uint8ClampedArray(100*100*4).fill(255);for(let y=40;y<=44;y++)for(let x=10;x<=90;x++){const i=(y*100+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=10;}
 const m={width:100,height:100,cols:10,rows:10,size:10},data={manual:true,walls:[{x1:1,y1:3.7,x2:4,y2:3.7},{x1:5,y1:3.7,x2:9,y2:3.7},{x1:2,y1:7,x2:8,y2:7}],doors:[{id:'door',state:'closed',x1:4,y1:3.7,x2:5,y2:3.7}]},q=refineForecastPixels(data,m,{width:100,height:100,data:pixels});
 assert(q.adjusted>=2);assert(q.data.walls[0].y1>=4);assert.equal(q.data.walls[0].y2,q.data.doors[0].y1);assert.equal(q.data.doors[0].y1,q.data.doors[0].y2);assert.equal(q.data.doors[0].y2,q.data.walls[1].y1,'Pixel corrections keep doors straight and attached');assert(q.weakWalls.includes(2),'A long line on open floor is flagged');assert.equal(q.data.walls.length,3,'Image heuristics do not remove uncertain walls');assert.equal(data.walls[0].y1,3.7,'Refinement leaves the input immutable');
}
{
 const events=[],source={width:2280,height:3000};let calls=0;
 const result=await scanForecastTiles(source,{render:()=>({base64:'fake',mimeType:'image/jpeg'}),onProgress:message=>events.push(message),scan:async options=>{calls++;assert.match(options.contextText,/relative to THIS image crop/);return {walls:[[0,0,1000,0]],doors:[]};}});assert.equal(calls,6);assert.equal(result.walls.length,6);assert.equal(result.sections,6);assert(events.at(-1).includes('6/6'));
 let failures=0;await assert.rejects(()=>scanForecastTiles(source,{render:()=>({base64:'fake'}),scan:async()=>{if(++failures===2)throw Error('Section failed');return {walls:[],doors:[]};}}),/Section failed/);assert.equal(failures,2,'A failed section cannot apply a partial forecast');
 const abort=new AbortController();let cancelled=0;await assert.rejects(()=>scanForecastTiles(source,{signal:abort.signal,render:()=>({base64:'fake'}),scan:async()=>{cancelled++;abort.abort();return {walls:[],doors:[]};}}),{name:'AbortError'});assert.equal(cancelled,1);
}
console.log('Overlapping detail crops, local/full-image coordinates, duplicate overlap merging, all-door carving, paired doors, T-junctions, free vertices, conservative pixel alignment, weak evidence, cancellation and all-or-nothing scans verified.');
