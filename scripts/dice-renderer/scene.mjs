import {
  WebGLRenderer,Scene,PerspectiveCamera,Group,Mesh,BufferGeometry,Float32BufferAttribute,CanvasTexture,
  MeshStandardMaterial,MeshPhysicalMaterial,PlaneGeometry,ShadowMaterial,HemisphereLight,DirectionalLight,
  Quaternion,PCFShadowMap,SRGBColorSpace,ACESFilmicToneMapping,
} from 'three';
import {World,Body,Vec3,Plane,ConvexPolyhedron,Material,ContactMaterial,SAPBroadphase} from 'cannon-es';
import {diceModel,faceFrame,faceSymmetries,restingOrientation,cameraFacingOrientation,rotateVector,multiplyQuaternion,dot,sub,cross,unit,mean} from '../../dist/dice-geometry.mjs';

const random=()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;

function faceTexture(model,index,palette) {
  const face=model.faces[index],frame=faceFrame(model,index),size=512;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d'),points=face.indices.map(i=>model.vertices[i]);
  const span=Math.max(...points.map(p=>Math.hypot(...sub(p,face.center))))*2.12;
  const uv=p=>[.5+dot(sub(p,face.center),frame.u)/span,.5+dot(sub(p,face.center),frame.v)/span];
  const gradient=ctx.createLinearGradient(0,0,size,size);
  gradient.addColorStop(0,palette===0 ? '#a92b45' : '#277b78');gradient.addColorStop(1,palette===0 ? '#661527' : '#103f49');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,size,size);
  ctx.beginPath();points.forEach((p,i)=>{const [u,v]=uv(p.map((x,k)=>face.center[k]+(x-face.center[k])*.84));i ? ctx.lineTo(u*size,(1-v)*size) : ctx.moveTo(u*size,(1-v)*size);});ctx.closePath();
  ctx.strokeStyle=palette===0 ? '#e4b67c55' : '#b6e2cd55';ctx.lineWidth=2;ctx.stroke();
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff0ce';
  ctx.shadowColor='#170b14';ctx.shadowBlur=2;ctx.shadowOffsetY=3;
  if(model.sides===4) {
    for(const i of face.indices) {
      const p=model.vertices[i].map((x,k)=>face.center[k]+(x-face.center[k])*.56),[u,v]=uv(p);
      ctx.save();ctx.translate(u*size,(1-v)*size);ctx.rotate(Math.atan2(dot(sub(model.vertices[i],face.center),frame.u),dot(sub(model.vertices[i],face.center),frame.v)));
      ctx.font='700 114px Georgia,serif';ctx.fillText(String(i+1),0,0);ctx.restore();
    }
  } else {
    ctx.font=`600 ${face.indices.length===3 ? 166 : 190}px Georgia,serif`;
    ctx.fillText(String(face.value),size/2,size*.51);
    if(face.value===6 || face.value===9) {ctx.shadowBlur=0;ctx.fillRect(size*.44,size*.69,size*.12,5);}
  }
  const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;
  return {texture,uv};
}

// Inset the real faces, join each edge with a bevel, and cap each vertex.
// The twenty large d20 faces remain equilateral triangles.
function dieGeometry(model) {
  const main=new BufferGeometry(),trim=new BufferGeometry(),positions=[],uvs=[],bevel=[],edges=new Map(),corners=model.vertices.map(()=>[]);
  const triangle=(list,a,b,c)=>dot(cross(sub(b,a),sub(c,a)),mean([a,b,c]))>=0 ? list.push(...a,...b,...c) : list.push(...a,...c,...b);
  for(const [index,face] of model.faces.entries()) {
    const frame=faceFrame(model,index),span=Math.max(...face.indices.map(i=>Math.hypot(...sub(model.vertices[i],face.center))))*2.12;
    const points=face.indices.map(i=>model.vertices[i].map((x,k)=>face.center[k]+(x-face.center[k])*.94));
    const start=positions.length/3;
    for(let i=1;i<points.length-1;i++) for(const p of [points[0],points[i],points[i+1]]) {
      positions.push(...p);uvs.push(.5+dot(sub(p,face.center),frame.u)/span,.5+dot(sub(p,face.center),frame.v)/span);
    }
    main.addGroup(start,positions.length/3-start,index);
    for(let i=0;i<points.length;i++) {
      const a=face.indices[i],b=face.indices[(i+1)%points.length],p=points[i],q=points[(i+1)%points.length],key=[a,b].sort((a,b)=>a-b).join(':');
      corners[a].push(p);
      const other=edges.get(key);
      if(other) {triangle(bevel,p,other.q,other.p);triangle(bevel,p,q,other.q);}
      else edges.set(key,{p,q});
    }
  }
  for(let i=0;i<corners.length;i++) {
    const points=corners[i],center=mean(points),n=unit(model.vertices[i]),u=unit(sub(points[0],center)),v=cross(n,u);
    points.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));
    for(let j=1;j<points.length-1;j++) triangle(bevel,points[0],points[j],points[j+1]);
  }
  main.setAttribute('position',new Float32BufferAttribute(positions,3));main.setAttribute('uv',new Float32BufferAttribute(uvs,2));main.computeVertexNormals();
  trim.setAttribute('position',new Float32BufferAttribute(bevel,3));trim.computeVertexNormals();
  return {main,trim};
}

function chooseNumbering(model,value,orientation) {
  if(model.sides===4) {
    const top=model.vertices.map((v,i)=>({i,up:rotateVector(orientation,v)[1]})).sort((a,b)=>b.up-a.up)[0].i;
    // A tetrahedron reads the number at its upper vertex on all three visible faces.
    const from=model.faces.findIndex(f=>!f.indices.includes(value-1)),to=model.faces.findIndex(f=>!f.indices.includes(top));
    return faceSymmetries(model,from,to)[0];
  }
  const from=model.faces.findIndex(face=>face.value===value);
  const to=model.faces.map((face,i)=>({i,up:rotateVector(orientation,face.normal)[1]})).sort((a,b)=>b.up-a.up)[0].i;
  const candidates=faceSymmetries(model,from,to);
  // Choose a symmetry with legible type; the physical hull is identical under it.
  return candidates.sort((a,b)=>{
    const va=rotateVector(multiplyQuaternion(orientation,a),faceFrame(model,from).v),vb=rotateVector(multiplyQuaternion(orientation,b),faceFrame(model,from).v);
    return vb[2]*-1-va[2]*-1;
  })[0];
}

// Precompute the physical throw, then orient the printed die by an exact hull
// symmetry. The same fixed face labels are used for every frame of the replay.
// Presentation randomness cannot alter any recorded attack or damage value.
export function simulateThrow(values,{width=1000,height=280,quiet=false,random:throwRandom=random}={}) {
  const random=throwRandom;
    const physical=values.filter(value=>diceModel(value.faces));
    const radius=Math.min(.96,2.2/Math.sqrt(Math.max(1,physical.length)));
    const halfX=Math.max(3.2,width/height*2.2),halfZ=2.2;
    const world=new World({gravity:new Vec3(0,-30,0),allowSleep:true});world.broadphase=new SAPBroadphase(world);world.solver.iterations=12;
    const surface=new Material('table'),resin=new Material('dice');world.addContactMaterial(new ContactMaterial(surface,resin,{friction:.62,restitution:.22}));
    world.addContactMaterial(new ContactMaterial(resin,resin,{friction:.32,restitution:.25}));
    for(const [position,normal] of [[[0,0,0],[0,1,0]],[[-halfX,0,0],[1,0,0]],[[halfX,0,0],[-1,0,0]],[[0,0,-halfZ],[0,0,1]],[[0,0,halfZ],[0,0,-1]]]) {
      const body=new Body({mass:0,material:surface,shape:new Plane(),position:new Vec3(...position)});body.quaternion.setFromVectors(new Vec3(0,0,1),new Vec3(...normal));world.addBody(body);
    }
    let dice=physical.map((value,index)=>{
      const model=diceModel(value.faces);
      const body=new Body({mass:1,material:resin,angularDamping:.48,linearDamping:.24,allowSleep:true,sleepSpeedLimit:.12,sleepTimeLimit:.2,
        shape:new ConvexPolyhedron({vertices:model.vertices.map(v=>new Vec3(...v.map(x=>x*radius))),faces:model.faces.map(face=>face.indices)})});
      body.position.set(-halfX+radius+.3+(index%4)*radius*.35,2.1+(index%3)*.4,(index%2 ? 1 : -1)*.45);
      body.velocity.set(4.2+random()*1.4,-1.2-random()*0.5,(random()-.5)*1.4);
      body.quaternion.setFromEuler(random()*6,random()*6,random()*6);
      body.angularVelocity.set(3.5+random()*5,(random()-.5)*6,3+random()*5);world.addBody(body);
      return {...value,model,body,radius,numbering:[0,0,0,1]};
    });
    let frames=[],duration=0;
    const snapshot=()=>dice.map(die=>[...die.body.position.toArray(),...die.body.quaternion.toArray()]);
    if(quiet) {
      duration=0;
      for(let i=0;i<dice.length;i++) {
        const die=dice[i],q=restingOrientation(die.model,die.value);
        die.body.quaternion.set(...q);die.body.position.set((i-(dice.length-1)/2)*radius*2.2,radius,0);
        // A die rests on a face, not on the sphere bounding its corners.
        die.body.position.y=-Math.min(...die.model.vertices.map(v=>rotateVector(q,v)[1]))*radius;
      }
      frames=[snapshot()];
    } else {
      frames.push(snapshot());
      for(let i=0;i<270;i++) {world.step(1/90);frames.push(snapshot());}
      duration=2200;
      for(const die of dice) die.numbering=chooseNumbering(die.model,die.value,die.body.quaternion.toArray());
      // Smoothly settle the dice flat onto their winning face during the final frames
      for(let i=0;i<dice.length;i++) {
        const die=dice[i],model=die.model;
        const flatQ=restingOrientation(model,die.value);
        const invNumbering=[-die.numbering[0],-die.numbering[1],-die.numbering[2],die.numbering[3]];
        const bodyFlatQ=multiplyQuaternion(flatQ,invNumbering);
        const restY=-Math.min(...model.vertices.map(v=>rotateVector(flatQ,v)[1]))*die.radius;
        const settleStart=Math.max(0,frames.length-45);
        for(let f=settleStart;f<frames.length;f++) {
          const progress=(f-settleStart)/(frames.length-1-settleStart);
          const ease=progress*progress*(3-2*progress);
          const frameData=frames[f][i];
          const currQ=[frameData[3],frameData[4],frameData[5],frameData[6]];
          let dotProd=currQ[0]*bodyFlatQ[0]+currQ[1]*bodyFlatQ[1]+currQ[2]*bodyFlatQ[2]+currQ[3]*bodyFlatQ[3];
          const sign=dotProd<0 ? -1 : 1;
          const slerpedQ=[
            currQ[0]*(1-ease)+sign*bodyFlatQ[0]*ease,
            currQ[1]*(1-ease)+sign*bodyFlatQ[1]*ease,
            currQ[2]*(1-ease)+sign*bodyFlatQ[2]*ease,
            currQ[3]*(1-ease)+sign*bodyFlatQ[3]*ease,
          ];
          const qLen=Math.hypot(...slerpedQ);
          frameData[1]=frameData[1]*(1-ease)+restY*ease;
          frameData[3]=slerpedQ[0]/qLen;frameData[4]=slerpedQ[1]/qLen;frameData[5]=slerpedQ[2]/qLen;frameData[6]=slerpedQ[3]/qLen;
        }
        die.body.quaternion.set(...bodyFlatQ);
        die.body.position.y=restY;
      }
    }
    return {dice,frames,duration};
}

export function createDiceScene(canvas) {
  const renderer=new WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setClearColor(0,0);renderer.outputColorSpace=SRGBColorSpace;renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFShadowMap;
  const scene=new Scene(),camera=new PerspectiveCamera(32,1,.1,80);
  camera.position.set(0,6.5,3.8);camera.lookAt(0,0,0);
  scene.add(new HemisphereLight(0xffe8d1,0x1a303b,2.1));
  const key=new DirectionalLight(0xffecd1,3.4);key.position.set(-4,9,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-14;key.shadow.camera.right=14;key.shadow.camera.top=8;key.shadow.camera.bottom=-8;key.shadow.normalBias=.035;key.shadow.bias=-.0001;key.shadow.radius=3;scene.add(key);
  const rim=new DirectionalLight(0xc3dfff,2.2);rim.position.set(5,5,-5);scene.add(rim);
  const floor=new Mesh(new PlaneGeometry(60,40),new ShadowMaterial({opacity:.26}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  const cache=new Map();let dice=[],frames=[],duration=0,rollDuration=0,lost=false,width=1,height=1,layoutAspect=1;
  const qa=new Quaternion(),qb=new Quaternion(),numbering=new Quaternion();
  canvas.dataset.renderer='webgl';
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;});

  function resources(model,palette) {
    const id=model.sides+':'+palette;if(cache.has(id)) return cache.get(id);
    const geometry=dieGeometry(model),materials=model.faces.map((_,index)=>new MeshPhysicalMaterial({
      map:faceTexture(model,index,palette).texture,metalness:.14,roughness:.33,clearcoat:.65,clearcoatRoughness:.24,flatShading:true,
    }));
    const trim=new MeshStandardMaterial({color:palette===0 ? 0x8b263b : 0x256970,metalness:.42,roughness:.3,flatShading:true});
    const result={geometry,materials,trim};cache.set(id,result);return result;
  }

  function resize(w,h) {
    width=Math.max(1,w);height=Math.max(1,h);renderer.setPixelRatio(Math.min(2,devicePixelRatio || 1));renderer.setSize(width,height,false);
    camera.aspect=width/height;
    camera.fov=frames.length ? Math.min(85,2*Math.atan(Math.tan(16*Math.PI/180)*Math.max(1,layoutAspect/camera.aspect))*180/Math.PI) : 32;
    camera.updateProjectionMatrix();
  }

  function clear() {
    for(const die of dice) {scene.remove(die.group);for(const material of die.discardMaterials ?? []) material.dispose();}
    dice=[];frames=[];delete canvas.dataset.facing;renderer.clear();
  }

  function prepare(values,quiet=false) {
    clear();
    layoutAspect=width/height;camera.fov=32;camera.updateProjectionMatrix();
    ({dice,frames,duration:rollDuration}=simulateThrow(values,{width,height,quiet}));
    duration=rollDuration;
    for(const die of dice) {
      const res=resources(die.model,die.group===0 ? 0 : 1),group=new Group();group.scale.setScalar(die.radius);
      const main=new Mesh(res.geometry.main,res.materials),trim=new Mesh(res.geometry.trim,res.trim);
      main.castShadow=trim.castShadow=true;main.receiveShadow=trim.receiveShadow=true;group.add(main,trim);scene.add(group);
      die.group=group;die.discardMaterials=[];
    }
    for(const die of dice) if(die.discarded) {
      for(const mesh of die.group.children) {
        const clone=material=>{const copy=material.clone();copy.transparent=true;die.discardMaterials.push(copy);return copy;};
        mesh.material=Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
      }
    }
    canvas.dataset.results=JSON.stringify(dice.map(die=>{
      const orientation=multiplyQuaternion(die.body.quaternion.toArray(),die.numbering);
      const upper=die.model.sides===4 ? die.model.vertices.map((v,i)=>({value:i+1,up:rotateVector(orientation,v)[1]})) : die.model.faces.map(face=>({value:face.value,up:rotateVector(orientation,face.normal)[1]}));
      const top=upper.sort((a,b)=>b.up-a.up)[0];return {faces:die.faces,value:die.value,upper:top.value,alignment:top.up};
    }));
    draw(0);return duration;
  }

  function draw(elapsed) {
    if(lost || !frames.length) return;
    const t=rollDuration ? Math.min(1,Math.max(0,elapsed/rollDuration))*(frames.length-1) : 0,index=Math.floor(t),blend=t-index;
    for(let i=0;i<dice.length;i++) {
      const die=dice[i],a=frames[index][i],b=(frames[index+1] ?? frames[index])[i];
      die.group.position.set(a[0]+(b[0]-a[0])*blend,a[1]+(b[1]-a[1])*blend,a[2]+(b[2]-a[2])*blend);
      qa.fromArray(a,3);qb.fromArray(b,3);numbering.fromArray(die.numbering);die.group.quaternion.slerpQuaternions(qa,qb,blend).multiply(numbering);
      for(const material of die.discardMaterials) material.opacity=elapsed>=duration ? .28 : 1;
    }
    renderer.render(scene,camera);
  }
  function dispose() {
    clear();
    for(const res of cache.values()) {
      res.geometry.main.dispose();res.geometry.trim.dispose();res.trim.dispose();
      for(const material of res.materials) {material.map.dispose();material.dispose();}
    }
    floor.geometry.dispose();floor.material.dispose();renderer.dispose();renderer.forceContextLoss();
  }
  return {prepare,draw,resize,clear,dispose};
}
