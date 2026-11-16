// r8-smooth: counts/times WebGL work per animation frame (read-only instrumentation in the test page).
(function(){const G=window.__GL={frame:{},log:[],on:false};
 const wrap=(P,names)=>names.forEach(n=>{const o=P[n];if(!o)return;P[n]=function(){if(!G.on)return o.apply(this,arguments);const t=performance.now();try{return o.apply(this,arguments);}finally{const f=G.frame;const d=performance.now()-t;f[n]=(f[n]||0)+1;f[n+'Ms']=(f[n+'Ms']||0)+d;}};});
 for(const P of [WebGL2RenderingContext.prototype,WebGLRenderingContext.prototype])wrap(P,['compileShader','linkProgram','getProgramParameter','getShaderParameter','texImage2D','texSubImage2D','texImage3D','compressedTexImage2D','bufferData','generateMipmap','readPixels','drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']);
 const raf=window.requestAnimationFrame.bind(window);let last=0;
 function tick(ts){if(G.on){const m=performance.memory?.usedJSHeapSize||0;G.log.push({ts:+ts.toFixed(1),dt:last?+(ts-last).toFixed(1):0,heap:m,gl:G.frame,mark:G.mark||''});G.mark='';}G.frame={};last=ts;raf(tick);}raf(tick);
 window.__GLstart=()=>{G.log=[];G.on=true;last=0;};window.__GLstop=()=>{G.on=false;return G.log;};
})();
