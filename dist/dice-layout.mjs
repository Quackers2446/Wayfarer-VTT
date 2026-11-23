// Pixel-safe tabletop bounds shared by physics, WebGL, and the static fallback.
export function diceSafeRect(width,height,insets={}) {
  const left=Math.min(width*.2,Math.max(12,insets.left||0)),right=Math.min(width*.2,Math.max(12,insets.right||0));
  const top=Math.min(Math.max(12,height-24),Math.max(12,insets.top||0));
  const bottom=Math.min(Math.max(12,height-top-12),Math.max(12,insets.bottom||0));
  return {left,top,width:Math.max(1,width-left-right),height:Math.max(1,height-top-bottom)};
}
export function diceTable(count,width,height,insets={}) {
  const rect=diceSafeRect(width,height,insets),n=Math.max(1,count);
  let columns=1,cellRadius=0;
  for(let cols=1;cols<=n;cols++) {
    const radius=Math.min(rect.width/(cols*2.8),rect.height/(Math.ceil(n/cols)*2.8));
    if(radius>cellRadius) {columns=cols;cellRadius=radius;}
  }
  const radius=Math.min(.96,2.2/Math.sqrt(n)),scale=Math.min(56,cellRadius)/radius;
  return {radius,columns,rows:Math.ceil(n/columns),halfX:rect.width/(2*scale),halfZ:rect.height/(2*scale)};
}
export function diceCamera(width,height,table,insets={}) {
  const rect=diceSafeRect(width,height,insets),scale=Math.min(rect.width/(2*table.halfX),rect.height/(2*table.halfZ));
  return {scale,left:-width/(2*scale),right:width/(2*scale),top:height/(2*scale),bottom:-height/(2*scale),
    x:(width/2-rect.left-rect.width/2)/scale,z:(height/2-rect.top-rect.height/2)/scale};
}
