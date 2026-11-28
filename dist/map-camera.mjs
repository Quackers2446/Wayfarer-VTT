import {escape} from "./format.mjs";
import {rasterPixelRatio} from "./grid-view.mjs";
import {icon} from "./icons.mjs";

const minZoom = .75;
const maxZoom = 8;
const step = 1.25;
const dragThreshold = 8;
const panBuffer = 64;
const mapCenter = {x:.5,y:.5};

export function mapViewport(map, game = false) {
  const instructions = game ? "Use WASD or arrow keys to move the selected character. Shift and arrow keys pan the map." :
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
  return `<span class="map-hint"><span class="map-hint-mouse">Drag or right-drag to pan · Scroll to zoom</span>
    <span class="map-hint-touch">One finger pans · Pinch zooms</span></span>`;
}

export function createCamera(frame, controls, map, saved, onView, onTap) {
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
    onView?.();
    const visibleWidth = Math.min(width,viewWidth);
    const visibleHeight = Math.min(height,viewHeight);
    if (visibleWidth <= 0 || visibleHeight <= 0) return;
    const x = Math.max(0,Math.min(width-visibleWidth,frame.scrollLeft-left));
    const y = Math.max(0,Math.min(height-visibleHeight,frame.scrollTop-top));
    const ratio = window.devicePixelRatio || 1;
    // A small margin lets the browser scroll painted pixels while the camera stays at the same zoom.
    const paddedWidth = Math.min(width,visibleWidth + 2*panBuffer);
    const paddedHeight = Math.min(height,visibleHeight + 2*panBuffer);
    const padded = rasterPixelRatio(paddedWidth,paddedHeight,ratio) === ratio;
    const rasterWidth = padded ? paddedWidth : visibleWidth;
    const rasterHeight = padded ? paddedHeight : visibleHeight;
    if (lastView && lastView.mapWidth === width && lastView.mapHeight === height && lastView.ratio === ratio &&
        lastView.width === rasterWidth && lastView.height === rasterHeight &&
        x >= lastView.x && y >= lastView.y &&
        x + visibleWidth <= lastView.x + rasterWidth && y + visibleHeight <= lastView.y + rasterHeight) {
      if (force) painter(canvas,lastView);
      return;
    }
    const rasterX = Math.max(0,Math.min(width-rasterWidth,x-(rasterWidth-visibleWidth)/2));
    const rasterY = Math.max(0,Math.min(height-rasterHeight,y-(rasterHeight-visibleHeight)/2));
    Object.assign(canvas.style,{left:`${rasterX}px`,top:`${rasterY}px`,width:`${rasterWidth}px`,height:`${rasterHeight}px`});
    lastView = {x:rasterX,y:rasterY,width:rasterWidth,height:rasterHeight,mapWidth:width,mapHeight:height,ratio};
    painter(canvas,lastView);
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

  const pointers = new Map();
  let drag, pinch, pinchFrame, blockClick;
  const moveThreshold = (pointerType) => pointerType === "touch" ? 10 : dragThreshold;
  frame.addEventListener("wheel", (event) => {
    if (pointers.size) {event.preventDefault(); return;}
    // Plain scroll zooms (trackpads / mice). Pan with drag — never require Ctrl.
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewHeight : 1;
    const delta = Math.max(-180,Math.min(180,event.deltaY*unit));
    if (delta) scale(zoom*Math.exp(-delta*.005),local(event));
  },{passive:false,signal});
  function startDrag(pointer) {
    drag = {x:pointer.clientX,y:pointer.clientY,left:frame.scrollLeft,top:frame.scrollTop,pointerType:pointer.pointerType,button:pointer.button};
  }
  function pinchGeometry() {
    const [a,b] = pointers.values();
    return {
      point:local({clientX:(a.clientX+b.clientX)/2,clientY:(a.clientY+b.clientY)/2}),
      distance:Math.max(1,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)),
    };
  }
  function updatePinch() {
    pinchFrame = undefined;
    if (pointers.size < 2 || !pinch) return;
    const {point,distance} = pinchGeometry();
    // Two fingers always pinch-zoom (midpoint stays on the same world point).
    scale(pinch.zoom*distance/pinch.distance,point,pinch.world);
  }
  function capturePointers() {
    for (const id of pointers.keys()) {
      try { frame.setPointerCapture(id); } catch { /* already released */ }
    }
  }
  function markDrag() {
    blockClick = true;
    frame.classList.add("board-panning");
    capturePointers();
  }
  frame.addEventListener("pointerdown", (event) => {
    if(event.target.closest?.('.wall-editor-host'))return;
    // 0 left, 1 middle, 2 right — all can pan; touch uses button 0.
    if (![0,1,2].includes(event.button) || pointers.size >= 2 || (pointers.size && event.pointerType !== "touch")) return;
    // Touch: claim the gesture immediately so the page / browser doesn't steal one-finger pans.
    if (event.pointerType === "touch") event.preventDefault();
    pointers.set(event.pointerId,event);
    if (pointers.size === 1) {
      blockClick = false;
      startDrag(event);
      if (event.pointerType === "touch") capturePointers();
    } else {
      // Second finger: leave one-finger pan and start pinch-zoom.
      drag = null;
      const {point,distance} = pinchGeometry();
      pinch = {zoom,world:position(point),point,distance};
      markDrag();
    }
  },{passive:false,signal});
  frame.addEventListener("mousedown", (event) => {if (event.button === 1 || event.button === 2) event.preventDefault();},{signal});
  // After a right-drag pan, suppress the browser context menu on release.
  frame.addEventListener("contextmenu", (event) => {
    if (blockClick || drag?.button === 2 || pointers.size) {
      event.preventDefault();
      event.stopPropagation();
    }
  },{capture:true,signal});
  window.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    pointers.set(event.pointerId,event);
    if (pinch) {
      if (pinchFrame === undefined) pinchFrame = requestAnimationFrame(updatePinch);
      return;
    }
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!blockClick && Math.hypot(dx,dy) < moveThreshold(drag.pointerType || event.pointerType)) return;
    if (!blockClick) markDrag();
    // One finger / one pointer pans the map.
    frame.scrollTo(drag.left - dx,drag.top - dy);
  },{capture:true,passive:false,signal});
  function release(event) {
    if (!pointers.has(event.pointerId)) return;
    if (pinchFrame !== undefined) {
      cancelAnimationFrame(pinchFrame);
      if (event.type === "pointerup") updatePinch();
      pinchFrame = undefined;
    }
    pointers.delete(event.pointerId);
    if (pointers.size >= 2) {
      const {point,distance} = pinchGeometry();
      pinch = {zoom,world:position(point),point,distance};
      return;
    }
    pinch = null;
    if (pointers.size === 1) startDrag(pointers.values().next().value);
    else {
      drag = null;
      frame.classList.remove("board-panning");
    }
  }
  for (const type of ["pointerup","pointercancel","lostpointercapture"]) {
    window.addEventListener(type,release,{capture:true,signal});
  }
  frame.addEventListener("click", (event) => {
    if (blockClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Real tap (not a pan) — Map Studio and other hosts can select tokens here.
    if (typeof onTap === "function" && !event.target.closest?.("[data-camera],.wall-editor-host,.map-controls")) {
      onTap(event);
    }
  },{capture:true,signal});
  // Swallow the synthetic mouse click some browsers fire after a touch pan.
  frame.addEventListener("pointerup", (event) => {
    if (!blockClick || event.pointerType !== "touch") return;
    const swallow = (click) => {
      if (!frame.contains(click.target)) return;
      click.preventDefault();
      click.stopPropagation();
    };
    frame.addEventListener("click", swallow, {capture:true,once:true});
    setTimeout(() => frame.removeEventListener("click", swallow, true), 500);
  },{signal});

  return {
    state:() => ({zoom,center:frame.isConnected ? position() : lastCenter}),
    gesturing:() => pointers.size > 0 || Boolean(blockClick),
    destroy() {
      listeners.abort();
      observer.disconnect();
      if (animation !== undefined) cancelAnimationFrame(animation);
      if (pinchFrame !== undefined) cancelAnimationFrame(pinchFrame);
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
