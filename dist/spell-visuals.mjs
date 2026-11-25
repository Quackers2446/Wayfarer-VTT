import {builtinSpellColors} from './spell-animation-library.mjs';
import {projectilePlaybackRate} from './attack-visuals.mjs';
import {isDrawnProjectile,paintDrawnProjectile} from './drawn-projectiles.mjs';
import {cellCenter} from './map-grid.mjs';
import {spellVisualValid} from './spell-rule-schema.mjs';
import {spellClipBlend} from './zone-visuals.mjs';

// Native video playback. No Foundry globals, scripts or animation-pack runtime.
function createSingleVisual(getView){
 let active;
 function stop(){
  if(!active)return;
  const previous=active;
  active=null;
  clearTimeout(previous.timer);
  cancelAnimationFrame(previous.frame);
  if(previous.video){
    if(previous.videoFrame!=null)previous.video.cancelVideoFrameCallback?.(previous.videoFrame);
    previous.video.pause();
    previous.video.removeAttribute('src');
    previous.video.load();
  }
  previous.element.remove();
 }
 function place(){
  const view=getView();if(!active||!view?.layer.isConnected)return;
  const {event,element}=active,{map,grid,layer}=view,rect=grid.getBoundingClientRect(),origin=layer.getBoundingClientRect();
  const project=point=>{const [x,y]=cellCenter(map,point);return [rect.left-origin.left+x/map.width*rect.width,rect.top-origin.top+y/map.height*rect.height];};
  const [sx,sy]=project(event.visualFrom??event),[targetX,targetY]=project(event.visualPoint??event),[ax,ay]=project(event.visualAim??event.visualPoint??event),unit=map.size/map.width*rect.width;
  let tx=targetX,ty=targetY;
  if(['projectile','drawn-projectile'].includes(event.attackMotion) && event.outcome==='Miss'){
    const heading=Math.atan2(ty-sy,tx-sx);
    tx-=Math.sin(heading)*unit*.72;ty+=Math.cos(heading)*unit*.72;
  }
  const ray=event.visual.kind==='ray',cone=event.visual.kind==='cone',line=event.visual.kind==='line',distance=Math.hypot(tx-sx,ty-sy),angle=Math.atan2(ay-sy,ax-sx);
  if(['swing','projectile','drawn-projectile','impact'].includes(event.attackMotion)){
    const projectile=event.attackMotion==='projectile', impact=event.attackMotion==='impact';
    const drawn=event.attackMotion==='drawn-projectile';
    const range=Math.max(5,Number(event.attackRange)||5);
    const width=drawn?distance+2*unit:projectile?Math.max(unit,distance)*(range+10)/range:impact?2.4*unit:Math.max(3.6*unit,distance*1.6);
    const height=drawn||projectile?2*unit:impact?width:width*.75;
    element.style.width=width+'px';
    element.style.height=height+'px';
    element.style.left=(impact?tx:(sx+tx)/2)+'px';
    element.style.top=(impact?ty:(sy+ty)/2)+'px';
    element.style.transform=`translate(-50%,-50%) rotate(${impact?0:Math.atan2(ty-sy,tx-sx)}rad)`;
    if(event.attackFire)element.style.filter='drop-shadow(0 0 6px #ff682a)';
    if(element.parentElement!==layer)layer.append(element);
    if(drawn)active.layout={width,height,unit,distance};
    return;
  }
  const length=Math.max(.2,Math.min(120,event.visualLength??event.visual.length??3))*unit;
  // JB2A 30-ft rays reserve 1/8 of the frame at each end for transparent padding.
  element.style.width=(ray?Math.max(unit,distance)*4/3:cone?length:line?(event.visualEnd?distance+unit:length):unit*(event.visualDiameter??2))*event.visual.scale+'px';
  element.style.height=(ray?unit*2:cone?length:line?unit:unit*(event.visualDiameter??2))*event.visual.scale+'px';
  element.style.left=(cone?sx:line?(event.visualEnd?(sx+tx)/2:sx+Math.cos(angle)*length/2):ray?(sx+tx)/2:tx)+'px';
  element.style.top=(cone?sy:line?(event.visualEnd?(sy+ty)/2:sy+Math.sin(angle)*length/2):ray?(sy+ty)/2:ty)+'px';
  element.style.transformOrigin=cone?'0 50%':'center';
  element.style.transform=`translate(${cone?'0':'-50%'},-50%) rotate(${cone||line?event.visualEnd?Math.atan2(ty-sy,tx-sx):angle:ray?Math.atan2(ty-sy,tx-sx):0}rad)`;
  if(element.parentElement!==layer){
    if(active.started!=null)element.style.setProperty('--spell-delay',(active.started-performance.now())+'ms');
    layer.append(element);
  }
 }
 function play(event,done){
  const view=getView(),point=event.visualPoint??event;
  const drawn=event.attackMotion==='drawn-projectile' && isDrawnProjectile(event.attackProjectile);
  const builtin=event.visual?.builtin && Object.hasOwn(builtinSpellColors,event.visual.builtin);
  const from=event.visualFrom??event;
  // Wall/line clips span endpoints; require both in sight so fog cannot leak along the beam.
  const fogBlocked=view?.fogEnabled&&(!view.sight.has(point.x+':'+point.y)||
    (event.visualEnd&&Number.isFinite(from.x)&&!view.sight.has(from.x+':'+from.y)));
  if(!view||!spellVisualValid(event.visual)||(!drawn&&!builtin&&!event.visual.url)||event.visible===false||
    ![event.x,event.y,point.x,point.y].every(Number.isFinite)||
    fogBlocked||
    matchMedia('(prefers-reduced-motion: reduce)').matches){done();return;}
  stop();
  const element=document.createElement(drawn?'canvas':builtin?'div':'video');
  element.className='spell-video-effect';element.setAttribute('aria-hidden','true');
  const current={element,event};active=current;
  const finish=()=>{if(active!==current)return;stop();done();};
  if(builtin){
    element.classList.add('builtin-spell-effect');
    element.dataset.shape=event.visual.kind;
    element.dataset.effect=event.visual.builtin;
    element.style.setProperty('--spell-color',builtinSpellColors[event.visual.builtin]);
    element.style.setProperty('--spell-duration',event.visual.duration+'ms');
    element.append(document.createElement('span'),document.createElement('span'));
    current.started=performance.now();
    place();
    current.timer=setTimeout(finish,event.visual.duration);
    return;
  }
  if(drawn){
    place();
    const pace=Math.max(0.4,Math.min(1,event.visualPace??1));
    const start=performance.now(), flight=Math.min(850,Math.max(120,130+(Number(event.attackDistance)||5)*8))*pace;
    const hitDuration=(event.outcome==='Miss'?0:270)*pace;
    function frame(now){
      if(active!==current)return;
      const elapsed=now-start;
      if(elapsed>=flight+hitDuration){finish();return;}
      const layout=current.layout;
      if(layout?.unit>0)paintDrawnProjectile(element,layout,event.attackProjectile,
        Math.min(1,elapsed/flight),Math.max(0,(elapsed-flight)/Math.max(1,hitDuration)),event.outcome==='Miss');
      current.frame=requestAnimationFrame(frame);
    }
    current.frame=requestAnimationFrame(frame);
    return;
  }
  const video=element;current.video=video;
  const blend=spellClipBlend(event.visual,event.action??event.visual?.id??'');
  if(blend)video.dataset.blend=blend;
  video.muted=true;video.playsInline=true;video.preload='auto';video.referrerPolicy='no-referrer';
  video.addEventListener('ended',finish,{once:true});video.addEventListener('error',finish,{once:true});
  // An unavailable or stalled clip never holds up a turn indefinitely.
  current.timer=setTimeout(finish,10000);
  video.addEventListener('playing',()=>{if(active!==current)return;clearTimeout(current.timer);current.timer=setTimeout(finish,event.visual.duration);},{once:true});
  const paceBoost=Math.max(0.4,Math.min(1,event.visualPace??1));
  if(event.attackMotion)video.playbackRate=(event.attackMotion==='impact'?1.4:1.85)/paceBoost;
  else if(event.visual?.kind==='ray'&&Number.isFinite(event.visualClipFeet)&&Number.isFinite(event.attackDistance)&&event.attackDistance>0&&event.attackDistance<event.visualClipFeet){
    // Shorter shots use a faster playback of the longer beam clip so travel time stays readable.
    video.playbackRate=Math.min(2.8,event.visualClipFeet/Math.max(5,event.attackDistance))/paceBoost;
  } else if(paceBoost<0.99) video.playbackRate=1/paceBoost;
  if(event.attackMotion==='projectile' && event.attackDistance<event.attackRange){
    const update=time=>{
      const rate=projectilePlaybackRate(event,time);
      if(rate!==video.playbackRate)video.playbackRate=rate;
    };
    if(video.requestVideoFrameCallback){
      const next=(_,metadata)=>{
        if(active!==current)return;
        update(metadata.mediaTime);
        current.videoFrame=video.requestVideoFrameCallback(next);
      };
      current.videoFrame=video.requestVideoFrameCallback(next);
    }else video.addEventListener('timeupdate',()=>update(video.currentTime));
  }
  video.src=event.visual.url;place();video.play().catch(finish);
 }
 return {play,place,stop};
}


const MAX_OVERLAPPING_FX=10;

function pacedCast(cast,durationScale){
  const scale=Math.max(0.4,Math.min(1,durationScale ?? 1));
  if(scale>=0.99) return cast;
  const visual=cast.visual?{...cast.visual,duration:Math.max(180,Math.round((cast.visual.duration??2500)*scale))}:cast.visual;
  return {...cast,visual,visualPace:scale};
}

export function createSpellVisuals(getView){
 const players=new Set();
 function stop(){for(const player of players)player.stop();players.clear();}
 function trim(){
  while(players.size>=MAX_OVERLAPPING_FX){
   const oldest=players.values().next().value;
   players.delete(oldest);
   oldest.stop();
  }
 }
 // Overlapping casts are intentional: combat cues start the next resolve before prior FX finish.
 function play(event,done,{durationScale=1}={}){
  const targets=Array.isArray(event.visualTargets)?event.visualTargets.slice(0,7):[];
  const points=[...targets,event.visualDeparture].filter(point=>Number.isFinite(point?.x)&&Number.isFinite(point?.y));
  const casts=[event,...points.map(point=>({...event,visualPoint:point,visualAim:point}))].map(cast=>pacedCast(cast,durationScale));
  let remaining=casts.length;
  for(const cast of casts){
   trim();
   const player=createSingleVisual(getView);
   players.add(player);
   player.play(cast,()=>{
    players.delete(player);
    if(--remaining===0)done();
   });
  }
 }
 return {play,stop,place(){for(const player of players)player.place();}};
}
