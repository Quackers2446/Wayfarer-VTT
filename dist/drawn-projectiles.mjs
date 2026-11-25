// Small original projectile shapes for weapon types without a matching video.
const styles = new Set(['axe','hammer','stone','spear','trident','dart','needle','arrow','bolt','dagger']);
export const isDrawnProjectile = style => styles.has(style);

function shape(ctx, style) {
  const thrust = !['axe','hammer','stone'].includes(style);
  const length = ['spear','trident'].includes(style) ? .58 : ['arrow','bolt'].includes(style) ? .4 : .28;
  function line(points, color, width) {
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(...points[0]);
    for(const point of points.slice(1))ctx.lineTo(...point);
    ctx.stroke();
  }
  if(style==='stone'){
    ctx.fillStyle='#d6c1a2';ctx.beginPath();ctx.ellipse(0,0,.105,.075,.35,0,Math.PI*2);ctx.fill();
  }else if(thrust){
    line([[-length,0],[length,0]],'#ba9261',.055);
    const tip=style==='needle'?.07:.14;
    line([[length-tip,-tip*.37],[length,0],[length-tip,tip*.37]],'#fff3d6',.048);
    if(style==='trident')for(const y of [-.11,.11]){
      line([[length-.23,0],[length-.14,y],[length-.02,y]],'#fff3d6',.036);
    }
    if(['arrow','bolt','dart'].includes(style)){
      line([[-length,.09],[-length+.13,0],[-length,-.09]],'#eee0bc',.04);
    }
  }else{
    line([[0,.28],[0,-.25]],'#b89168',.085);
    if(style==='axe'){
      ctx.fillStyle='#f0e5d0';ctx.beginPath();ctx.moveTo(-.05,-.23);ctx.lineTo(.2,-.34);
      ctx.quadraticCurveTo(.35,-.18,.21,-.04);ctx.lineTo(-.05,-.11);ctx.closePath();ctx.fill();
    }else{
      ctx.fillStyle='#c8c1b3';ctx.fillRect(-.22,-.28,.44,.16);
    }
  }
}

export function paintDrawnProjectile(canvas, layout, style, progress, impact, missed) {
  const {width,height,unit,distance}=layout;
  const density=Math.min(devicePixelRatio||1,2048/width,512/height);
  const bufferWidth=Math.max(1,Math.round(width*density)),bufferHeight=Math.max(1,Math.round(height*density));
  if(canvas.width!==bufferWidth)canvas.width=bufferWidth;
  if(canvas.height!==bufferHeight)canvas.height=bufferHeight;
  const ctx=canvas.getContext('2d');
  ctx.setTransform(density,0,0,density,0,0);
  ctx.clearRect(0,0,width,height);
  const from=(width-distance)/2, y=height/2;
  ctx.save();ctx.translate(from+distance*progress,y);ctx.scale(unit,unit);
  if(impact>0 && !missed){
    ctx.globalAlpha=1-impact;ctx.strokeStyle='#ffe4ad';ctx.lineWidth=.035;ctx.beginPath();
    for(let i=0;i<7;i++){
      const angle=i*Math.PI*2/7;
      ctx.moveTo(Math.cos(angle)*impact*.25,Math.sin(angle)*impact*.25);
      ctx.lineTo(Math.cos(angle)*(.12+impact*.58),Math.sin(angle)*(.12+impact*.58));
    }
    ctx.stroke();
  }else if(impact===0){
    if(['axe','hammer','stone'].includes(style))ctx.rotate(progress*Math.PI*4);
    shape(ctx,style);
  }
  ctx.restore();
}
