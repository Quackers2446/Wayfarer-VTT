import {cellCenter} from './map-grid.mjs';
import {tokenRadius} from './actor-space.mjs';
const amount=value=>Number.isFinite(value)?Math.max(0,Math.floor(value)):0;
export function tokenHealth(actor){
  const current=actor.dead?0:amount(actor.hp),maximum=amount(actor.maxHp),temporary=amount(actor.tempHp);
  return {current,maximum,temporary,fraction:maximum?Math.min(1,current/maximum):0,label:`${current} / ${maximum}${temporary?' +'+temporary:''}`};
}
export function drawTokenHealth(c,map,actor,scaleX,scaleY,{selected=false}={}){
  const health=tokenHealth(actor),[x,y]=cellCenter(map,actor),radius=tokenRadius(map,actor);
  c.save();c.translate(x,y);c.scale(1/scaleX,1/scaleY);
  const diameter=2*radius*scaleX,font=Math.max(9,Math.min(12,diameter*.19));
  c.font=`700 ${font}px system-ui`;
  const width=Math.max(44,Math.min(150,Math.max(diameter*.98,c.measureText(health.label).width+16))),height=font+6;
  const left=Math.max(2-x*scaleX,Math.min(-width/2,(map.width-x)*scaleX-width-2)),top=Math.min(radius*scaleY+3,(map.height-y)*scaleY-height-2),cut=4;
  const shape=()=>{c.beginPath();c.moveTo(left+cut,top);c.lineTo(left+width-cut,top);c.lineTo(left+width,top+height/2);c.lineTo(left+width-cut,top+height);c.lineTo(left+cut,top+height);c.lineTo(left,top+height/2);c.closePath();};
  // Draw at screen density so labels stay sharp as the map camera zooms.
  c.shadowColor='#0009';c.shadowBlur=3;c.shadowOffsetY=1;shape();c.fillStyle='#100f12';c.fill();c.shadowBlur=0;c.shadowOffsetY=0;
  c.save();shape();c.clip();
  const tone=actor.dead?'#656762':actor.side==='party'?(health.fraction<=.25?'#a74334':'#43825c'):actor.side==='hostile'?'#a6373f':'#9b7b3d';
  const fill=c.createLinearGradient(0,top,0,top+height);fill.addColorStop(0,tone);fill.addColorStop(1,actor.dead?'#3b3e39':actor.side==='party'&&health.fraction>.25?'#234830':'#531e26');
  c.fillStyle=fill;c.fillRect(left,top,width*health.fraction,height);
  if(health.temporary){c.fillStyle='#86cfe8';c.fillRect(left+1,top+1,(width-2)*Math.min(1,health.temporary/Math.max(1,health.maximum)),2);}
  c.restore();shape();c.lineWidth=selected?1.5:1;c.strokeStyle=actor.dead?'#8c8d80':selected?'#ffe6aa':'#bca677';c.stroke();
  c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';c.lineWidth=2.5;c.strokeStyle='#151018';c.strokeText(health.label,left+width/2,top+height/2+.3);c.fillStyle=actor.dead?'#c2c1b6':'#fff5dd';c.fillText(health.label,left+width/2,top+height/2+.3);
  c.restore();
}
