import {diceTable,diceCamera} from './dice-layout.mjs';
import {escape} from './format.mjs';
import {diceModel,restingOrientation,rotateVector,faceFrame,dot} from './dice-geometry.mjs';

let rendererModule;
const loadRenderer=()=>rendererModule ??= import('./dice-scene.mjs');
const view=[0,1,0];
const project=p=>[p[0],p[2]];

export function diceNotation(roll) {
  if(roll.diceKinds) return roll.diceKinds.map(die=>(die.sign<0 ? '− ' : '')+die.count+'d'+die.faces).join(' + ').replace(/\+ − /g,'− ');
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
  const q=restingOrientation(model,die.value);
  const vertices=model.vertices.map(v=>rotateVector(q,v));
  const faces=model.faces.map((face,i)=>({...face,i,normal:rotateVector(q,face.normal)}))
    .filter(face=>dot(face.normal,view)>0).sort((a,b)=>dot(a.normal,view)-dot(b.normal,view));
  ctx.save();ctx.translate(x,y);ctx.globalAlpha=1;
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
  panel.innerHTML='<div class="dice-heading"><div><small></small><strong></strong></div><button type="button" class="dice-skip" aria-label="Skip animation" title="Skip animation">Skip</button></div><canvas aria-hidden="true"></canvas><div class="dice-tallies" aria-live="polite"></div>';
  let canvas=panel.querySelector('canvas');const tallies=panel.querySelector('.dice-tallies');
  let frame,finish,active,started,phaseStarted,scene,ctx,attempted=false,generation=0,dice=[],width=1,height=1,duration=0,quiet=false,pace=1,hasMorePending=false;
  let fallbackTable,viewportInsets={};
  let enabled=true;
  try {enabled=localStorage.getItem('wayfarer-dice-fx')!=='off';} catch {}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');

  function stop() {
    hasMorePending=false;
    generation++;cancelAnimationFrame(frame);panel.remove();scene?.clear();
    const done=finish;finish=undefined;active=undefined;done?.();
  }
  panel.querySelector('button').addEventListener('click',stop);

  function resize() {
    const viewport=window.visualViewport;
    Object.assign(panel.style,{width:(viewport?.width ?? innerWidth)+'px',height:(viewport?.height ?? innerHeight)+'px',left:(viewport?.offsetLeft ?? 0)+'px',top:(viewport?.offsetTop ?? 0)+'px'});
    const rect=canvas.getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);
    const heading=panel.querySelector('.dice-heading').getBoundingClientRect(),results=tallies.getBoundingClientRect();
    const hud=document.querySelector('.game-hud')?.getBoundingClientRect();
    const playBottom=hud?.top ?? height;
    const resultTop=Math.min(height-results.height-12,Math.max(heading.bottom+40,Math.min(height*.64,playBottom-results.height-24)));
    tallies.style.top=resultTop+'px';
    viewportInsets={top:heading.bottom-rect.top+16,bottom:Math.max(16,height-resultTop+20),left:16,right:16};
    if(scene) scene.resize(width,height,viewportInsets);
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
    }).join('')+(active.rolls.length>6 ? '<small class="dice-overflow">More rolls are recorded in the combat log.</small>' : '')+
      (active.rolls.reduce((n,r)=>n+(r.diceCount ?? r.dice.length),0)>dice.length ? '<small class="dice-overflow">Showing '+dice.length+' of '+active.rolls.reduce((n,r)=>n+(r.diceCount ?? r.dice.length),0)+' dice. Full results are in the combat log.</small>' : '');
  }

  function animate(now) {
    if(!active) return;
    const elapsed=Math.max(0,now-started);
    if(scene) scene.draw(elapsed/pace);
    else if(ctx) {
      ctx.clearRect(0,0,width,height);
      const supported=dice.filter(die=>diceModel(die.faces));
      fallbackTable=diceTable(supported.length,width,height,viewportInsets);
      const view=diceCamera(width,height,fallbackTable,viewportInsets),{columns,rows,radius}=fallbackTable;
      supported.forEach((die,i)=>fallbackDie(ctx,die,
        width/2+((i%columns-(columns-1)/2)*radius*2.7-view.x)*view.scale,
        height/2+((Math.floor(i/columns)-(rows-1)/2)*radius*2.7-view.z)*view.scale,radius*view.scale));
    }
    const phase=panel.dataset.phase;
    const party=active.side==='party';
    const naturalWait=party ? 220 : 160;
    const modifierWait=party ? 250 : 180;
    const totalWait=hasMorePending ? (party ? 350 : 250) : (party ? 650 : 450);
    const quietWait=hasMorePending ? (party ? 1200 : 900) : (party ? 1700 : 1200);
    if(quiet) tally('total');
    else if(phase==='rolling' && elapsed>=duration) {tally('natural');phaseStarted=now;}
    else if(phase==='natural' && now-phaseStarted>=naturalWait) {tally('modifier');phaseStarted=now;}
    else if(phase==='modifier' && now-phaseStarted>=modifierWait) {tally('total');phaseStarted=now;}
    if(quiet ? elapsed>quietWait : panel.dataset.phase==='total' && now-phaseStarted>totalWait) stop();else frame=requestAnimationFrame(animate);
  }

  async function begin(token) {
    if(!attempted) {
      try {
        const {createDiceScene}=await loadRenderer();if(token!==generation) return;
        scene=createDiceScene(canvas);attempted=true;
      } catch {
        if(token!==generation) return;attempted=true;
        const replacement=canvas.cloneNode();canvas.replaceWith(replacement);canvas=replacement;ctx=canvas.getContext('2d');canvas.dataset.renderer='canvas';canvas.dataset.projection='orthographic-overhead';
      }
    }
    if(token!==generation || !active) return;
    quiet=!enabled || reduced.matches || !scene || !dice.some(die=>diceModel(die.faces));resize();
    try {pace=active.side==='party' ? 1.05 : 0.95;duration=(scene ? scene.prepare(dice,quiet) : 0)*pace;}
    catch {
      scene?.dispose();scene=undefined;quiet=true;duration=0;
      const replacement=canvas.cloneNode();canvas.replaceWith(replacement);canvas=replacement;ctx=canvas.getContext('2d');canvas.dataset.renderer='canvas';canvas.dataset.projection='orthographic-overhead';resize();
    }
    started=performance.now();frame=requestAnimationFrame(animate);
  }

  const layoutObserver=new ResizeObserver(()=>{if(active) resize();});
  layoutObserver.observe(panel.querySelector('.dice-heading'));layoutObserver.observe(tallies);
  window.addEventListener('resize',()=>{if(active) resize();});
  window.visualViewport?.addEventListener('resize',()=>{if(active) resize();});
  return {
    get enabled() {return enabled;},
    get isPlaying() {return Boolean(active);},
    toggle() {enabled=!enabled;try {localStorage.setItem('wayfarer-dice-fx',enabled ? 'on' : 'off');}catch{}return enabled;},
    expedite() {
      if(!active) return;
      hasMorePending=true;
      if(panel.dataset.phase==='total') stop();
      else if(panel.dataset.phase) tally('total');
    },
    play(event,done,hasMore=false) {
      stop();active=event;finish=done;hasMorePending=Boolean(hasMore);
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
