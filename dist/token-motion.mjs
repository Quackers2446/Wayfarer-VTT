const same=(a,b)=>a && b && a.x===b.x && a.y===b.y;
export function createTokenMotion(onFrame,now=()=>performance.now(),reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const positions=new Map(),labels=new Map(),tracks=new Map(),last=new Map();
  let scope,cursor=0,frame;
  function sample(track,time) {
    const t=Math.max(0,Math.min(1,(time-track.started)/track.duration)),part=t*(track.points.length-1),i=Math.min(track.points.length-2,Math.floor(part));
    const a=track.points[i],b=track.points[i+1],fraction=part-i;
    return {x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction};
  }
  function tick(time) {
    frame=undefined;
    for(const [id,track] of tracks) {
      positions.set(id,sample(track,time));
      if(time>=track.started+track.duration) tracks.delete(id);
    }
    for(const [id,label] of labels) if(time>=label.until) labels.delete(id);
    onFrame();
    if(tracks.size || labels.size) frame=requestAnimationFrame(tick);
  }
  function reset() {cancelAnimationFrame(frame);frame=undefined;positions.clear();tracks.clear();last.clear();labels.clear();cursor=0;scope=undefined;}
  return {
    positions,labels,reset,
    remaining(id) {const t=tracks.get(id);return t ? Math.max(0,t.started+t.duration-now()) : 0;},
    sync(nextScope,battle) {
      const events=battle.actionEvents ?? [],latest=events.at(-1)?.id ?? 0,time=now(),initial=scope!==nextScope || latest<cursor;
      if(initial) {reset();scope=nextScope;}
      const fresh=events.filter(e=>e.id>cursor && (e.kind==='move' || /^Moved /.test(e.action))),live=new Set();
      // Several tokens shifting in one sync (enemy wave) share a compressed slide so moves overlap instead of feeling serial.
      const movingIds=new Set();
      if(!initial) for(const actor of battle.actors) {
        if(actor.x==null || actor.y==null) continue;
        const previous=last.get(actor.id);
        if(previous && !same(previous,{x:actor.x,y:actor.y}) && fresh.some(e=>e.actor===actor.id)) movingIds.add(actor.id);
      }
      const crowd=movingIds.size,moveScale=crowd>1 ? Math.max(0.4,0.92-(crowd-1)*0.09) : 1;
      for(const actor of battle.actors) {
        if(actor.x==null || actor.y==null) continue;live.add(actor.id);
        const previous=last.get(actor.id),destination={x:actor.x,y:actor.y};
        if(previous && !same(previous,destination) && !initial) {
          const moves=fresh.filter(e=>e.actor===actor.id),old=tracks.get(actor.id),points=[old ? sample(old,time) : positions.get(actor.id) ?? previous];
          if(old) points.push(...old.points.slice(Math.floor(Math.max(0,(time-old.started)/old.duration)*(old.points.length-1))+1));
          if(moves.length) for(const move of moves) points.push(...(move.path?.length ? move.path : [{x:move.x,y:move.y}]));
          else if(!actor.concentration?.teleport) points.push(destination);
          if(!same(points.at(-1),destination)) points.push(destination);
          const route=points.filter((p,i)=>!i || !same(p,points[i-1]));
          // Dragged corpses also slide so they visibly trail behind the mover.
          if((moves.length && actor.hp>0 && !actor.dead || actor.draggedBy) && !reduced() && route.length>1) {
            const base=Math.min(old ? 650 : 1800,Math.max(180,(route.length-1)*(actor.side==='party' ? 160 : 190)));
            const duration=Math.round(base*moveScale);
            tracks.set(actor.id,{points:route,started:time,duration});positions.set(actor.id,route[0]);
          } else {tracks.delete(actor.id);positions.set(actor.id,destination);}
          if(moves.length) {
            const distance=moves.reduce((n,e)=>n+(e.distance ?? (Number(/Moved (\d+)/.exec(e.action)?.[1]) || 0)),0);
            labels.set(actor.id,{text:distance+' ft',until:time+Math.max(900,this.remaining(actor.id)+500)});
          }
        } else if(!positions.has(actor.id)) positions.set(actor.id,destination);
        last.set(actor.id,destination);
      }
      for(const id of last.keys()) if(!live.has(id)) {last.delete(id);positions.delete(id);tracks.delete(id);labels.delete(id);}
      cursor=latest;
      if((tracks.size || labels.size) && frame===undefined) frame=requestAnimationFrame(tick);
    },
  };
}
