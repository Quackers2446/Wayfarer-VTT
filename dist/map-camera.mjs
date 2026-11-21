import {escape} from "./format.mjs";
import {icon} from "./icons.mjs";

const minZoom = .75;
const maxZoom = 8;
const step = 1.25;
const dragThreshold = 5;
const mapCenter = {x:.5,y:.5};

export function mapViewport(map, game = false) {
  const instructions = game ? "Use the arrow keys and Enter to act on a square." :
    "Use the arrow keys and Enter to apply the grid tool.";
  return `<div class="board-frame${game ? " game-board" : ""}" style="--map-ratio:${map.width}/${map.height}">
    <div class="board-content"><div id="play-grid" tabindex="0" role="application"
      aria-label="${escape(map.title)} grid. ${instructions} Shift and arrows pan. Plus and minus zoom. Zero fits the map.">
      <canvas class="board-raster" aria-hidden="true"></canvas>
    </div></div>
  </div>`;
}

export function mapControls(hasToken) {
  const button = (action, label, symbol, disabled = false) => `<button type="button" class="map-button"
    data-camera="${action}" title="${label}" aria-label="${label}"${disabled ? " disabled" : ""}>${symbol}</button>`;
  return `<div class="map-controls" role="group" aria-label="Map view">
    ${button("out","Zoom out","−")}<span class="map-zoom">100%</span>${button("in","Zoom in","+")}
    ${button("fit","Fit map",icon("fit",16))}${button("token","Center on token",icon("target",16),!hasToken)}
  </div>`;
}

export function mapHint() {
  return `<span class="map-hint"><span class="map-hint-mouse">Drag to pan · Scroll to zoom</span>
    <span class="map-hint-touch">Drag to pan · Pinch to zoom</span></span>`;
}

export function createCamera(frame, controls, map, saved) {
  const content = frame.querySelector(".board-content");
  const surface = content.firstElementChild;
  const canvas = surface.firstElementChild;
  const zoomLabel = controls.querySelector(".map-zoom");
  const zoomIn = controls.querySelector('[data-camera="in"]');
  const zoomOut = controls.querySelector('[data-camera="out"]');
  const listeners = new AbortController();
  const {signal} = listeners;
  let zoom = saved?.zoom ?? 1;
  let lastCenter = saved?.center ?? mapCenter;
  let width, height, left, top, viewWidth, viewHeight;
  let painter, animation, lastView;

  function render(force = false) {
    if (!painter || !frame.isConnected) return;
    // Reuse the same viewport-sized buffer while panning, including near the map edges.
    const visibleWidth = Math.min(width,viewWidth);
    const visibleHeight = Math.min(height,viewHeight);
    if (visibleWidth <= 0 || visibleHeight <= 0) return;
    const x = Math.max(0,Math.min(width-visibleWidth,frame.scrollLeft-left));
    const y = Math.max(0,Math.min(height-visibleHeight,frame.scrollTop-top));
    const ratio = window.devicePixelRatio || 1;
    const view = {x,y,width:visibleWidth,height:visibleHeight,mapWidth:width,mapHeight:height,ratio};
    const changed = !lastView || Object.keys(view).some((key) => view[key] !== lastView[key]);
    if (changed) {
      Object.assign(canvas.style,{left:`${x}px`,top:`${y}px`,width:`${visibleWidth}px`,height:`${visibleHeight}px`});
      lastView = view;
    }
    if (changed || force) painter(canvas,view);
  }

  function scheduleRender() {
    if (animation !== undefined) return;
    animation = requestAnimationFrame(() => {
      animation = undefined;
      render();
    });
  }

  function middle() {return {x:viewWidth/2,y:viewHeight/2};}
  function position(point = middle()) {
    if (!width || !height) return mapCenter;
    return {x:(frame.scrollLeft + point.x - left)/width,y:(frame.scrollTop + point.y - top)/height};
  }
  function aim(world, point = middle()) {
    frame.scrollTo(left + world.x*width - point.x,top + world.y*height - point.y);
    lastCenter = position();
    scheduleRender();
  }
  function layout() {
    viewWidth = frame.clientWidth;
    viewHeight = frame.clientHeight;
    const fit = Math.min(viewWidth/map.width,viewHeight/map.height);
    width = fit*map.width*zoom;
    height = fit*map.height*zoom;
    left = viewWidth/2;
    top = viewHeight/2;
    content.style.width = `${viewWidth + width}px`;
    content.style.height = `${viewHeight + height}px`;
    Object.assign(surface.style,{width:`${width}px`,height:`${height}px`,left:`${left}px`,top:`${top}px`});
    zoomLabel.textContent = `${Math.round(zoom*100)}%`;
    zoomIn.disabled = zoom >= maxZoom;
    zoomOut.disabled = zoom <= minZoom;
  }
  function scale(value, point = middle(), world = position(point)) {
    const next = Math.min(maxZoom,Math.max(minZoom,value));
    if (next !== zoom) {
      zoom = next;
      layout();
    }
    aim(world,point);
  }
  function local({clientX,clientY}) {
    const bounds = frame.getBoundingClientRect();
    return {x:clientX - bounds.left - frame.clientLeft,y:clientY - bounds.top - frame.clientTop};
  }
  layout();
  aim(lastCenter);
  frame.addEventListener("scroll", () => {
    lastCenter = position();
    scheduleRender();
  },{passive:true,signal});

  function resize() {
    if (!frame.isConnected) return;
    if (frame.clientWidth !== viewWidth || frame.clientHeight !== viewHeight) {
      const center = position();
      layout();
      aim(center);
    }
    scheduleRender();
  }
  window.addEventListener("resize",resize,{signal});
  const observer = new ResizeObserver(resize);
  observer.observe(frame);

  frame.addEventListener("wheel", (event) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewHeight : 1;
    if (!event.ctrlKey && (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))) {
      frame.scrollBy((event.deltaX || event.deltaY)*unit,event.shiftKey ? 0 : event.deltaY*unit);
    } else if (event.deltaY) {
      const delta = Math.max(-200,Math.min(200,event.deltaY*unit));
      scale(zoom*Math.exp(-delta*(event.ctrlKey ? .015 : .0025)),local(event));
    }
  },{passive:false,signal});

  const pointers = new Map();
  let drag, pinch, blockClick;
  function startDrag(pointer) {
    drag = {x:pointer.clientX,y:pointer.clientY,left:frame.scrollLeft,top:frame.scrollTop};
  }
  function pinchGeometry() {
    const [a,b] = pointers.values();
    return {
      point:local({clientX:(a.clientX+b.clientX)/2,clientY:(a.clientY+b.clientY)/2}),
      distance:Math.max(1,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)),
    };
  }
  function markDrag() {
    blockClick = true;
    frame.classList.add("board-panning");
    for (const id of pointers.keys()) frame.setPointerCapture(id);
  }
  frame.addEventListener("pointerdown", (event) => {
    if (![0,1].includes(event.button) || pointers.size >= 2 || (pointers.size && event.pointerType !== "touch")) return;
    pointers.set(event.pointerId,event);
    if (pointers.size === 1) {
      blockClick = false;
      startDrag(event);
    } else {
      const {point,distance} = pinchGeometry();
      pinch = {zoom,world:position(point),distance};
      markDrag();
    }
  },{signal});
  frame.addEventListener("mousedown", (event) => {if (event.button === 1) event.preventDefault();},{signal});
  window.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    event.stopPropagation();
    pointers.set(event.pointerId,event);
    if (pinch) {
      const {point,distance} = pinchGeometry();
      scale(pinch.zoom*distance/pinch.distance,point,pinch.world);
      return;
    }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!blockClick && Math.hypot(dx,dy) < dragThreshold) return;
    if (!blockClick) markDrag();
    frame.scrollTo(drag.left - dx,drag.top - dy);
  },{capture:true,signal});
  function release(event) {
    if (!pointers.delete(event.pointerId)) return;
    pinch = null;
    if (pointers.size) startDrag(pointers.values().next().value);
    else frame.classList.remove("board-panning");
  }
  for (const type of ["pointerup","pointercancel","lostpointercapture"]) {
    window.addEventListener(type,release,{capture:true,signal});
  }
  frame.addEventListener("click", (event) => {
    if (!blockClick || !event.detail) return;
    event.preventDefault();
    event.stopPropagation();
  },{capture:true,signal});

  return {
    state:() => ({zoom,center:frame.isConnected ? position() : lastCenter}),
    destroy() {
      listeners.abort();
      observer.disconnect();
      if (animation !== undefined) cancelAnimationFrame(animation);
      canvas.width = canvas.height = 0;
    },
    paint(draw) {painter = draw; render(true);},
    control(action, token) {
      if (action === "fit") scale(1,middle(),mapCenter);
      if (action === "token" && token) aim(token);
      if (action === "in") scale(zoom*step);
      if (action === "out") scale(zoom/step);
    },
    pan(dx,dy) {frame.scrollBy(dx*viewWidth/5,dy*viewHeight/5);},
    reveal({x,y}) {
      const screenX = left + x*width - frame.scrollLeft;
      const screenY = top + y*height - frame.scrollTop;
      const gutter = 20;
      frame.scrollBy(screenX - Math.max(gutter,Math.min(viewWidth-gutter,screenX)),
        screenY - Math.max(gutter,Math.min(viewHeight-gutter,screenY)));
    },
  };
}
