// r8-audit init script (addInitScript, runs before any page script; the build file itself is never modified).
// 1) Captures the moment the game assigns `W3` (var W3 -> window accessor) and patches THREE once it exists:
//    - Object3D.add tags every object with its creation stack (userData.__r8src = [[fn,line],...]).
//    - mergeGeometries (global helper) is wrapped: merged geometries are tagged and the source meshes removed during the
//      merge are kept as "ghost parts" (world matrix + geometry) so per-object overlap analysis still works after batching.
(function(){
  if(window.__R8)return;
  const R8=window.__R8={patched:false,ghosts:[],mergeWin:false,lastGeo:null,merges:0,errors:[]};
  const origin=location.origin;try{Error.stackTraceLimit=40;}catch(e){}
  function stack(){
    const st=(new Error().stack||'').split('\n').slice(3),out=[];
    for(const l of st){
      if(l.indexOf(origin)<0&&l.indexOf('github.io')<0)continue;
      const m=l.match(/at (?:(\S+) )?\(?[^()]*?:(\d+):(\d+)\)?$/);if(!m)continue;
      out.push([m[1]||'?',+m[2]]);if(out.length>=14)break;
    }
    return out;
  }
  function patch(){
    if(R8.patched)return true;
    let T;try{T=THREE;}catch(e){return false;}
    if(!T||!T.Object3D)return false;
    R8.patched=true;
    const P=T.Object3D.prototype,add0=P.add,rem0=P.remove;
    P.add=function(...objs){for(const o of objs){if(o&&o.userData&&!o.userData.__r8src)o.userData.__r8src=stack();}return add0.apply(this,objs);};
    P.remove=function(...objs){
      if(R8.mergeWin){
        for(const o of objs){
          if(!o||!o.isMesh||o.parent!==this)continue;
          try{
            const g=o.geometry;
            if(g&&g.userData&&g.userData.__r8merged){ // a merged mesh merged again: re-link its ghosts
              for(const gh of R8.ghosts)if(gh.geo===g)gh.geo=R8.lastGeo;continue;
            }
            this.updateWorldMatrix(true,false);o.updateMatrix();
            const wm=new T.Matrix4().multiplyMatrices(this.matrixWorld,o.matrix);
            R8.ghosts.push({mesh:o,world:wm,geo:R8.lastGeo,src:o.userData.__r8src||[],name:o.name||'',parentName:this.name||'',inst:o.isInstancedMesh});
          }catch(e){R8.errors.push(String(e));}
        }
      }
      return rem0.apply(this,objs);
    };
    wrapMerge();
    return true;
  }
  function wrapMerge(){
    const mg=window.mergeGeometries;
    if(typeof mg!=='function'||mg.__r8)return;
    const w=function(){
      const g=mg.apply(this,arguments);
      if(g){g.userData=g.userData||{};g.userData.__r8merged=true;R8.lastGeo=g;R8.merges++;}
      R8.mergeWin=true;queueMicrotask(()=>{R8.mergeWin=false;});
      return g;
    };
    w.__r8=true;window.mergeGeometries=w;
  }
  try{
    Object.defineProperty(window,'W3',{configurable:true,enumerable:true,get(){return R8.w3;},set(v){R8.w3=v;try{patch();wrapMerge();}catch(e){R8.errors.push(String(e));}}});
  }catch(e){R8.errors.push('defineProperty W3: '+e);}
  // Belt and braces: before every later parser-inserted script and at DOMContentLoaded.
  try{new MutationObserver(()=>{patch();wrapMerge();}).observe(document,{childList:true,subtree:true});}catch(e){}
  document.addEventListener('DOMContentLoaded',()=>{patch();wrapMerge();});
})();
