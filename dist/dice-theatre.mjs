import {escape} from './format.mjs';
import {diceModel,restingOrientation,cameraFacingOrientation,rotateVector,faceFrame,dot} from './dice-geometry.mjs';

let rendererModule;
const loadRenderer=()=>rendererModule ??= import('./dice-scene.mjs');
const view=[0,.8638,.5039];
const project=p=>[p[0],-.5039*p[1]+.8638*p[2]];

export function diceNotation(roll) {
  const counts=new Map();
  for(const die of roll.dice ?? []) {
    const key=(die.sign<0 ? '-' : '')+'d'+die.faces;
    counts.set(key,(counts.get(key) ?? 0)+1);
  }
  return [...counts].map(([key,count])=>(key.startsWith('-') ? '− ' : '')+count+key.replace('-','')).join(' + ').replace(/\+ − /g,'− ');
}

export function visualDice(rolls,limit=16) {
  const all=rolls.flatMap((roll,group)=>roll.dice.map(die=>({...die,group}))),chosen=new Set(),types=new Set();
  // Keep every die type represented when a large pool needs a visual limit.
  for(let i=0;i<all.length && chosen.size<limit;i++) {
    const key=all[i].group+':'+all[i].faces;
    if(!types.has(key)) {types.add(key);chosen.add(i);}
  }
  for(let i=0;i<all.length && chosen.size<limit;i++) chosen.add(i);
  return [...chosen].sort((a,b)=>a-b).map(i=>all[i]);
}

// A readable, correctly numbered static die also works without WebGL.
function fallbackDie(ctx,die,x,y,radius) {
  const model=diceModel(die.faces);if(!model) return;
  const q=die.faces===20 ? cameraFacingOrientation(model,die.value,[0,0,0],view,[0,.5039,-.8638]) : restingOrientation(model,die.value);
  const vertices=model.vertices.map(v=>rotateVector(q,v));
  const faces=model.faces.map((face,i)=>({...face,i,normal:rotateVector(q,face.normal)}))
    .filter(face=>dot(face.normal,view)>0).sort((a,b)=>dot(a.normal,view)-dot(b.normal,view));
  ctx.save();ctx.translate(x,y);ctx.globalAlpha=die.discarded ? .3 : 1;
  for(const face of faces) {
    const points=face.indices.map(i=>project(vertices[i]).map(n=>n*radius));
    ctx.beginPath();points.forEach(([x,y],i)=>i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));ctx.closePath();
    const light=dot(face.normal,[-.4,.8,.4]);
    ctx.fillStyle=die.group===0 ? `hsl(346 58% ${25+Math.max(0,light)*24}%)` : `hsl(178 48% ${20+Math.max(0,light)*23}%)`;ctx.fill();
    ctx.lineWidth=.8;ctx.strokeStyle=die.group===0 ? '#bf7a75' : '#6fb9b0';ctx.stroke();
    if(dot(face.normal,view)<.18) continue;
    const faceBasis=faceFrame(model,face.i),u=project(rotateVector(q,faceBasis.u)),v=project(rotateVector(q,faceBasis.v)),center=project(rotateVector(q,face.center));
    ctx.save();ctx.transform(u[0],u[1],-v[0],-v[1],center[0]*radius,center[1]*radius);
    ctx.fillStyle='#fff0ce';ctx.textAlign='center';ctx.textBaseline='middle';
    if(model.sides===4) {
      ctx.font=`600 ${radius*.22}px Georgia,serif`;
      for(const i of face.indices) {
        const delta=model.vertices[i].map((x,k)=>x-face.center[k]),u=dot(delta,faceBasis.u),v=dot(delta,faceBasis.v);
        ctx.save();ctx.translate(u*radius*.56,-v*radius*.56);ctx.rotate(Math.atan2(u,v));ctx.fillText(String(i+1),0,0);ctx.restore();
      }
    } else {
      ctx.font=`600 ${radius*.38}px Georgia,serif`;ctx.fillText(String(face.value),0,0);
      if(face.value===6 || face.value===9) ctx.fillRect(-radius*.07,radius*.23,radius*.14,Math.max(1,radius*.02));
    }
    ctx.restore();
  }
  ctx.restore();
}

export function createDiceTheatre() {
  const panel=document.createElement('section');panel.className='dice-theatre';panel.setAttribute('aria-label','Dice roll');
  panel.innerHTML='<div class="dice-heading"><div><small></small><strong></strong></div><button type="button" class="game-button">Skip animation</button></div><canvas aria-hidden="true"></canvas><div class="dice-tallies" aria-live="polite"></div>';
  let canvas=panel.querySelector('canvas');const tallies=panel.querySelector('.dice-tallies');
  let frame,finish,active,started,phaseStarted,scene,ctx,attempted=false,generation=0,dice=[],width=1,height=1,duration=0,quiet=false;
  let enabled=true;
  try {enabled=localStorage.getItem('wayfarer-dice-fx')!=='off';} catch {}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');

  function stop() {
    generation++;cancelAnimationFrame(frame);panel.remove();scene?.clear();
    const done=finish;finish=undefined;active=undefined;done?.();
  }
  panel.querySelector('button').addEventListener('click',stop);

  function resize() {
    const rect=canvas.getBoundingClientRect();width=Math.max(160,rect.width);height=Math.max(100,rect.height);
    if(scene) scene.resize(width,height);
    else if(ctx) {const ratio=Math.min(2,devicePixelRatio || 1);canvas.width=width*ratio;canvas.height=height*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);}
  }

  function tally(phase) {
    if(panel.dataset.phase===phase) return;panel.dataset.phase=phase;
    tallies.innerHTML=active.rolls.slice(0,6).map(roll=>{
      const base=roll.kept ?? roll.base ?? roll.dice.reduce((sum,die)=>sum+(die.discarded ? 0 : die.value*(die.sign ?? 1)),0),modifier=roll.total-base;
      return `<div class="dice-tally"><small>${escape(roll.label || 'Roll')} · <b class="dice-types">${escape(diceNotation(roll))}</b>${roll.advantage ? ' · advantage' : roll.disadvantage ? ' · disadvantage' : ''}</small>
        <div><span class="dice-natural">${phase==='rolling' ? '…' : base}</span>
        <span class="dice-modifier">${modifier<0 ? '−' : '+'} ${Math.abs(modifier)}</span><span class="dice-equals">=</span>
        <strong class="dice-total">${roll.total}</strong></div><span class="dice-formula">${escape(roll.breakdown)}</span></div>`;
    }).join('')+(active.rolls.length>6 ? '<small class="dice-overflow">More rolls are recorded in the combat log.</small>' : '');
  }

  function animate(now) {
    if(!active) return;
    const elapsed=Math.max(0,now-started);
    if(scene) scene.draw(elapsed);
    else if(ctx) {
      ctx.clearRect(0,0,width,height);
      const supported=dice.filter(die=>diceModel(die.faces)),columns=Math.min(supported.length,6),rows=Math.ceil(supported.length/Math.max(1,columns));
      supported.forEach((die,i)=>fallbackDie(ctx,die,width*((i%columns)+.5)/columns,height*(Math.floor(i/columns)+.5)/rows,Math.min(65,width/(columns*2.5),height/(rows*2.5))));
    }
    const phase=panel.dataset.phase;
    if(quiet) tally('total');
    else if(phase==='rolling' && elapsed>=duration) {tally('natural');phaseStarted=now;}
    else if(phase==='natural' && now-phaseStarted>=350) {tally('modifier');phaseStarted=now;}
    else if(phase==='modifier' && now-phaseStarted>=450) {tally('total');phaseStarted=now;}
    if(quiet ? elapsed>750 : panel.dataset.phase==='total' && now-phaseStarted>750) stop();else frame=requestAnimationFrame(animate);
  }

  async function begin(token) {
    if(!attempted) {
      try {
        const {createDiceScene}=await loadRenderer();if(token!==generation) return;
        scene=createDiceScene(canvas);attempted=true;
      } catch {
        if(token!==generation) return;attempted=true;
        const replacement=canvas.cloneNode();canvas.replaceWith(replacement);canvas=replacement;ctx=canvas.getContext('2d');canvas.dataset.renderer='canvas';
      }
    }
    if(token!==generation || !active) return;
    quiet=!enabled || reduced.matches || !scene || !dice.some(die=>diceModel(die.faces));resize();
    try {duration=scene ? scene.prepare(dice,quiet) : 0;}
    catch {
      scene?.dispose();scene=undefined;quiet=true;duration=0;
      const replacement=canvas.cloneNode();canvas.replaceWith(replacement);canvas=replacement;ctx=canvas.getContext('2d');canvas.dataset.renderer='canvas';resize();
    }
    started=performance.now();frame=requestAnimationFrame(animate);
  }

  window.addEventListener('resize',()=>{if(active) resize();});
  return {
    get enabled() {return enabled;},
    toggle() {enabled=!enabled;try {localStorage.setItem('wayfarer-dice-fx',enabled ? 'on' : 'off');}catch{}return enabled;},
    play(event,done) {
      stop();active=event;finish=done;
      panel.querySelector('.dice-heading small').textContent=event.name;panel.querySelector('.dice-heading strong').textContent=event.action;
      delete panel.dataset.phase;document.body.append(panel);
      dice=visualDice(event.rolls);
      const count=event.rolls.reduce((sum,roll)=>sum+(roll.diceCount ?? roll.dice.length),0);
      panel.querySelector('canvas').setAttribute('aria-label',dice.length<count ? `Showing ${dice.length} of ${count} dice; full results are in the combat log.` : 'Recorded dice');
      tally('rolling');begin(generation);
    },
    resize,stop,
  };
}
