// Require the gesture to start and finish on the backdrop, so dragging out of a form keeps it open.
export function dismissOnBackdrop(dialog,enabled=()=>true){
 let startedOutside=false;
 const outside=event=>{const rect=dialog.getBoundingClientRect();return event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom;};
 dialog.addEventListener('pointerdown',event=>{startedOutside=event.button===0&&event.target===dialog&&outside(event);});
 dialog.addEventListener('pointercancel',()=>{startedOutside=false;});
 dialog.addEventListener('click',event=>{const dismiss=startedOutside&&event.target===dialog&&outside(event)&&enabled();startedOutside=false;if(dismiss)dialog.close();});
}
