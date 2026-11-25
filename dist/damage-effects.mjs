import {cellCenter} from './map-grid.mjs';

const effects = {
  acid: ['drops','#a9eb45','#f0ffad'],
  bludgeoning: ['shock','#e0ad70','#fff1cb'],
  cold: ['shards','#79c8ff','#e2f9ff'],
  fire: ['embers','#ff612f','#ffdc75'],
  force: ['shock','#ad8cff','#f1ddff'],
  lightning: ['bolts','#50baff','#ecfbff'],
  necrotic: ['smoke','#9d468c','#e99fc6'],
  piercing: ['points','#e8bc9d','#fff1d8'],
  poison: ['smoke','#79a950','#bce98c'],
  psychic: ['wave','#db71da','#ffd7f8'],
  radiant: ['rays','#ffcf59','#fff6c4'],
  slashing: ['cuts','#ed9b96','#fff4e9'],
  thunder: ['wave','#8dadc5','#e0f6ff'],
};

const lifetime=760;

export function damageEffectSpecs(impacts) {
  const perTarget=new Map();
  const result=[];
  for(const impact of impacts){
    if(impact.healing || !(impact.amount>0) || !Number.isFinite(impact.x) || !Number.isFinite(impact.y))continue;
    const type=Object.hasOwn(effects,impact.type)?impact.type:'bludgeoning';
    const types=perTarget.get(impact.actor)??new Set();
    if(types.has(type))continue;
    const delay=Math.min(types.size,2)*135;
    types.add(type);
    perTarget.set(impact.actor,types);
    result.push({impact,type,delay});
  }
  return result;
}

export function createDamageEffects(getView) {
  const active=new Set();
  function discard(effect){
    clearTimeout(effect.timer);
    effect.node.remove();
    active.delete(effect);
  }
  function place(){
    if(!active.size)return;
    const view=getView();
    if(!view?.layer.isConnected)return;
    const bounds=view.grid.getBoundingClientRect(),origin=view.layer.getBoundingClientRect();
    const unit=view.map.size/view.map.width*bounds.width;
    for(const effect of active){
      const {node,impact,start,delay}=effect;
      node.hidden=view.fogEnabled&&!view.sight.has(impact.x+':'+impact.y);
      const [x,y]=cellCenter(view.map,impact);
      const units={S:1,M:1,L:2,H:3,G:4}[impact.creatureSize]??1;
      const size=Math.max(20,unit*(units*.55+.95))*(impact.critical?1.14:1);
      node.style.left=(bounds.left-origin.left+x/view.map.width*bounds.width)+'px';
      node.style.top=(bounds.top-origin.top+y/view.map.height*bounds.height)+'px';
      node.style.width=node.style.height=size+'px';
      if(node.parentElement!==view.layer){
        node.style.setProperty('--damage-delay',(delay+start-performance.now())+'ms');
        view.layer.append(node);
      }
    }
  }

  function play(impacts){
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const start=performance.now();
    for(const spec of damageEffectSpecs(impacts)){
      // Bound work for large encounters while keeping damage numbers for every target.
      if(active.size>=48)break;
      const {impact,type,delay}=spec,[pattern,color,highlight]=effects[type];
      const node=document.createElement('div');
      node.className='damage-effect';
      node.dataset.damageType=type;
      node.dataset.pattern=pattern;
      node.setAttribute('aria-hidden','true');
      node.style.setProperty('--damage-color',color);
      node.style.setProperty('--damage-highlight',highlight);
      const count=['wave','shock','cuts'].includes(pattern)?3:7;
      for(let index=0;index<count;index++){
        const particle=document.createElement('i');
        const angle=360*index/count+(index%2?12:0);
        const spread=22+(index%3)*7;
        particle.style.setProperty('--damage-angle',angle+'deg');
        particle.style.setProperty('--damage-spread',spread+'%');
        particle.style.setProperty('--damage-particle-delay',(index%3)*36+'ms');
        node.append(particle);
      }
      const effect={node,impact,start,delay,timer:setTimeout(()=>discard(effect),lifetime+delay)};
      active.add(effect);
    }
    place();
  }
  return {play,place,reset(){for(const effect of active)discard(effect);}};
}
