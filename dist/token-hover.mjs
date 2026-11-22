import {tokenAtPoint} from './grid-view.mjs';
import {cellCenter} from './map-grid.mjs';
import {tokenRadius} from './actor-space.mjs';

export function createTokenHover() {
  let view,point,tooltip;
  const id='token-name-tooltip';
  function hide() {
    if(tooltip) tooltip.hidden=true;
    if(view?.surface?.getAttribute('aria-describedby')===id) view.surface.removeAttribute('aria-describedby');
  }
  function clear() {point=null;hide();}
  function refresh() {
    if(!point || !view?.surface?.isConnected || view.gesturing() || document.elementFromPoint(point.x,point.y)!==view.surface) {hide();return;}
    const {map,battle,surface,visible}=view,bounds=surface.getBoundingClientRect();
    const x=(point.x-bounds.left)*map.width/bounds.width,y=(point.y-bounds.top)*map.height/bounds.height;
    const actor=tokenAtPoint(map,battle,x,y,visible);
    if(!actor) {hide();return;}
    if(!tooltip) {
      tooltip=document.createElement('div');tooltip.id=id;tooltip.className='token-name-tooltip';tooltip.setAttribute('role','tooltip');document.body.append(tooltip);
    }
    tooltip.textContent=actor.name;tooltip.dataset.actor=actor.id;tooltip.hidden=false;surface.setAttribute('aria-describedby',id);
    const [cx,cy]=cellCenter(map,actor),frame=surface.closest('.board-frame').getBoundingClientRect();
    const width=tooltip.offsetWidth,height=tooltip.offsetHeight,screenX=bounds.left+cx/map.width*bounds.width,screenY=bounds.top+cy/map.height*bounds.height;
    const radius=tokenRadius(map,actor)/map.height*bounds.height;
    const left=Math.max(8,frame.left+4),right=Math.min(innerWidth-8,frame.right-4),top=Math.max(8,frame.top+4),bottom=Math.min(innerHeight-8,frame.bottom-4);
    tooltip.style.left=Math.max(left,Math.min(right-width,screenX-width/2))+'px';
    const above=screenY-radius-height-7;
    tooltip.style.top=Math.max(top,Math.min(bottom-height,above>=top ? above : screenY+radius+7))+'px';
  }
  document.addEventListener('pointermove',event=>{
    if(event.target!==view?.surface || event.pointerType==='touch' || event.buttons) {clear();return;}
    point={x:event.clientX,y:event.clientY};refresh();
  });
  document.addEventListener('pointerout',event=>{if(event.target===view?.surface) clear();});
  document.addEventListener('pointerdown',clear,true);
  document.addEventListener('wheel',clear,{capture:true,passive:true});
  window.addEventListener('blur',clear);
  window.addEventListener('resize',clear);
  return {
    sync(next) {hide();view=next;refresh();},
    refresh,
    clear() {clear();view=null;},
  };
}
