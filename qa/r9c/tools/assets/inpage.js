// r8-audit in-page library. Injected with page.addScriptTag after the game booted. Read-only towards game state except:
// player position/joystick/exit cooldown during probes (restored afterwards) and temporary material.side for raycasts.
(function(){
const T=THREE,R8=window.__R8||{ghosts:[]};
const HELPERS=new Set(['worldMesh','worldBox','part','mesh','box','P','tgInstances','roof','latheRoof','signPlane','add','Object3D.add','Group.add','Mesh.add','g.add','parent.add','?','Array.forEach','Array.map','new','Object.forEach']);
const NOGROUND=/floor|ground|terrain|sky|grass-?floor|lawn|road|carpet|rug|water|pond|lining/i;
const DYN=/npc|avatar|player|remote|animal|koi|fish|bird|butterfly|r6Ride|mount|smoke|particle|petal|cloud/i;
function caller(src){if(!src||!src.length)return '?';for(const [f,l] of src){const fn=f.replace(/^Object\./,'');if(!HELPERS.has(fn)&&!/^(Array|Map|Set)\./.test(fn))return fn+'@L'+l;}return src[0][0]+'@L'+src[0][1];}
function srcStr(src){return (src||[]).slice(0,4).map(([f,l])=>f+'@L'+l).join(' < ');}
function space(scene){return W3.spaces[scene||W3.active];}
function visChain(o,root){while(o){if(!o.visible)return false;if(o===root)return true;o=o.parent;}return false;}
function matOf(o){return Array.isArray(o.material)?o.material[0]:o.material;}
function isDynamic(o,s){for(let p=o;p&&p!==s.group;p=p.parent){const u=p.userData||{};if(p===W3.player||p===s.animalGroup||u.tgNpc||u.npc||u.tgAvatar||u.r6Ride||u.r6Passenger||u.r6Ghost||u.npcNoOcclude)return true;if(DYN.test(p.name||''))return true;}return false;}
function isLabel(o){const u=o.userData||{};return !!(u.r41Label||u.r6Label||u.__text);}
function pathOf(o,s){const a=[];for(let p=o;p&&p!==s.group;p=p.parent){a.unshift(p.name||(p.isInstancedMesh?'Instanced':p.type));}return a.join('/');}
function solidMat(m){return m&&m.visible!==false&&!(m.transparent&&m.opacity<.35)&&m.colorWrite!==false&&!m.isSpriteMaterial&&!m.isPointsMaterial&&!m.isLineBasicMaterial;}
function colorOf(m){try{return '#'+m.color.getHexString();}catch(e){return '';}}
const tmpM=new T.Matrix4();
// ---- visible static solids as logical items (merged meshes replaced by their ghost parts) ----
function items(scene,{withDynamic=false}={}){
  const s=space(scene);s.group.updateMatrixWorld(true);
  const out=[],mergedVisible=new Map();
  // logical top prop: highest ancestor under s.group whose subtree is prop-sized
  const subBox=new Map();
  function sb(g){if(subBox.has(g))return subBox.get(g);const b=new T.Box3();let n=0;g.traverse(m=>{if(m.isMesh&&!m.isInstancedMesh){if(!m.geometry.boundingBox)m.geometry.computeBoundingBox();b.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld));n++;}});const r={diag:b.isEmpty()?0:b.getSize(new T.Vector3()).length(),n};subBox.set(g,r);return r;}
  function keyOf(o,src){
    let best=null;for(let p=o.parent;p&&p!==s.group;p=p.parent){if(p===s.decorGroup||p===s.art3Group)continue;const r=sb(p);if(r.diag>0&&r.diag<=12&&r.n<=400)best=p;}
    if(best)return {key:'obj:'+best.uuid,prop:best.name||caller(best.userData.__r8src)};
    return {key:'src:'+caller(src),prop:caller(src)};
  }
  s.group.traverse(o=>{
    if(!o.isMesh||o.isSprite||o===s.floor)return;if(!visChain(o,s.group))return;const m=matOf(o);if(!solidMat(m))return;
    if(isLabel(o))return;const dyn=isDynamic(o,s);if(dyn&&!withDynamic)return;
    const g=o.geometry;if(!g||!g.attributes||!g.attributes.position)return;if(!g.boundingBox)g.computeBoundingBox();
    if(g.userData&&g.userData.__r8merged){mergedVisible.set(g,o);return;}
    const src=o.userData.__r8src||[],k=keyOf(o,src);
    const base={o,geo:g,src,caller:caller(src),srcs:srcStr(src),path:pathOf(o,s),name:o.name||'',type:g.type,color:colorOf(m),key:k.key,prop:k.prop,dyn,mat:m};
    if(o.isInstancedMesh){for(let i=0;i<o.count;i++){o.getMatrixAt(i,tmpM);const wm=tmpM.clone().premultiply(o.matrixWorld);out.push({...base,inst:i,world:wm});}}
    else out.push({...base,inst:-1,world:o.matrixWorld.clone()});
  });
  // ghosts (validated: their transformed vertices must exist in the merged geometry; stale removals are dropped)
  const seen=new Set(),usedMerged=new Set();
  for(const gh of (R8.ghosts||[])){
    const mm=mergedVisible.get(gh.geo);if(!mm)continue;
    const g=gh.mesh.geometry;if(!g||!g.attributes||!g.attributes.position)continue;if(!g.boundingBox)g.computeBoundingBox();
    const wm=gh.world.clone();if(mm.parent&&mm.parent!==s.group){} // merged coordinates are baked in world/parent space already
    const sig=g.uuid+':'+wm.elements.map(v=>v.toFixed(3)).join(',');if(seen.has(sig))continue;seen.add(sig);
    if(!ghostValid(gh,mm,wm))continue;usedMerged.add(mm);
    const m=matOf(gh.mesh)||matOf(mm);const src=gh.src||[];
    out.push({o:gh.mesh,ghostOf:mm,geo:g,src,caller:caller(src),srcs:srcStr(src),path:(pathOf(mm,s)+'/<merged:'+(gh.name||g.type)+'>'),name:gh.name,type:g.type,color:colorOf(m),key:'src:'+caller(src),prop:caller(src),dyn:false,mat:m,inst:-1,world:wm});
  }
  // merged meshes without any validated ghost parts stay as one item
  // merged meshes without validated ghost parts: split into connected components (≈ the original meshes)
  for(const [g,o] of mergedVisible){if(usedMerged.has(o))continue;const src=o.userData.__r8src||[];const m=matOf(o);const comps=components(g);const mk0=keyOf(o,src);const mk=mk0.key.startsWith('src:')?{key:'obj:'+o.uuid,prop:mk0.prop}:mk0;
    comps.forEach((cg,ci)=>out.push({o,geo:cg,src,caller:caller(src),srcs:srcStr(src),path:pathOf(o,s)+'(merged)#c'+ci,name:o.name||'',type:'MergedPart',color:colorOf(m),key:mk.key,prop:mk.prop,dyn:false,mat:m,inst:-1,world:o.matrixWorld.clone(),mergedPart:true}));}
  // geometry facts
  for(const it of out){
    const lb=it.geo.boundingBox;const b=lb.clone().applyMatrix4(it.world);it.box=b;
    const e=it.world.elements;const ax=[new T.Vector3(e[0],e[1],e[2]),new T.Vector3(e[4],e[5],e[6]),new T.Vector3(e[8],e[9],e[10])];
    const sc=ax.map(v=>v.length());const c=lb.getCenter(new T.Vector3()).applyMatrix4(it.world);const hl=lb.getSize(new T.Vector3()).multiplyScalar(.5);
    it.obb={c,u:ax.map((v,i)=>sc[i]>1e-9?v.clone().divideScalar(sc[i]):new T.Vector3(i==0,i==1,i==2)),h:[hl.x*sc[0],hl.y*sc[1],hl.z*sc[2]]};
    it.sc=sc;it.size=b.getSize(new T.Vector3());it.ext=Math.max(it.size.x,it.size.y,it.size.z);
    it.ground=NOGROUND.test(it.path)||(it.size.y<=.12&&b.max.y<=.16)||(it.size.y<.3&&it.size.x*it.size.z>60)||it.ext>90;
    it.structural=it.ext>=3;
    const lim=s.limit;it.backdrop=b.min.x>lim.x+2||b.max.x<-lim.x-2||b.min.z>lim.z+2||b.max.z<-lim.z-2||(it.ext>20&&b.min.y<-1);
  }
  return out;
}
const COMP=new WeakMap();
function components(g){let c=COMP.get(g);if(c)return c;const p=g.attributes.position,idx=g.index,nv=p.count,ntri=(idx?idx.count:nv)/3;
  const key=new Int32Array(nv);const map=new Map();for(let i=0;i<nv;i++){const k=qkey(p.getX(i),p.getY(i),p.getZ(i));let id=map.get(k);if(id===undefined){id=map.size;map.set(k,id);}key[i]=id;}
  const par=new Int32Array(map.size);for(let i=0;i<par.length;i++)par[i]=i;const f=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};const u=(a,b)=>{a=f(a);b=f(b);if(a!==b)par[a]=b;};
  const vi=t=>idx?idx.getX(t):t;
  for(let t=0;t<ntri;t++){const a=key[vi(t*3)],b=key[vi(t*3+1)],cc=key[vi(t*3+2)];u(a,b);u(b,cc);}
  const groups=new Map();for(let t=0;t<ntri;t++){const r=f(key[vi(t*3)]);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(t);}
  c=[];for(const tris of groups.values()){const arr=new Float32Array(tris.length*9);let o=0;for(const t of tris)for(let k=0;k<3;k++){const v=vi(t*3+k);arr[o++]=p.getX(v);arr[o++]=p.getY(v);arr[o++]=p.getZ(v);}
    const ng=new T.BufferGeometry();ng.setAttribute('position',new T.BufferAttribute(arr,3));ng.computeBoundingBox();ng.computeBoundingSphere();c.push(ng);}
  COMP.set(g,c);return c;}
const HASH=new WeakMap();
function qkey(x,y,z){return Math.round(x*500)+','+Math.round(y*500)+','+Math.round(z*500);}
function mergedHash(g){let h=HASH.get(g);if(h)return h;h=new Set();const p=g.attributes.position;for(let i=0;i<p.count;i++)h.add(qkey(p.getX(i),p.getY(i),p.getZ(i)));HASH.set(g,h);return h;}
function ghostValid(gh,mm,wm){const h=mergedHash(gh.geo);const inv=mm.matrixWorld.clone().invert();const M=inv.multiply(wm);const p=gh.mesh.geometry.attributes.position;const n=Math.min(p.count,6);let ok=0;const v=new T.Vector3();
  for(let i=0;i<n;i++){v.fromBufferAttribute(p,i).applyMatrix4(M);let f=false;for(const dx of [0,-1,1])for(const dy of [0,-1,1])for(const dz of [0,-1,1]){if(f)break;if(h.has((Math.round(v.x*500)+dx)+','+(Math.round(v.y*500)+dy)+','+(Math.round(v.z*500)+dz)))f=true;}if(f)ok++;}
  return ok>=Math.ceil(n*.6);}
// ---- OBB SAT penetration depth ----
function satDepth(A,B){
  const axes=[...A.obb.u,...B.obb.u];for(const a of A.obb.u)for(const b of B.obb.u){const c=new T.Vector3().crossVectors(a,b);if(c.lengthSq()>1e-6)axes.push(c.normalize());}
  const d=new T.Vector3().subVectors(B.obb.c,A.obb.c);let best=Infinity,bestAx=null;
  for(const L of axes){const rA=A.obb.h[0]*Math.abs(A.obb.u[0].dot(L))+A.obb.h[1]*Math.abs(A.obb.u[1].dot(L))+A.obb.h[2]*Math.abs(A.obb.u[2].dot(L));
    const rB=B.obb.h[0]*Math.abs(B.obb.u[0].dot(L))+B.obb.h[1]*Math.abs(B.obb.u[1].dot(L))+B.obb.h[2]*Math.abs(B.obb.u[2].dot(L));
    const ov=rA+rB-Math.abs(d.dot(L));if(ov<=0)return {depth:0};if(ov<best){best=ov;bestAx=L;}}
  return {depth:best,axis:bestAx};
}
// ---- triangle-level refinement ----
const dbl=new T.MeshBasicMaterial({side:T.DoubleSide});
function proxy(it){const m=new T.Mesh(it.geo,dbl);m.matrixAutoUpdate=false;m.matrix.copy(it.world);m.matrixWorld.copy(it.world);return m;}
const rc=new T.Raycaster();
function verts(it,max){const p=it.geo.attributes.position,n=p.count,step=Math.max(1,Math.floor(n/max)),out=[];for(let i=0;i<n;i+=step)out.push(new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(it.world));return out;}
function edges(it,max){const p=it.geo.attributes.position,idx=it.geo.index,tri=idx?idx.count/3:p.count/3,step=Math.max(1,Math.floor(tri/max)),out=[];const g=i=>idx?idx.getX(i):i;
  for(let t=0;t<tri;t+=step){for(const [a,b] of [[0,1],[1,2],[2,0]])out.push([new T.Vector3().fromBufferAttribute(p,g(t*3+a)).applyMatrix4(it.world),new T.Vector3().fromBufferAttribute(p,g(t*3+b)).applyMatrix4(it.world)]);}return out;}
const OPEN=/Plane|Circle|Ring|Shape|Lathe|Tube|Extrude/;
function insideFrac(P,B){ // fraction of points P inside closed mesh B (ray parity, 2 directions must agree)
  if(OPEN.test(B.type)&&!/Extrude|Lathe/.test(B.type))return null;const m=proxy(B);let n=0,k=0;const dirs=[new T.Vector3(.577,.577,.577),new T.Vector3(-.6,.3,.74).normalize()];
  for(const v of P){if(!B.box.containsPoint(v))continue;n++;let odd=0;for(const d of dirs){rc.set(v,d);rc.far=1e4;rc.near=0;const h=[];m.raycast(rc,h);if(h.length%2===1)odd++;}if(odd===2)k++;}
  return {tested:n,inside:k,frac:P.length?k/P.length:0};
}
function crossCount(E,B){const m=proxy(B);let c=0;for(const [a,b] of E){if(!B.box.containsPoint(a)&&!B.box.containsPoint(b)){const bb=new T.Box3().setFromPoints([a,b]);if(!bb.intersectsBox(B.box))continue;}const d=b.clone().sub(a),L=d.length();if(L<1e-6)continue;rc.set(a,d.divideScalar(L));rc.near=0;rc.far=L;const h=[];m.raycast(rc,h);if(h.length)c++;}return c;}
function refine(A,B){
  const vA=verts(A,160),vB=verts(B,160);
  const inAB=insideFrac(vA,B),inBA=insideFrac(vB,A);
  const cAB=crossCount(edges(A,120),B),cBA=crossCount(edges(B,120),A);
  const small=A.size.length()<=B.size.length()?{it:A,frac:inAB}:{it:B,frac:inBA};
  const contained=small.frac&&small.frac.frac>=.97;
  const touchesSurface=cAB+cBA>0;
  const anyInside=(inAB&&inAB.inside>0)||(inBA&&inBA.inside>0);
  return {inAB:inAB&&+inAB.frac.toFixed(2),inBA:inBA&&+inBA.frac.toFixed(2),crossAB:cAB,crossBA:cBA,klass:contained?'contained':(touchesSurface||anyInside)?'pierce':'none'};
}
// ---- (a) overlaps ----
function overlaps(scene,{minDepth=.03,refineTop=120}={}){
  const LIM=space(scene).limit;const its=items(scene).filter(i=>!i.ground&&!i.backdrop&&i.ext>.04);
  its.forEach((it,i)=>it.id=i);
  const order=[...its].sort((a,b)=>a.box.min.x-b.box.min.x);const pairs=[];
  for(let i=0;i<order.length;i++){const A=order[i];for(let j=i+1;j<order.length;j++){const B=order[j];if(B.box.min.x>A.box.max.x)break;if(A.key===B.key)continue;if(!A.box.intersectsBox(B.box))continue;
    const ib=A.box.clone().intersect(B.box),is=ib.getSize(new T.Vector3());const aabbDepth=Math.min(is.x,is.y,is.z);if(aabbDepth<minDepth)continue;
    const c0=ib.getCenter(new T.Vector3());if(Math.abs(c0.x)>LIM.x+1||Math.abs(c0.z)>LIM.z+1)continue;const s=satDepth(A,B);if(s.depth<minDepth)continue;pairs.push({A,B,depth:s.depth,aabbDepth,center:ib.getCenter(new T.Vector3())});}}
  pairs.sort((a,b)=>b.depth-a.depth);
  // aggregate by object-key pair
  const agg=new Map();
  for(const p of pairs){const [a,b]=p.A.key<p.B.key?[p.A,p.B]:[p.B,p.A];const k=a.key+'|'+b.key;let g=agg.get(k);if(!g){g={k,A:a,B:b,best:p,n:0,centers:[]};agg.set(k,g);}g.n++;if(g.centers.length<8)g.centers.push(p.center.toArray().map(v=>+v.toFixed(2)));}
  const groups=[...agg.values()].sort((x,y)=>y.best.depth-x.best.depth);
  let refined=0;const out=[];
  for(const g of groups){const p=g.best;let rf=null;if(refined<refineTop){rf=refine(p.A,p.B);refined++;}
    const d=o=>({path:o.path,src:o.srcs,caller:o.caller,prop:o.prop,type:o.type,color:o.color,inst:o.inst,merged:!!o.ghostOf,min:o.box.min.toArray().map(v=>+v.toFixed(2)),max:o.box.max.toArray().map(v=>+v.toFixed(2)),ext:+o.ext.toFixed(2),structural:o.structural});
    out.push({depth:+p.depth.toFixed(3),aabbDepth:+p.aabbDepth.toFixed(3),center:p.center.toArray().map(v=>+v.toFixed(2)),count:g.n,centers:g.centers,a:d(p.A),b:d(p.B),refine:rf,_ids:[p.A.id,p.B.id]});}
  window.__r8last={scene,its};
  return {scene,nItems:its.length,nPairs:pairs.length,nGroups:out.length,refined,groups:out};
}
// ---- raycast solids (actual rendered meshes incl. merged) ----
function rayMeshes(scene,{withDynamic=false}={}){const s=space(scene);const out=[];s.group.traverse(o=>{if(!o.isMesh||o.isSprite)return;if(!visChain(o,s.group))return;const m=matOf(o);if(!solidMat(m))return;if(isLabel(o))return;if(!withDynamic&&isDynamic(o,s))return;out.push(o);});return out;}
function withDouble(meshes,fn){const sides=new Map();meshes.forEach(o=>(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{if(m&&!sides.has(m)){sides.set(m,m.side);m.side=T.DoubleSide;}}));try{return fn();}finally{sides.forEach((v,m)=>m.side=v);}}
function hitName(h){const o=h.object;const s=space();let it=o;const src=o.userData.__r8src;let inst='';if(h.instanceId!=null)inst='#'+h.instanceId;
  // try to resolve merged hit back to ghost part
  let part=null;if(o.geometry.userData&&o.geometry.userData.__r8merged){for(const gh of R8.ghosts){if(gh.geo!==o.geometry)continue;const g=gh.mesh.geometry;if(!g.boundingBox)g.computeBoundingBox();const b=g.boundingBox.clone().applyMatrix4(gh.world).expandByScalar(.02);if(b.containsPoint(h.point)){part=caller(gh.src)+(gh.name?':'+gh.name:'');break;}}}
  return {path:pathOf(o,s)+inst,caller:part||caller(src),merged:!!(o.geometry.userData&&o.geometry.userData.__r8merged),color:colorOf(matOf(o)),point:h.point.toArray().map(v=>+v.toFixed(2))};}
// Fixed-timestep stepping of the game's own frame function (input -> movement -> exits -> camera), independent of
// headless GPU speed. The real rAF loop is paused meanwhile by reporting document.hidden=true (worldFrame idles then).
const hidDesc=Object.getOwnPropertyDescriptor(Document.prototype,'hidden');let PAUSE=0;
try{Object.defineProperty(document,'hidden',{configurable:true,get(){return PAUSE>0?true:hidDesc.get.call(document);}});}catch(e){}
let simTs=0;
function stepFrames(n,dtMs=40){const w=W3,raf=window.requestAnimationFrame;window.requestAnimationFrame=()=>0;const p=PAUSE;PAUSE=0;
  try{for(let i=0;i<n;i++){simTs=Math.max(simTs,performance.now())+dtMs;w.last=simTs-dtMs;try{worldFrame(simTs);}catch(e){window.__r8frameErr=String(e);}}}
  finally{window.requestAnimationFrame=raf;PAUSE=p;}}
async function paused(fn){PAUSE++;try{return await fn();}finally{PAUSE--;W3.last=0;}}
async function noRender(fn){const r=W3.renderer,orig=r.render;r.render=function(){};try{return await paused(fn);}finally{r.render=orig;}}
function frames(n){return new Promise(r=>{let k=0;const f=()=>{if(++k>=n)r();else requestAnimationFrame(f);};requestAnimationFrame(f);});}
function place(x,z){const w=W3;w.player.position.set(x,0,z);w.follow.set(x,1.1,z);w.vx=w.vz=0;w.target=null;w.path=[];}
// ---- (b) camera probe ----
const DIRS6=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].map(a=>new T.Vector3(...a));
async function cameraAt(x,z,yaw,meshes){
  const w=W3;place(x,z);if(yaw!=null)w.yaw=yaw;w.joy.x=w.joy.y=0;for(let i=0;i<3;i++)worldCamera(1);stepFrames(3);place(x,z);w.follow.set(x,1.1,z);worldCamera(1);w.camera.updateMatrixWorld();
  const cam=w.camera.position.clone();const res={x:+x.toFixed(2),z:+z.toFixed(2),yaw:+w.yaw.toFixed(2),cam:cam.toArray().map(v=>+v.toFixed(2))};
  const head=new T.Vector3(x,1.45,z);res.dist=+cam.distanceTo(head).toFixed(2);
  rc.camera=w.camera;
  const targets=[[0,1.45,0],[0,1.0,0],[0,.25,0],[.45,1.0,0],[-.45,1.0,0]];const blocked=[];let first=null;
  // right vector for lateral targets
  const fw=head.clone().sub(cam).setY(0).normalize(),rt=new T.Vector3(-fw.z,0,fw.x);
  for(const [dx,y,_] of targets){const t=new T.Vector3(x,y,z).addScaledVector(rt,dx);const d=t.clone().sub(cam),L=d.length();rc.set(cam,d.divideScalar(L));rc.near=0;rc.far=Math.max(0,L-.3);const h=rc.intersectObjects(meshes,false).find(h=>h.distance>.02);blocked.push(!!h);if(h&&!first)first=h;}
  res.blockedFrac=+(blocked.filter(Boolean).length/blocked.length).toFixed(2);res.headBlocked=blocked[0];res.fully=blocked[0]&&blocked[1];
  if(first)res.occluder=hitName(first);
  // inside test: 6 rays, back-face first hits
  let back=0,minD=Infinity,near=null;
  for(const d of DIRS6){rc.set(cam,d);rc.near=0;rc.far=50;const h=rc.intersectObjects(meshes,false)[0];if(!h)continue;if(h.distance<minD){minD=h.distance;near=h;}
    if(h.face){const n=h.face.normal.clone().transformDirection(h.object.matrixWorld);if(h.instanceId!=null){const im=new T.Matrix4();h.object.getMatrixAt(h.instanceId,im);n.copy(h.face.normal).transformDirection(im.premultiply(h.object.matrixWorld));}if(n.dot(d)>0)back++;}}
  res.backHits=back;res.inside=back>=4;res.nearest=minD===Infinity?null:+minD.toFixed(3);res.nearClip=minD<.18;
  if((res.inside||res.nearClip)&&near)res.insideOf=hitName(near);
  res.cramped=res.dist<2.2;res.radius=+w.radius.toFixed(2);res.far=res.dist>Math.max(14,w.radius*1.6);
  res.pitchDeg=+(Math.atan2(cam.y-head.y,Math.hypot(cam.x-x,cam.z-z))*180/Math.PI).toFixed(1);
  return res;
}
async function cameraProbe(scene,pts,{yaws=null}={}){
  const w=W3,save=w.player.position.clone(),y0=w.yaw,p0=w.pitch,r0=w.radius;const meshes=rayMeshes(scene);const out=[];
  await noRender(()=>withDoubleAsync(meshes,async()=>{for(const p of pts){const ys=p[2]!=null?[p[2]]:(yaws||[null]);for(const yw of ys){w.pitch=p0;w.radius=r0;out.push({...(await cameraAt(p[0],p[1],yw,meshes)),tag:p[3]||''});}}}));
  w.yaw=y0;w.pitch=p0;w.radius=r0;place(save.x,save.z);worldCamera(1);return out;
}
async function withDoubleAsync(meshes,fn){const sides=new Map();meshes.forEach(o=>(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{if(m&&!sides.has(m)){sides.set(m,m.side);m.side=T.DoubleSide;}}));try{return await fn();}finally{sides.forEach((v,m)=>m.side=v);}}
// ---- collision grid / connectivity ----
function grid(scene,step=.25){const s=space(scene),L=s.limit;const nx=Math.floor(2*L.x/step)+1,nz=Math.floor(2*L.z/step)+1;const g=new Uint8Array(nx*nz);
  for(let i=0;i<nx;i++)for(let j=0;j<nz;j++){g[i*nz+j]=worldCanMove(-L.x+i*step,-L.z+j*step)?1:0;}
  return {nx,nz,step,ox:-L.x,oz:-L.z,g,cell:(x,z)=>[Math.round((x+L.x)/step),Math.round((z+L.z)/step)],pos:(i,j)=>[-L.x+i*step,-L.z+j*step]};}
function bfs(G,si,sj){const {nx,nz,g}=G;const dist=new Int32Array(nx*nz).fill(-1),prev=new Int32Array(nx*nz).fill(-1);const q=[];const ok=(i,j)=>i>=0&&j>=0&&i<nx&&j<nz&&g[i*nz+j];
  // snap start to nearest walkable
  if(!ok(si,sj)){let best=null;for(let r=1;r<8&&!best;r++)for(let di=-r;di<=r;di++)for(let dj=-r;dj<=r;dj++)if(!best&&ok(si+di,sj+dj))best=[si+di,sj+dj];if(!best)return {dist,prev,start:null};[si,sj]=best;}
  dist[si*nz+sj]=0;q.push(si*nz+sj);
  for(let h=0;h<q.length;h++){const c=q[h],i=Math.floor(c/nz),j=c%nz;for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const a=i+di,b=j+dj;if(!ok(a,b))continue;if(di&&dj&&(!ok(i+di,j)||!ok(i,j+dj)))continue;const k=a*nz+b;if(dist[k]>=0)continue;dist[k]=dist[c]+1;prev[k]=c;q.push(k);}}
  return {dist,prev,start:[si,sj]};}
// ---- (c1) static probe: body inside visible solid, invisible walls, unreachable pockets, spawn ----
function insideItem(it,x,y,z,pad){const v=new T.Vector3(x,y,z).sub(it.obb.c);const lx=v.dot(it.obb.u[0]),ly=v.dot(it.obb.u[1]),lz=v.dot(it.obb.u[2]);const h=it.obb.h;
  // treat local Y as vertical-ish axis for round shapes
  if(/Cylinder|Sphere|Cone|Dodeca|Icosa|Lathe/.test(it.type)){if(Math.abs(ly)>h[1])return false;let k=1;if(/Sphere|Dodeca|Icosa/.test(it.type))k=Math.sqrt(Math.max(0,1-(ly/h[1])**2));else if(/Cone/.test(it.type))k=Math.max(0,(h[1]-ly)/(2*h[1]));const ex=h[0]*k+pad,ez=h[2]*k+pad;if(ex<=0||ez<=0)return false;return (lx/ex)**2+(lz/ez)**2<1;}
  return Math.abs(lx)<h[0]+pad&&Math.abs(ly)<h[1]&&Math.abs(lz)<h[2]+pad;}
function staticProbe(scene,spawns){
  const s=space(scene),its=items(scene).filter(i=>!i.ground&&!i.backdrop);
  const solids=its.filter(i=>i.size.y>=.25&&i.box.max.y>.3&&i.box.min.y<1.5&&Math.max(i.size.x,i.size.z)>=.06);
  const G=grid(scene,.25);const hits=new Map();
  for(let i=0;i<G.nx;i++)for(let j=0;j<G.nz;j++){if(!G.g[i*G.nz+j])continue;const [x,z]=G.pos(i,j);
    for(const it of solids){if(x<it.box.min.x-.2||x>it.box.max.x+.2||z<it.box.min.z-.2||z>it.box.max.z+.2)continue;let hit=false;for(const y of [.35,.8,1.3])if(y>it.box.min.y&&y<it.box.max.y&&insideItem(it,x,y,z,.12)){hit=true;break;}
      if(hit){const k=it;let e=hits.get(k);if(!e){e={it,cells:[]};hits.set(k,e);}e.cells.push([+x.toFixed(2),+z.toFixed(2)]);}}}
  const per=[...hits.values()].map(({it,cells})=>({path:it.path,caller:it.caller,src:it.srcs,type:it.type,color:it.color,merged:!!it.ghostOf,height:+it.size.y.toFixed(2),min:it.box.min.toArray().map(v=>+v.toFixed(2)),max:it.box.max.toArray().map(v=>+v.toFixed(2)),cells:cells.length,area:+(cells.length*.0625).toFixed(2),cx:+(cells.reduce((a,c)=>a+c[0],0)/cells.length).toFixed(2),cz:+(cells.reduce((a,c)=>a+c[1],0)/cells.length).toFixed(2),sample:cells.slice(0,5)})).sort((a,b)=>b.cells-a.cells);
  const grp=new Map();for(const w of per){const k=w.caller+'|'+w.path.replace(/#c\d+$/,'')+'|'+w.type;if(!grp.has(k))grp.set(k,[]);grp.get(k).push(w);}
  const walkThrough=[...grp.values()].map(a=>({...a[0],items:a.length,totalCells:a.reduce((s,w)=>s+w.cells,0),others:a.slice(1,6).map(w=>({cx:w.cx,cz:w.cz,cells:w.cells,min:w.min,max:w.max}))})).sort((a,b)=>b.cells-a.cells);
  // invisible walls
  const blocks=s.blocks.map((b,bi)=>{let n=0,c=0;const unc=[];for(let x=b.x+.05;x<b.X;x+=.2)for(let z=b.z+.05;z<b.Z;z+=.2){n++;let cov=false;for(const it of its){if(it.dyn)continue;if(x<it.box.min.x-.25||x>it.box.max.x+.25||z<it.box.min.z-.25||z>it.box.max.z+.25)continue;for(const y of [.1,.35,.8,1.3,1.8])if(y>=it.box.min.y-.05&&y<=it.box.max.y+.05&&insideItem(it,x,Math.min(Math.max(y,it.box.min.y+.01),it.box.max.y-.01),z,.22)){cov=true;break;}if(cov)break;}if(cov)c++;else if(unc.length<6)unc.push([+x.toFixed(2),+z.toFixed(2)]);}
    return {bi,x:+b.x.toFixed(2),X:+b.X.toFixed(2),z:+b.z.toFixed(2),Z:+b.Z.toFixed(2),area:+((b.X-b.x)*(b.Z-b.z)).toFixed(2),tags:Object.keys(b).filter(k=>!['x','X','z','Z'].includes(k)),n,covered:c,cov:n?+(c/n).toFixed(2):1,uncovered:unc};});
  // connectivity from spawns
  const reach=new Uint8Array(G.nx*G.nz);const spawnInfo=[];
  for(const sp of spawns){const [si,sj]=G.cell(sp.x,sp.z);const inCol=!worldCanMove(sp.x,sp.z);let inVis=null;for(const it of solids){if(insideItem(it,sp.x,.8,sp.z,0)||insideItem(it,sp.x,.35,sp.z,0)){inVis=it.path+' ['+it.caller+']';break;}}
    const B=bfs(G,si,sj);let n=0;for(let k=0;k<B.dist.length;k++)if(B.dist[k]>=0){reach[k]=1;n++;}
    const onExit=s.exits.find(e=>Math.abs(sp.x-e.x)<1.35&&Math.abs(sp.z-e.z)<.9);
    spawnInfo.push({...sp,inCollider:inCol,inVisible:inVis,reachCells:n,reachArea:+(n*.0625).toFixed(1),onExit:onExit?onExit.to:null});}
  // components not reachable
  let walk=0;for(let k=0;k<G.g.length;k++)if(G.g[k])walk++;
  const seen=new Uint8Array(G.nx*G.nz);const pockets=[];
  for(let k=0;k<G.g.length;k++){if(!G.g[k]||reach[k]||seen[k])continue;const q=[k];seen[k]=1;const cells=[];for(let h=0;h<q.length;h++){const c=q[h];cells.push(c);const i=Math.floor(c/G.nz),j=c%G.nz;for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){const a=i+di,b=j+dj;if(a<0||b<0||a>=G.nx||b>=G.nz)continue;const kk=a*G.nz+b;if(G.g[kk]&&!reach[kk]&&!seen[kk]){seen[kk]=1;q.push(kk);}}}
    if(cells.length>=4){const ps=cells.map(c=>G.pos(Math.floor(c/G.nz),c%G.nz));pockets.push({cells:cells.length,area:+(cells.length*.0625).toFixed(2),cx:+(ps.reduce((a,p)=>a+p[0],0)/ps.length).toFixed(2),cz:+(ps.reduce((a,p)=>a+p[1],0)/ps.length).toFixed(2),bbox:[Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1])),Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))].map(v=>+v.toFixed(2))});}}
  pockets.sort((a,b)=>b.cells-a.cells);
  // exits reachable?
  const exits=s.exits.map(e=>{let r=0;for(let i=0;i<G.nx;i++)for(let j=0;j<G.nz;j++){const [x,z]=G.pos(i,j);if(Math.abs(x-e.x)<1.35&&Math.abs(z-e.z)<.9&&reach[i*G.nz+j])r++;}return {to:e.to,x:e.x,z:e.z,reachableCells:r};});
  // narrow passages: walkable cells with collider on both opposite sides within 0.75m (bottlenecks)
  return {scene,limit:s.limit,nItems:its.length,nSolids:solids.length,walkCells:walk,reachCells:[...reach].reduce((a,b)=>a+b,0),walkThrough,blocks,spawns:spawnInfo,pockets,exits};
}
// sample points across reachable area (for camera probe / walk targets)
function samplePoints(scene,spawn,maxN=60){const G=grid(scene,.25);const [si,sj]=G.cell(spawn.x,spawn.z);const B=bfs(G,si,sj);const cells=[];for(let k=0;k<B.dist.length;k++)if(B.dist[k]>=0)cells.push(k);
  if(!cells.length)return [];const pts=cells.map(c=>G.pos(Math.floor(c/G.nz),c%G.nz));
  // farthest point sampling from spawn
  const out=[[spawn.x,spawn.z]];const md=pts.map(p=>Math.hypot(p[0]-spawn.x,p[1]-spawn.z));
  while(out.length<Math.min(maxN,pts.length)){let bi=0;for(let i=1;i<pts.length;i++)if(md[i]>md[bi])bi=i;if(md[bi]<.6)break;const p=pts[bi];out.push(p);for(let i=0;i<pts.length;i++)md[i]=Math.min(md[i],Math.hypot(pts[i][0]-p[0],pts[i][1]-p[1]));}
  return out.map(p=>[+p[0].toFixed(2),+p[1].toFixed(2)]);}
// ---- (c2) real-input auto walk ----
function pathTo(G,from,to){const [si,sj]=G.cell(from[0],from[1]);const B=bfs(G,si,sj);const [ti,tj]=G.cell(to[0],to[1]);let k=ti*G.nz+tj;if(!(k>=0&&k<B.dist.length)||B.dist[k]<0)return null;const cells=[];while(k>=0){cells.unshift(k);k=B.prev[k];}
  const pts=cells.map(c=>G.pos(Math.floor(c/G.nz),c%G.nz));
  // string-pull with grid line-of-sight
  const los=(a,b)=>{const d=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(d/.08);for(let i=1;i<n;i++){const x=a[0]+(b[0]-a[0])*i/n,z=a[1]+(b[1]-a[1])*i/n;if(!worldCanMove(x,z))return false;}return true;};
  const out=[pts[0]];let i=0;while(i<pts.length-1){let j=pts.length-1;while(j>i+1&&!los(pts[i],pts[j]))j--;out.push(pts[j]);i=j;}return out;}
async function autoWalk(scene,targets,{legTimeout=25,stuckSec=1.2,legLen=6}={}){
  const w=W3,s=space(scene);const G=grid(scene,.25);const meshes=rayMeshes(scene);const log={scene,legs:[],stuck:[],contacts:new Map(),trail:[],exitsTouched:[]};
  const dirs=[];for(let k=0;k<8;k++)dirs.push(new T.Vector3(Math.cos(k*Math.PI/4),0,Math.sin(k*Math.PI/4)));
  const saveCd=w.exitCooldownUntil;
  const contact=()=>{const p=w.player.position;for(const y of [.45,1.2]){const c=new T.Vector3(p.x,y,p.z);for(const d of dirs){rc.set(c,d);rc.near=0;rc.far=.2;const h=rc.intersectObjects(meshes,false)[0];if(h){const n=hitName(h);const k=n.caller+'|'+n.path;let e=log.contacts.get(k);if(!e){e={...n,n:0,pts:[]};log.contacts.set(k,e);}e.n++;if(e.pts.length<8)e.pts.push([+p.x.toFixed(2),+p.z.toFixed(2),y]);return;}}}};
  await noRender(()=>withDoubleAsync(meshes,async()=>{
  const spawn=[w.player.position.x,w.player.position.z];
  for(const tg of targets){
    if(w.active!==scene)break;
    w.exitCooldownUntil=performance.now()+1e9;
    // leg start: spawn for exit targets, otherwise the point ~legLen before the target on the BFS route from spawn
    let start=spawn;const full=pathTo(G,spawn,[tg[0],tg[1]]);
    if(full&&!tg[2]){let acc=0;for(let i=full.length-1;i>0;i--){acc+=Math.hypot(full[i][0]-full[i-1][0],full[i][1]-full[i-1][1]);if(acc>=legLen){const f=(acc-legLen)/Math.max(1e-6,Math.hypot(full[i][0]-full[i-1][0],full[i][1]-full[i-1][1]));start=[full[i-1][0]+(full[i][0]-full[i-1][0])*f,full[i-1][1]+(full[i][1]-full[i-1][1])*f];break;}}}
    place(start[0],start[1]);stepFrames(2);
    const from=[w.player.position.x,w.player.position.z];const path=pathTo(G,from,tg);const leg={from:from.map(v=>+v.toFixed(2)),to:tg,kind:tg[2]||'grid',reachable:!!path,ok:false,t:0,len:0};
    if(!path){log.legs.push(leg);continue;}
    let wp=1,t0=performance.now(),lastP=w.player.position.clone(),lastT=t0,lastContact=0,len=0;for(let i=1;i<path.length;i++)len+=Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]);leg.len=+len.toFixed(2);
    const limit=Math.min(legTimeout*1000,(len/2.5+4)*1000);
    let simT=0;lastT=0;t0=0;
    while(true){
      stepFrames(1);simT+=40;if(simT%2000===0)await new Promise(r=>setTimeout(r,0));if(w.active!==scene){leg.sceneChanged=w.active;break;}
      if(typeof worldBlocked==='function'&&worldBlocked()){leg.blockedUI=true;}
      const p=w.player.position;const goal=path[Math.min(wp,path.length-1)];let dx=goal[0]-p.x,dz=goal[1]-p.z,d=Math.hypot(dx,dz);
      if(d<.25){if(wp>=path.length-1){leg.ok=true;break;}wp++;continue;}
      dx/=d;dz/=d;const c=Math.cos(w.yaw),sn=Math.sin(w.yaw);w.joy.x=c*dx-sn*dz;w.joy.y=sn*dx+c*dz;
      const now=simT;if(now-lastContact>120){contact();lastContact=now;if(log.trail.length<4000)log.trail.push([+p.x.toFixed(2),+p.z.toFixed(2)]);}
      if(now-lastT>stuckSec*1000){if(p.distanceTo(lastP)<.08){
          const near=s.blocks.filter(b=>p.x>b.x-.6&&p.x<b.X+.6&&p.z>b.z-.6&&p.z<b.Z+.6).map(b=>({x:+b.x.toFixed(2),X:+b.X.toFixed(2),z:+b.z.toFixed(2),Z:+b.Z.toFixed(2),tags:Object.keys(b).filter(k=>!['x','X','z','Z'].includes(k))}));
          log.stuck.push({at:[+p.x.toFixed(2),+p.z.toFixed(2)],goal:goal.map(v=>+v.toFixed(2)),target:tg,canMoveHere:worldCanMove(p.x,p.z),gridSaysFree:true,nearBlocks:near.slice(0,4),yaw:+w.yaw.toFixed(2)});leg.stuck=true;break;}
        lastP.copy(p);lastT=now;}
      if(now-t0>limit){leg.timeout=true;break;}
    }
    w.joy.x=w.joy.y=0;stepFrames(2);leg.t=+(simT/1000).toFixed(1);leg.end=[+w.player.position.x.toFixed(2),+w.player.position.z.toFixed(2)];log.legs.push(leg);
    if(leg.stuck||leg.timeout){ // recover: teleport to target so the tour continues
      place(tg[0],tg[1]);stepFrames(1);}
  }}));
  w.joy.x=w.joy.y=0;w.exitCooldownUntil=saveCd;
  return {...log,contacts:[...log.contacts.values()].sort((a,b)=>b.n-a.n)};
}
// ---- annotated screenshots (renderer canvas + 2D overlay) ----
function project(v,cam,W,H){const p=new T.Vector3(...v).project(cam);return [(p.x+1)/2*W,(1-p.y)/2*H,p.z];}
function boxCorners(min,max){const o=[];for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]])o.push([x,y,z]);return o;}
const EDGES=[[0,1],[0,2],[1,3],[2,3],[4,5],[4,6],[5,7],[6,7],[0,4],[1,5],[2,6],[3,7]];
function annotate(cam,{boxes=[],points=[],segments=[],title='',lines=[]}){
  const w=W3,cv=w.canvas;w.renderer.render(w.scene,cam);const W=cv.width,H=cv.height;const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');g.drawImage(cv,0,0);
  const sc=W/ (cv.clientWidth||W);g.lineWidth=2*sc;g.font=(13*sc)+'px sans-serif';
  for(const b of boxes){const cs=boxCorners(b.min,b.max).map(v=>project(v,cam,W,H));g.strokeStyle=b.color||'#ff2d2d';g.beginPath();for(const [a,bb] of EDGES){if(cs[a][2]>1||cs[bb][2]>1)continue;g.moveTo(cs[a][0],cs[a][1]);g.lineTo(cs[bb][0],cs[bb][1]);}g.stroke();if(b.label){const p=cs[7];g.fillStyle=b.color||'#ff2d2d';g.fillText(b.label,Math.min(W-200*sc,Math.max(2,p[0])),Math.max(14*sc,p[1]));}}
  for(const s of segments){const a=project(s.a,cam,W,H),b=project(s.b,cam,W,H);g.strokeStyle=s.color||'#ffe600';g.setLineDash([6*sc,4*sc]);g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.stroke();g.setLineDash([]);}
  for(const p of points){const a=project(p.v,cam,W,H);if(a[2]>1)continue;g.strokeStyle=p.color||'#ff2d2d';g.lineWidth=3*sc;g.beginPath();g.arc(a[0],a[1],(p.r||14)*sc,0,Math.PI*2);g.stroke();g.lineWidth=2*sc;if(p.label){g.fillStyle=p.color||'#ff2d2d';g.fillText(p.label,a[0]+16*sc,a[1]-6*sc);}}
  const all=[title,...lines].filter(Boolean);if(all.length){g.fillStyle='rgba(0,0,0,.62)';g.fillRect(0,0,W,(all.length*17+8)*sc);g.fillStyle='#fff';all.forEach((t,i)=>g.fillText(t,6*sc,(17+i*17)*sc));}
  return c.toDataURL('image/png');}
function lookCam(target,eye){const w=W3;const cam=new T.PerspectiveCamera(50,w.camera.aspect,.05,300);cam.position.set(...eye);cam.lookAt(...target);cam.updateMatrixWorld();return cam;}
function eyeFor(center,ext,scene){const s=space(scene);const sp=W3.player.position;let dx=sp.x-center[0],dz=sp.z-center[2];let L=Math.hypot(dx,dz);if(L<.5){dx=0;dz=1;L=1;}const d=Math.max(2.2,Math.min(9,ext*1.6+1.5));const e=[center[0]+dx/L*d,center[1]+d*.55+.6,center[2]+dz/L*d];
  const lim=s.limit;e[0]=Math.max(-lim.x+.3,Math.min(lim.x-.3,e[0]));e[2]=Math.max(-lim.z+.3,Math.min(lim.z-.3,e[2]));return e;}
window.__r8={noRender,stepFrames,paused,items,overlaps,satDepth,refine,rayMeshes,cameraProbe,cameraAt,grid,bfs,staticProbe,samplePoints,autoWalk,annotate,lookCam,eyeFor,place,frames,caller,hitName};
})();
