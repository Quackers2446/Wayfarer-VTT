const storageKey='wayfarer-message-panels-v1';
const clamp=(value,min,max)=>Math.max(min,Math.min(value,Math.max(min,max)));
export function createFloatingPanels(){
  let saved={};try{const value=JSON.parse(localStorage.getItem(storageKey));if(value && typeof value==='object' && !Array.isArray(value))saved=value;}catch{}
  let screen,dock,observer,gesture;
  const panels=new Map(),visibility=new Map();let front="chat";
  function raise(kind){front=kind;for(const [key,panel] of panels)panel.style.zIndex=key===front?"2":"1";}
  const persist=()=>{try{localStorage.setItem(storageKey,JSON.stringify(saved));}catch{}};
  function state(kind){const value=saved[kind];return value && typeof value==='object' ? value : (saved[kind]={});}
  function visible(panel){return panel && getComputedStyle(panel).display!=='none';}
  function layout(){
    if(!dock?.isConnected)return;
    const width=dock.clientWidth,height=dock.clientHeight;
    if(!width || !height)return;
    const chatVisible=visible(panels.get('chat'));
    for(const [kind,panel] of panels){
      const value=state(kind),minWidth=Math.min(240,width),minHeight=Math.min(kind==='chat'?180:100,height);
      const w=clamp(Number.isFinite(value.width)?value.width:Math.min(330,width-(width<600?63:0)),minWidth,width);
      const h=clamp(Number.isFinite(value.height)?value.height:kind==='chat'||panel.dataset.logMode==='expanded'?height:240,minHeight,height);
      const defaultX=kind==='log' && chatVisible && width>=w*2+8 ? width-w*2-8 : width-w;
      const x=clamp(Number.isFinite(value.x)?value.x:defaultX,0,width-w);
      const y=clamp(Number.isFinite(value.y)?value.y:kind==='chat'?0:height-h,0,height-h);
      for(const [key,value] of Object.entries({left:x,top:y,width:w,height:h}))panel.style.setProperty('--panel-'+key,value+'px');
    }
    // Keep the camera controls reachable beside panels that cover their corner.
    const controls=screen.querySelector('.map-controls'),middle=screen.querySelector('.game-middle');
    if(controls && middle){
      const bounds=middle.getBoundingClientRect(),c=controls.getBoundingClientRect();let edge=bounds.right-8;
      for(const panel of panels.values())if(visible(panel)){const p=panel.getBoundingClientRect();if(p.bottom>c.top && p.top<c.bottom)edge=Math.min(edge,p.left-8);}
      const right=edge-bounds.left>=c.width+78 ? bounds.right-edge-8 : 0;
      screen.style.setProperty('--message-controls-right',right+'px');
    }
  }
  function rect(kind){const panel=panels.get(kind),r=panel.getBoundingClientRect(),d=dock.getBoundingClientRect();return {x:r.left-d.left,y:r.top-d.top,width:r.width,height:r.height};}
  function handle(event){
    const clicked=event.target.closest?.('[data-floating-panel]');if(clicked && dock?.contains(clicked))raise(clicked.dataset.floatingPanel);
    const control=event.target.closest?.('[data-panel-move],[data-panel-resize]');
    if(!control || !dock?.contains(control) || event.button!==0)return;
    const panel=control.closest('[data-floating-panel]'),kind=panel.dataset.floatingPanel;
    event.preventDefault();event.stopPropagation();
    control.setPointerCapture?.(event.pointerId);
    gesture={kind,pointer:event.pointerId,resize:control.dataset.panelResize,startX:event.clientX,startY:event.clientY,...rect(kind)};
    panel.classList.add('panel-interacting');panel.style.zIndex='2';
  }
  function move(event){
    if(!gesture || event.pointerId!==gesture.pointer)return;
    if(!dock?.isConnected){gesture=null;return;}
    event.preventDefault();event.stopImmediatePropagation();const g=gesture,value=state(g.kind),dx=event.clientX-g.startX,dy=event.clientY-g.startY;
    const minH=Math.min(g.kind==='chat'?180:100,dock.clientHeight);
    if(g.resize==='top'){
      const top=clamp(g.y+dy,0,g.y+g.height-minH);Object.assign(value,{x:g.x,y:top,width:g.width,height:g.height+g.y-top});
    }else if(g.resize){Object.assign(value,{x:g.x,y:g.y,width:clamp(g.width+dx,Math.min(240,dock.clientWidth),dock.clientWidth-g.x),height:clamp(g.height+dy,minH,dock.clientHeight-g.y)});}
    else Object.assign(value,{x:clamp(g.x+dx,0,dock.clientWidth-g.width),y:clamp(g.y+dy,0,dock.clientHeight-g.height),width:g.width,height:g.height});
    layout();
  }
  function end(event){if(!gesture || event.pointerId!==gesture.pointer)return;panels.get(gesture.kind)?.classList.remove('panel-interacting');gesture=null;persist();}
  document.addEventListener('pointerdown',handle);
  document.addEventListener('pointermove',move,{passive:false});
  document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
  document.addEventListener('keydown',event=>{
    const control=event.target.closest?.('[data-panel-move],[data-panel-resize]');if(!control || !dock?.contains(control) || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();event.stopImmediatePropagation();const kind=control.closest('[data-floating-panel]').dataset.floatingPanel,value=state(kind),r=rect(kind),step=event.shiftKey?48:16;
    const dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
    Object.assign(value,r);
    if(control.hasAttribute('data-panel-resize')){value.width+=dx;value.height+=dy;}else{value.x+=dx;value.y+=dy;}
    layout();persist();
  });
  document.addEventListener('click',event=>{
    const reset=event.target.closest?.('[data-panel-reset]');if(!reset || !dock?.contains(reset))return;
    event.preventDefault();const kind=reset.closest('[data-floating-panel]').dataset.floatingPanel;delete saved[kind];layout();persist();
  });
  return {mount(element){
    observer?.disconnect();screen=element;dock=screen?.querySelector('.game-social-dock');panels.clear();if(!dock)return;
    for(const [kind,selector,name] of [['chat','.game-chat-slot','party chat'],['log','.game-event-slot','activity log']]){
      const panel=dock.querySelector(selector);if(!panel)continue;panels.set(kind,panel);panel.dataset.floatingPanel=kind;
      if(kind==='log') {const value=state(kind);if(value.mode && value.mode!==panel.dataset.logMode && panel.dataset.logMode!=='collapsed'){value.height=panel.dataset.logMode==='expanded'?null:240;value.y=null;}if(panel.dataset.logMode!=='collapsed')value.mode=panel.dataset.logMode;}
      const header=panel.querySelector('.chat-header,.game-event-header');
      if(header && !header.querySelector('[data-panel-move]')){
        const grip=document.createElement('button');grip.type='button';grip.id='panel-move-'+kind;grip.className='panel-move';grip.dataset.panelMove='';grip.setAttribute('aria-label','Move '+name);grip.title='Drag to move; arrow keys also move this panel';grip.textContent='⠿';header.prepend(grip);
        const reset=document.createElement('button');reset.type='button';reset.id='panel-reset-'+kind;reset.className='panel-reset';reset.dataset.panelReset='';reset.setAttribute('aria-label','Reset '+name+' layout');reset.title='Reset position and size';reset.textContent='↺';header.append(reset);
      }
      if(!panel.querySelector('[data-panel-resize]'))for(const edge of ['top','corner']){
        const resize=document.createElement('button');resize.type='button';resize.id='panel-resize-'+kind+'-'+edge;resize.className='panel-resize panel-resize-'+edge;resize.dataset.panelResize=edge;resize.setAttribute('aria-label',edge==='top'?'Resize '+name+' height':'Resize '+name);resize.title='Drag to resize; arrow keys also resize this panel';panel.append(resize);
      }
    }
    for(const [kind,panel] of panels){const next=visible(panel)?panel.dataset.logMode ?? "open":"hidden";if(next!=="hidden" && visibility.get(kind)!==next)front=kind;visibility.set(kind,next);}
    raise(front);observer=new ResizeObserver(layout);observer.observe(dock);layout();
  }};
}
