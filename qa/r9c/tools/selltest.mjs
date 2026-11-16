// r9 part 1 sell / buy-back / seed tests on the packed build with mocked backends. One browser, sequential contexts.
import fs from 'node:fs';import http from 'node:http';import {createRequire} from 'node:module';
const ROOT='/workspace',BUILD=process.env.BUILD||ROOT+'/v4/index.r9d.html',OUT=ROOT+'/qa/r9c/out';
const require=createRequire(ROOT+'/qa/tools-node/package.json');const {chromium}=require('playwright-core');
const buf=fs.readFileSync(BUILD);const srv=http.createServer((q,r)=>{r.setHeader('content-type','text/html; charset=utf-8');r.end(buf);}).listen(0,'127.0.0.1');await new Promise(r=>srv.on('listening',r));
const URL=`http://127.0.0.1:${srv.address().port}/`;
const br=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const results=[];let fails=0;
const check=(name,ok,info)=>{results.push({name,ok:!!ok,info});if(!ok)fails++;console.log(ok?'PASS':'FAIL',name,info!==undefined?JSON.stringify(info).slice(0,400):'');};
function initScript({mock,legacy,auth,noLocks}){
 if(noLocks)try{Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});}catch(e){}
 if(auth){const A=window.TG_AUTH={_u:auth,online:true,_cbs:[],get userId(){return this._u;},onChange(cb){this._cbs.push(cb);},_set(u){this._u=u;this._cbs.forEach(c=>{try{c({userId:u});}catch(e){}});}};}
 window.TG_BACKEND_CONFIG={publicRoomSuffix:'~test',cloudSave:false};
 window.__calls=[];const C=(...a)=>window.__calls.push(a);
 window.TG_STORAGE_ADAPTER={async load(){const r=localStorage.getItem('templeGarden.v1');return r?JSON.parse(r):null;},async save(s){localStorage.setItem('templeGarden.v1',JSON.stringify(s));},async clear(){localStorage.removeItem('templeGarden.v1');},async flush(){C('flush');}};
 if(legacy&&!sessionStorage.getItem('seeded-ls')){sessionStorage.setItem('seeded-ls','1');localStorage.setItem('templeGarden.v1',JSON.stringify(legacy));}
 if(mock==='none')return;
 const M=window.__M={sell:100,earn:40,merit:8,sb:400,credit:{},seedReplies:[],seeded:false,sellbackReplies:[],buyReplies:[],dropNext:0,done:{},r9:mock==='r9'};
 const E={earn(n,src,exact){C('earn',n,src,!!exact);if((mock==='offline'||window.__M?.off))return n;const k=src==='sell'&&M.r9?'sell':'earn';const g=Math.min(n,M[k]);if(g<=0||exact&&g<n)return 0;M[k]-=g;if(src==='merit')M.merit-=g;return g;},
  earnAsync:async n=>n,
  status:async()=>{C('status');if((mock==='offline'||window.__M?.off))return {ok:false,reason:'offline'};const s={day:'d',earn_left:M.earn,merit_coins_left:M.merit,steal_left:15};if(M.r9){s.sell_left=M.sell;s.sell_cap=100;s.sellback_left=M.sb;}return s;}};
 if(mock!=='oldclient'){
  E.left=src=>{if((mock==='offline'||window.__M?.off))return null;if(src==='sellback')return M.r9?M.sb:null;return src==='sell'&&M.r9?M.sell:M.earn;};
  E.shopBuy=async(id,q)=>{C('shopBuy',id,q);await new Promise(r=>setTimeout(r,60));const bx=M.buyReplies.shift();if(bx)return bx;if(!M.r9)return {ok:false,reason:(mock==='offline'||window.__M?.off)?'offline':'old_schema'};M.credit[id]=(M.credit[id]|0)+q;return {ok:true,credit:M.credit[id]};};
  E.sellback=async(id,q,unit,req)=>{C('sellback',id,q,unit,req,localStorage.getItem('templeGarden.r9.sellbackPending'),window.TG_AUTH?.userId||null,Object.keys(localStorage).filter(k=>k.startsWith('templeGarden.r9.sellbackPending')).map(k=>localStorage.getItem(k)).join('|'));if((mock==='offline'||window.__M?.off))return {ok:false,reason:'offline',req};if(!M.r9)return {ok:false,reason:'old_schema',req};
   const fx=M.sellbackReplies.shift();if(fx)return Object.assign({req},fx);
   while(localStorage.getItem('__hold')==='1')await new Promise(r=>setTimeout(r,50));   // test hook: hold server replies (cross-tab race)
   const DK='__mockDone',dn=()=>{try{return JSON.parse(localStorage.getItem(DK)||'{}');}catch(e){return {};}};if(dn()[req])return {...dn()[req],replay:true};   // server is idempotent per req (shared by tabs)
   if((M.credit[id]|0)<q)return {ok:false,reason:'no_credit',credit:M.credit[id]|0,req};if(M.sb<unit*q)return {ok:false,reason:'daily_cap',left:M.sb,req};M.credit[id]-=q;M.sb-=unit*q;const res={ok:true,granted:unit*q,unit,credit_left:M.credit[id],left:M.sb,req};{const o=dn();o[req]=res;localStorage.setItem(DK,JSON.stringify(o));}
   if(M.dropNext>0){M.dropNext--;return {ok:false,reason:'error',req};}   // applied on the server, response lost
   return res;};
  E.sellbackSeed=async items=>{C('sellbackSeed',JSON.stringify(items));if((mock==='offline'||window.__M?.off))return {ok:false,reason:'offline'};if(!M.r9)return {ok:false,reason:'old_schema'};const fx=M.seedReplies.shift();if(fx)return fx;if(M.seeded)return {ok:false,reason:'done'};M.seeded=true;const got={};let used=0;for(const [k,v] of Object.entries(items)){const n=Math.min(v,10)-(k==='cushion'||k==='vase'?1:0);if(n>0){got[k]=n;M.credit[k]=(M.credit[k]|0)+n;}}return {ok:true,credit:got,value:used};};
  E.sellbackCredit=async()=>{C('sellbackCredit');if((mock==='offline'||window.__M?.off))return {ok:false,reason:'offline'};if(!M.r9)return {ok:false,reason:'old_schema'};return {credit:{...M.credit},prices:{'wood-table':30,bench:15,cabinet:50,daybed:80,'altar-table':45,'rocking-chair':42,vase:12,lantern:20,bonsai:27,screen:40,cushion:10},seeded:M.seeded,left:M.sb};};
 }
 window.TG_ECON=E;
}
async function page(mock,legacy,opt={}){const ctx=opt.ctx||await br.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});if(!opt.ctx){await ctx.route(u=>!String(u).startsWith(URL),r=>r.abort());
 await ctx.addInitScript(initScript,{mock,legacy:legacy||null,auth:opt.auth||null,noLocks:!!opt.noLocks});}const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push('console:'+m.text());});p.on('dialog',d=>d.dismiss());
 await p.goto(URL);await p.waitForFunction(()=>window.W3?.player&&W3.active&&window.TG_R9?.sell,null,{timeout:240000});
 await p.evaluate(async()=>{try{S.unlocked=true;closeModal();}catch(e){} window.__toasts=[];const t=toast;window.toast=toast=function(m){window.__toasts.push(String(m));return t.apply(this,arguments);};await TG_R9.sell.probe();});
 await p.waitForTimeout(500);return {p,ctx,errs};}
const ev=(p,f,a)=>p.evaluate(f,a);
try{
// ---------- A. no backend (local): shared 40, partial 全卖, merit exchange, local buy-back ----------
{const {p,ctx,errs}=await page('none');
 const r=await ev(p,async()=>{const X=TG_R9.sell,d=r6Daily();S.inventory.melon=10;S.inventory.cabbage=3;openShop('sell');const cap0=$('#r9SellCap').textContent;
  document.querySelector('[data-r9-sell-all="melon"]').click();const after={coins:S.coins,melon:S.inventory.melon,coinsEarned:d.coinsEarned,sellCoins:d.sellCoins,cap:$('#r9SellCap').textContent,toast:__toasts.at(-1),oneDisabled:document.querySelector('[data-r9-sell="melon"]').disabled,cabDisabled:document.querySelector('[data-r9-sell="cabbage"]').disabled};
  return {mode:X.mode,fb:X.fb,cap0,after,tab:[...document.querySelectorAll('.r3-tabs button')].map(b=>b.textContent)};});
 check('A1 local mode = shared 40',r.mode==='local'&&r.cap0.startsWith('今日出售 0/40'),r);
 check('A2 全卖 sells what fits (5 melons = 40)',r.after.melon===5&&r.after.coinsEarned===40&&r.after.sellCoins===40&&r.after.coins===90,r.after);
 check('A3 toast explains the rest waits',/已卖出 西瓜×5.*剩下 5 份明天再卖/.test(r.after.toast||''),r.after.toast);
 check('A4 卖 1 disabled at cap, display 40/40',r.after.oneDisabled&&r.after.cabDisabled&&r.after.cap.startsWith('今日出售 40/40'),r.after.cap);
 check('A5 tab renamed 卖作物/产物',r.tab.includes('卖作物/产物')&&!r.tab.includes('出售作物'),r.tab);
 const m=await ev(p,()=>{const d=r6Daily();d.coinsEarned=0;S.merit=60;const ok=r5MeritCoins();const a={ok,merit:S.merit,meritCoins:d.meritCoins,coinsEarned:d.coinsEarned};d.coinsEarned=40;const ok2=r5MeritCoins();return {a,ok2,merit2:S.merit,toast:__toasts.at(-1)};});
 check('A6 merit exchange local ok; refused at shared cap without losing 善缘',m.a.ok&&m.a.merit===35&&m.a.meritCoins===1&&m.a.coinsEarned===1&&m.ok2===false&&m.merit2===35,m);
 const s=await ev(p,()=>{const d=r6Daily();d.date='2000-01-01';const n=r6Daily();return {sellCoins:n.sellCoins,sellbackCoins:n.sellbackCoins,coinsEarned:n.coinsEarned};});
 check('A7 sellCoins/sellbackCoins reset daily',s.sellCoins===0&&s.sellbackCoins===0&&s.coinsEarned===0,s);
 const b=await ev(p,async()=>{S.coins=500;openShop('furniture');document.querySelector('[data-buy="wood-table"]').click();const afterBuy={bp:S.backpack['wood-table'],sl:S.sellable['wood-table'],coins:S.coins};
  openShop('offering');const ob=document.querySelector('[data-buy]');const oid=ob?.dataset.buy;ob?.click();const offSl=S.sellable[oid];
  openShop('sell');const rows=[...document.querySelectorAll('[data-r9-furn]')].map(r=>r.dataset.r9Furn+':'+r.querySelector('small').textContent);
  document.querySelector('[data-r9-sellback="wood-table"]').click();const confirm=document.querySelector('[data-r9-confirm]')?.textContent;document.querySelector('#r9SellNo').click();const stillBp=S.backpack['wood-table'],c0=S.coins;
  document.querySelector('[data-r9-sellback="wood-table"]').click();document.querySelector('#r9SellYes').click();await new Promise(r=>setTimeout(r,300));
  const d=r6Daily();return {afterBuy,oid,offSl,rows,confirm,stillBp,c0,after:{bp:S.backpack['wood-table'],sl:S.sellable['wood-table']|0,coins:S.coins,sb:d.sellbackCoins},toast:__toasts.at(-1),cushionBtn:document.querySelector('[data-r9-sellback="cushion"]')?.disabled};});
 check('A8 shop buy adds sellable for buy-back ids only (offering none)',b.afterBuy.sl===1&&b.oid&&!b.offSl,{afterBuy:b.afterBuy,oid:b.oid,offSl:b.offSl});
 check('A9 confirm dialog text; 再想想 changes nothing',/把 .*木桌 ×1 卖回商铺，得 🪙 30/.test(b.confirm||'')&&b.stillBp===1,b.confirm);
 check('A10 local buy-back: bp-1, sellable-1, +30, sellbackCoins 30',b.after.bp===0&&b.after.sl===0&&b.after.sb===30&&b.after.coins===b.c0+30,b.after);
 check('A11 starter cushion not sellable, reason shown',b.cushionBtn===true&&b.rows.some(x=>/^cushion:.*初始赠送/.test(x)),b.rows);
 const cap=await ev(p,async()=>{const d=r6Daily();S.backpack.daybed=1;S.sellable.daybed=1;d.sellbackCoins=390;openShop('sell');document.querySelector('[data-r9-sellback="daybed"]').click();document.querySelector('#r9SellYes').click();await new Promise(r=>setTimeout(r,200));return {bp:S.backpack.daybed,sb:d.sellbackCoins,toast:__toasts.at(-1)};});
 check('A12 buy-back daily cap 400 (local)',cap.bp===1&&cap.sb===390&&/今日回收已满 400/.test(cap.toast),cap);
 const vis=await ev(p,async()=>{window.TG_VISIT={ownerId:'x',canEdit:true,family:true};openShop('sell');const txt=document.querySelector('[data-r9-sell-tab]')?.textContent;await TG_R9.sell.sellBack('daybed');const t=__toasts.at(-1);delete window.TG_VISIT;return {txt,t,bp:S.backpack.daybed};});
 check('A13 no selling while visiting (even canEdit)',/串门时不能卖/.test(vis.txt)&&/串门/.test(vis.t)&&vis.bp===1,vis);
 const pl=await ev(p,()=>{S.backpack.screen=0;S.sellable.screen=1;S.decor.yard=(S.decor.yard||[]).concat([{id:'screen',x:1,z:1,rot:0}]);openShop('sell');return document.querySelector('[data-r9-furn="screen"] small')?.textContent;});
 check('A14 placed item: 请先收起',/已摆放 1 件，请先收起再卖/.test(pl||''),pl);
 check('A errors 0',errs.length===0,errs);await ctx.close();}
// ---------- B. r9 server mock ----------
{const {p,ctx,errs}=await page('r9');
 const r=await ev(p,async()=>{const X=TG_R9.sell,d=r6Daily();S.inventory.melon=20;S.inventory.cabbage=10;openShop('sell');const cap0=$('#r9SellCap').textContent;
  document.querySelector('[data-r9-sell-all="melon"]').click();const a={melon:S.inventory.melon,sellCoins:d.sellCoins,coinsEarned:d.coinsEarned,toast:__toasts.at(-1)};
  document.querySelector('[data-r9-sell-all="cabbage"]').click();const b={cab:S.inventory.cabbage,sellCoins:d.sellCoins,cap:$('#r9SellCap').textContent};
  const earnCalls=__calls.filter(c=>c[0]==='earn');return {mode:X.mode,fb:X.fb,cap0,a,b,earnCalls};});
 check('B1 r9 mode cap 100',r.mode==='r9'&&r.fb==='server'&&r.cap0.startsWith('今日出售 0/100'),{mode:r.mode,fb:r.fb,cap0:r.cap0});
 check('B2 全卖 up to 100: 12 melons (96) then 4 cabbage; task pool untouched',r.a.melon===8&&r.a.sellCoins===96&&r.a.coinsEarned===0&&r.b.cab===6&&r.b.sellCoins===100&&r.b.cap.startsWith('今日出售 100/100'),{a:r.a,b:r.b});
 check('B3 earn called with source sell, exact',r.earnCalls.every(c=>c[2]==='sell'&&c[3]===true)&&r.earnCalls.length===2,r.earnCalls);
 const t=await ev(p,()=>{const d=r6Daily();S.merit=100;const ok=r5MeritCoins();const last=__calls.filter(c=>c[0]==='earn').at(-1);return {ok,last,coinsEarned:d.coinsEarned};});
 check('B4 merit exchange passes merit (not task); not blocked by a full sell cap',t.ok&&t.last[2]==='merit'&&t.coinsEarned===1,t);
 const buy=await ev(p,async()=>{S.coins=1000;openShop('furniture');document.querySelector('[data-buy="wood-table"]').click();document.querySelector('[data-buy="wood-table"]').click();openShop('decor');document.querySelector('[data-buy="lantern"]').click();await new Promise(r=>setTimeout(r,100));
  return {sl:{...S.sellable},buys:__calls.filter(c=>c[0]==='shopBuy'),credit:{...__M.credit}};});
 check('B5 shopBuy fire-and-forget per unit',buy.buys.length===3&&buy.sl['wood-table']===2&&buy.sl.lantern===1,buy);
 const sb=await ev(p,async()=>{const X=TG_R9.sell;await X.probe();openShop('sell');const k=X.sellableNow('wood-table');document.querySelector('[data-r9-sellback="wood-table"]').click();document.querySelector('#r9SellYes').click();await new Promise(r=>setTimeout(r,300));
  const call=__calls.filter(c=>c[0]==='sellback').at(-1),d=r6Daily();return {k,call,bp:S.backpack['wood-table'],sl:S.sellable['wood-table'],sb:d.sellbackCoins,sellCoins:d.sellCoins,pend:localStorage.getItem('templeGarden.r9.sellbackPending'),toast:__toasts.at(-1)};});
 check('B6 online sell-back: unit 30, req persisted BEFORE the call, applied after ok, not in sell cap',sb.call&&sb.call[3]===30&&sb.call[7]&&[].concat(JSON.parse(sb.call[7].split('|')[0]))[0].req===sb.call[4]&&sb.bp===1&&sb.sl===1&&sb.sb===30&&sb.sellCoins===100&&sb.pend===null,sb);
 const er=await ev(p,async()=>{const X=TG_R9.sell;__M.sellbackReplies.push({ok:false,reason:'error'});const coins=S.coins;await X.sellBack('wood-table');const p1=[].concat(X.pending()||[]),bp1=S.backpack['wood-table'],c1=S.coins;
  await X.retryPending();const calls=__calls.filter(c=>c[0]==='sellback').slice(-2);return {p1,bp1,same:c1===coins,calls:calls.map(c=>c[4]),bp2:S.backpack['wood-table'],coins2:S.coins-coins,pend2:[].concat(X.pending()||[])};});
 check('B7 error keeps pending + local unchanged; retry reuses the same req',er.p1.length===1&&er.bp1===1&&er.same&&er.calls[0]===er.calls[1]&&er.bp2===0&&er.coins2===30&&er.pend2.length===0,er);
 const bad=await ev(p,async()=>{const X=TG_R9.sell;const out={};for(const why of ['bad_req','bad_qty','not_sellable','price_changed','daily_cap','no_credit']){__M.sellbackReplies.push({ok:false,reason:why,unit:20,left:0,credit:0});const bp=S.backpack.lantern,c=S.coins;await X.sellBack('lantern');out[why]={same:S.backpack.lantern===bp&&S.coins===c,pend:[].concat(X.pending()||[]),toast:__toasts.at(-1)};if(why==='daily_cap')X.sbLeft=400;}return out;});
 check('B8 bad_req/bad_qty/not_sellable/price_changed/daily_cap/no_credit: nothing changes, pending cleared, toast',Object.values(bad).every(v=>v.same&&!v.pend.length&&v.toast),bad);
 const nc=await ev(p,async()=>{const X=TG_R9.sell;S.backpack.bench=1;S.sellable.bench=1;await X.probe();openShop('sell');const txt=document.querySelector('[data-r9-furn="bench"] small')?.textContent;const dis=document.querySelector('[data-r9-sellback="bench"]')?.disabled;return {txt,dis};});
 check('B9 bought offline (local credit, no server credit) → not sellable online, reason shown',nc.dis===true&&/没有联网时买的/.test(nc.txt||''),nc);
 check('B errors 0',errs.length===0,errs);await ctx.close();}
// ---------- C. old client (TG_ECON without the r9 functions) ----------
{const {p,ctx,errs}=await page('oldclient');
 const r=await ev(p,()=>{const X=TG_R9.sell,d=r6Daily();S.inventory.melon=10;S.backpack['wood-table']=1;S.sellable['wood-table']=1;openShop('sell');const cap0=$('#r9SellCap').textContent;const furn=!!document.querySelector('#r9SbCap');
  document.querySelector('[data-r9-sell-all="melon"]').click();return {mode:X.mode,fb:X.fb,cap0,furn,melon:S.inventory.melon,ce:d.coinsEarned,sc:d.sellCoins,earn:__calls.filter(c=>c[0]==='earn')};});
 check('C1 old client: shared 40, 全卖 partial (5)',r.mode==='old-client'&&r.cap0.startsWith('今日出售 0/40')&&r.melon===5&&r.ce===40,r);
 check('C2 old client: furniture buy-back hidden',r.fb==='hidden'&&!r.furn,r.fb);
 const bag=await ev(p,()=>{r3OpenBackpack();return document.querySelector('#r9BagSell')?.textContent||null;});
 check('C3 backpack button 卖作物换铜钱',bag==='卖作物换铜钱',bag);
 check('C errors 0',errs.length===0,errs);await ctx.close();}
// ---------- D. new client, old server ----------
{const {p,ctx,errs}=await page('oldserver');
 const r=await ev(p,async()=>{const X=TG_R9.sell,d=r6Daily();await X.probe();S.inventory.wool=10;openShop('sell');const cap0=$('#r9SellCap').textContent;const furn=!!document.querySelector('#r9SbCap');document.querySelector('[data-r9-sell-all="wool"]').click();
  return {mode:X.mode,fb:X.fb,cap0,furn,wool:S.inventory.wool,ce:d.coinsEarned,toast:__toasts.at(-1)};});
 check('D1 old server: fallback shared 40 (5 wool)',r.mode==='old-server'&&r.cap0.startsWith('今日出售 0/40')&&r.wool===5&&r.ce===40,r);
 check('D2 old server: buy-back hidden (old_schema)',r.fb==='hidden'&&!r.furn,r.fb);
 check('D errors 0',errs.length===0,errs);await ctx.close();}
// ---------- E. offline (TG_ECON present, not signed in) ----------
{const {p,ctx,errs}=await page('offline');
 const r=await ev(p,async()=>{const X=TG_R9.sell,d=r6Daily();await X.probe();S.inventory.melon=10;openShop('sell');const cap0=$('#r9SellCap').textContent;document.querySelector('[data-r9-sell-all="melon"]').click();
  S.coins=500;openShop('furniture');document.querySelector('[data-buy="bench"]').click();openShop('sell');const btn=document.querySelector('[data-r9-sellback="bench"]');const dis=btn?.disabled;btn?.click();document.querySelector('#r9SellYes')?.click();await new Promise(r=>setTimeout(r,200));
  return {mode:X.mode,fb:X.fb,cap0,melon:S.inventory.melon,ce:d.coinsEarned,dis,bench:S.backpack.bench,sb:d.sellbackCoins};});
 check('E1 offline: shared 40 local cap',r.mode==='offline'&&r.cap0.includes('/40')&&r.cap0.includes('未联网')&&r.melon===5&&r.ce===40,r);
 check('E2 offline: buy-back by local rules',r.fb==='local'&&r.dis===false&&r.bench===0&&r.sb===15,r);
 check('E errors 0',errs.length===0,errs);await ctx.close();}
// ---------- F. legacy seed ----------
const legacy={v:1,coins:300,backpack:{'wood-table':3,cushion:2,vase:1,daybed:12},inventory:{},decor:{yard:[{id:'bench',x:1,z:1,rot:0},{id:'daybed',x:2,z:2,rot:0}]},merit:0,plots:[],shrine:{style:'wood',plaques:[]},animals:[],unlocked:true,harvestTotal:5};
{const {p,ctx,errs}=await page('none',legacy);
 const r=await ev(p,async()=>{await TG_R9.sell.seedNow();return {flag:S.sellSeeded,sl:{...S.sellable},seed:TG_R9.sell.seed};});
 // budget 1000, most expensive first: daybed min(13,10)=10 → 800; wood-table 3 → 890; bench 1 → 905; cushion 2-1=1 → 915; vase 1-1=0
 check('F1 local seed: ≤10/item, starter −1, 1000 budget',r.flag===true&&r.sl.daybed===10&&r.sl['wood-table']===3&&r.sl.bench===1&&r.sl.cushion===1&&!r.sl.vase&&r.seed.value===915,r);
 const again=await ev(p,async()=>{S.sellable.daybed=2;save();const x=await TG_R9.sell.seedNow();return {x,d:S.sellable.daybed};});
 check('F2 seed runs once',again.x==='skip'&&again.d===2,again);
 await p.waitForTimeout(1500);await p.reload();await p.waitForFunction(()=>window.TG_R9?.sell&&window.W3?.player,null,{timeout:240000});await p.waitForTimeout(5500);
 const re=await ev(p,()=>({flag:S.sellSeeded,d:S.sellable.daybed}));check('F3 after reload: flag kept, no re-seed',re.flag===true&&re.d===2,re);
 check('F errors 0',errs.length===0,errs);await ctx.close();}
{const {p,ctx,errs}=await page('r9',legacy);
 const r=await ev(p,async()=>{const X=TG_R9.sell;await new Promise(r=>setTimeout(r,4500));
  const boot={flag:S.sellSeeded,calls:__calls.map(c=>c[0]).filter(x=>['flush','sellbackSeed'].includes(x))};
  __M.seeded=false;__M.credit={};delete S.sellSeeded;S.sellable={};__calls.length=0;
  __M.seedReplies.push({ok:false,reason:'no_save'},{ok:false,reason:'stale_save'});
  openShop('sell');const before=document.querySelector('[data-r9-furn="wood-table"] small')?.textContent;const beforeBtn=document.querySelector('[data-r9-sellback="wood-table"]')?.disabled;
  const a=await X.seedNow();const b=await X.seedNow();const c=await X.seedNow();
  const seq=__calls.map(x=>x[0]).filter(x=>['flush','sellbackSeed','sellbackCredit'].includes(x));return {boot,a,b,c,seq,flag:S.sellSeeded,sl:{...S.sellable},credit:{...__M.credit},items:__calls.find(x=>x[0]==='sellbackSeed')?.[1],before,beforeBtn};});
 check('F4 server seed at boot ran with flush',r.boot.flag===true&&r.boot.calls[0]==='flush'&&r.boot.calls.includes('sellbackSeed'),r.boot);
 check('F5 no_save / stale_save → flush + retry, then ok',r.a==='no_save'&&r.b==='stale_save'&&r.c==='ok'&&r.flag===true,{a:r.a,b:r.b,c:r.c,flag:r.flag});
 check('F6 flush before every seed call',(()=>{const s=r.seq;let lastSeed=-1;for(let i=0;i<s.length;i++)if(s[i]==='sellbackSeed'){if(!s.slice(lastSeed+1,i).includes('flush'))return false;lastSeed=i;}return s.filter(x=>x==='sellbackSeed').length===3;})(),r.seq);
 const it=JSON.parse(r.items||'{}');
 check('F7 seed sends owned = backpack + placed; local aligned to server credit',it.daybed===13&&it.bench===1&&it['wood-table']===3&&r.sl.daybed===10&&r.sl.cushion===1&&!r.sl.vase,{items:it,sl:r.sl});
 check('F8 before seeding: rows say 正在核对 and 卖回 disabled',/正在核对/.test(r.before||'')&&r.beforeBtn===true,r.before);
 check('F errors 0 (server)',errs.length===0,errs);await ctx.close();}
// ---------- G. anti-farming ----------
{const {p,ctx,errs}=await page('r9');
 const r=await ev(p,async()=>{const X=TG_R9.sell;await X.probe();const out={};
  out.starter={c:S.backpack.cushion,v:S.backpack.vase,sl:{...S.sellable},seeded:S.sellSeeded};
  TG_INV_GIVE('decor','screen',2);out.gift=S.sellable.screen|0;
  const mid=TG_CATALOG.find(c=>c.meritPrice&&['furniture','decor'].includes(c.cat))?.id;S.backpack[mid]=1;openShop('sell');const mrow=document.querySelector(`[data-r9-furn="${mid}"]`);out.merit={id:mid,bp:S.backpack[mid]|0,sl:S.sellable[mid]|0,reason:X.reasonOf(mid),row:mrow?.textContent,btn:!!mrow?.querySelector('button')};
  window.TG_VISIT={ownerId:'h',canEdit:true,family:true};S.decor.yard=[{id:'lantern',x:0,z:0,rot:0}];const slB=S.sellable.lantern|0;
  const [it]=S.decor.yard.splice(0,1);S.backpack[it.id]=(S.backpack[it.id]||0)+1;out.family={sl:S.sellable.lantern|0,before:slB};delete window.TG_VISIT;
  S.coins=1000;openShop('furniture');document.querySelector('[data-buy="cabinet"]').click();const s1=S.sellable.cabinet;TG_INV_TAKE('decor','cabinet',1);out.take={before:s1,after:S.sellable.cabinet};
  openShop('sell');out.rows=[...document.querySelectorAll('[data-r9-furn]')].map(r=>r.dataset.r9Furn+':'+(r.querySelector('button')?.disabled??'nobtn')+':'+r.querySelector('small').textContent);
  out.sellable={...S.sellable};return out;});
 check('G1 starter cushion/vase: no credit; new save already seeded',!r.starter.sl.cushion&&!r.starter.sl.vase&&r.starter.seeded===true,r.starter);
 check('G2 gift / market claim (TG_INV_GIVE) never sellable',r.gift===0&&r.rows.some(x=>/^screen:true:.*寄售、赠送/.test(x)),r.rows);
 check('G3 善缘阁 item never sellable (row shows reason, no button)',r.merit.id&&r.merit.sl===0&&/善缘换来的/.test(r.merit.reason)&&/善缘换来的/.test(r.merit.row||'')&&!r.merit.btn,r.merit);
 check('G4 family stow adds no credit',r.family.sl===r.family.before,r.family);
 check('G5 market listing clamps credit to backpack',r.take.before===1&&r.take.after===0,r.take);
 check('G errors 0',errs.length===0,errs);await ctx.close();}
// ---------- H. r9b M1: dropped response + a second sell during the 15 s auto-retry ----------
{const {p,ctx,errs}=await page('r9');
 const buy=async(ids)=>ev(p,async ids=>{S.coins=(S.coins|0)+2000;for(const id of ids){const c=TG_CATALOG.find(x=>x.id===id);openShop(c.cat);document.querySelector(`[data-buy="${id}"]`).click();}await new Promise(r=>setTimeout(r,400));await TG_R9.sell.probe();},ids);
 await buy(['lantern','lantern','lantern','screen']);
 const a=await ev(p,async()=>{const X=TG_R9.sell;__M.dropNext=1;const c0=S.coins;await X.sellBack('lantern');
  return {pend:[].concat(X.pending()||[]),bp:S.backpack.lantern,sl:S.sellable.lantern,same:S.coins===c0,srv:{credit:__M.credit.lantern,sb:__M.sb},toast:__toasts.at(-1),c0};});
 check('H1 dropped response: 1 pending, local unchanged, server already applied',a.pend.length===1&&a.pend[0].id==='lantern'&&a.bp===3&&a.sl===3&&a.same&&a.srv.credit===2&&a.srv.sb===380&&/网络不稳/.test(a.toast),a);
 const b=await ev(p,async()=>{const X=TG_R9.sell;openShop('sell');await new Promise(r=>setTimeout(r,300));const n0=__calls.filter(c=>c[0]==='sellback').length;
  const btnS=document.querySelector('[data-r9-sellback="screen"]'),btnL=document.querySelector('[data-r9-sellback="lantern"]');
  const rowS=document.querySelector('[data-r9-furn="screen"] small')?.textContent;const banner=document.querySelector('#r9SbPend')?.textContent;
  await X.sellBack('screen');const n1=__calls.filter(c=>c[0]==='sellback').length;
  return {dis:[btnS?.disabled,btnL?.disabled],rowS,banner,calls:n1-n0,toast:__toasts.at(-1),screen:S.backpack.screen,pend:[].concat(X.pending()||[]).length};});
 check('H2 while pending: every 卖回 button disabled + banner; selling the screen is refused with no server call',b.dis.every(x=>x===true)&&/上一笔卖回还在确认/.test(b.rowS||'')&&/确认前先不能卖别的家具/.test(b.banner||'')&&b.calls===0&&/上一笔卖回还在确认/.test(b.toast)&&b.screen===1&&b.pend===1,b);
 await p.waitForTimeout(16500);
 const c=await ev(p,async()=>{const X=TG_R9.sell;const sbc=__calls.filter(c=>c[0]==='sellback');const d=r6Daily();
  return {pend:[].concat(X.pending()||[]).length,bp:S.backpack.lantern,sl:S.sellable.lantern,coins:S.coins,sbCoins:d.sellbackCoins,reqs:sbc.map(c=>c[4]),srv:{credit:__M.credit.lantern,sb:__M.sb},btn:document.querySelector('[data-r9-sellback="screen"]')?.disabled};},);
 check('H3 auto-retry after 15 s replays the lantern with the same req, credited once',c.pend===0&&c.bp===2&&c.sl===2&&c.coins===a.c0+20&&c.sbCoins===20&&c.reqs.length===2&&c.reqs[0]===c.reqs[1]&&c.srv.credit===2&&c.srv.sb===380&&c.btn===false,c);
 const d=await ev(p,async()=>{const X=TG_R9.sell;const c0=S.coins;await X.sellBack('screen');return {gain:S.coins-c0,screen:S.backpack.screen,pend:[].concat(X.pending()||[]).length,sb:r6Daily().sellbackCoins};});
 check('H4 after the replay the screen sells normally',d.gain===40&&d.screen===0&&d.pend===0&&d.sb===60,d);
 await buy(['lantern','lantern']);
 const e=await ev(p,async()=>{const X=TG_R9.sell,K='templeGarden.r9.sellbackPending';const bp0=S.backpack.lantern,c0=S.coins;
  // two sells that reached the server but whose responses were lost (independent records, as an r9a client upgraded mid-flight could leave)
  const recs=[];for(const req of ['sell-h5a','sell-h5b']){__M.dropNext=1;await TG_ECON.sellback('lantern',1,20,req);recs.push({id:'lantern',qty:1,unit:20,req,at:Date.now()});}
  localStorage.setItem(K,JSON.stringify(recs));const n0=__calls.filter(c=>c[0]==='sellback').length;await X.retryPending();const n1=__calls.filter(c=>c[0]==='sellback').length;
  const r1={bp:S.backpack.lantern,gain:S.coins-c0,pend:[].concat(X.pending()||[]).length,calls:__calls.filter(c=>c[0]==='sellback').slice(n0).map(c=>c[4])};
  await X.retryPending();const n2=__calls.filter(c=>c[0]==='sellback').length;return {bp0,r1,again:n2-n1,gainAfter:S.coins-c0,srv:{sb:__M.sb}};});
 check('H5 list of pendings: each replayed independently with its own req, once; a second retry makes no call',e.r1.bp===e.bp0-2&&e.r1.gain===40&&e.r1.pend===0&&e.r1.calls.join()==='sell-h5a,sell-h5b'&&e.again===0&&e.gainAfter===40,e);
 const f=await ev(p,async()=>{const X=TG_R9.sell,K='templeGarden.r9.sellbackPending';const bp0=S.backpack.lantern,c0=S.coins;__M.dropNext=1;await TG_ECON.sellback('lantern',1,20,'sell-h6');
  localStorage.setItem(K,JSON.stringify({id:'lantern',qty:1,unit:20,req:'sell-h6',at:Date.now()}));const n=[].concat(X.pending()||[]).length;await X.retryPending();return {n,bp:S.backpack.lantern-bp0,gain:S.coins-c0,pend:[].concat(X.pending()||[]).length,raw:localStorage.getItem(K)};});
 check('H6 an r9a single-object pending record is read and replayed once',f.n===1&&f.bp===-1&&f.gain===20&&f.pend===0&&f.raw===null,f);
 const g=await ev(p,async()=>{const X=TG_R9.sell;const c0=S.coins,bp0=S.backpack.lantern;__M.dropNext=1;await X.sellBack('lantern');const p1=[].concat(X.pending()||[]).length;
  __M.sellbackReplies.push({ok:false,reason:'error'});await X.retryPending();const p2=[].concat(X.pending()||[]).length,mid=S.coins-c0;await X.retryPending();
  return {p1,p2,mid,gain:S.coins-c0,bp:bp0-S.backpack.lantern,pend:[].concat(X.pending()||[]).length};});
 check('H7 replay that errors again stays pending; next replay credits once',g.p1===1&&g.p2===1&&g.mid===0&&g.gain===20&&g.bp===1&&g.pend===0,g);
 check('H errors 0',errs.length===0,errs);await ctx.close();}
// ---------- I. r9b M2: first open of 卖作物/产物 right after an online buy ----------
{const {p,ctx,errs}=await page('r9');
 const a=await ev(p,async()=>{const X=TG_R9.sell;await X.probe();S.coins=3000;
  for(const id of ['screen','lantern']){const c=TG_CATALOG.find(x=>x.id===id);openShop(c.cat);document.querySelector(`[data-buy="${id}"]`).click();}
  openShop('sell');const row=id=>({txt:document.querySelector(`[data-r9-furn="${id}"] small`)?.textContent,dis:document.querySelector(`[data-r9-sellback="${id}"]`)?.disabled});
  const first={screen:row('screen'),lantern:row('lantern')};await new Promise(r=>setTimeout(r,2500));const later={screen:row('screen'),lantern:row('lantern')};
  return {first,later,credit:{...X.credit},srv:{...__M.credit}};});
 const okRow=r=>r&&r.dis===false&&/可卖 1/.test(r.txt||'')&&!/没有联网时买的/.test(r.txt||'');
 check('I1 first open right after an online buy: 可卖 1, button enabled, no 「没有联网时买的」',okRow(a.first.screen)&&okRow(a.first.lantern),a.first);
 check('I2 still correct 2.5 s later; cached credit = server credit',okRow(a.later.screen)&&okRow(a.later.lantern)&&a.credit.screen===a.srv.screen&&a.credit.lantern===a.srv.lantern,a);
 const b=await ev(p,async()=>{const X=TG_R9.sell;closeModal();__M.credit.lantern=0;openShop('sell');const t0=document.querySelector('[data-r9-sellback="lantern"]')?.disabled;await new Promise(r=>setTimeout(r,800));
  return {t0,t1:document.querySelector('[data-r9-sellback="lantern"]')?.disabled,txt:document.querySelector('[data-r9-furn="lantern"] small')?.textContent};});
 check('I3 server credit changed elsewhere → open tab re-renders after the probe',b.t0===false&&b.t1===true&&/可卖 0/.test(b.txt||''),b);
 const c=await ev(p,async()=>{const X=TG_R9.sell;closeModal();__M.buyReplies.push({ok:false,reason:'rate'});const cat=TG_CATALOG.find(x=>x.id==='bench').cat;openShop(cat);document.querySelector('[data-buy="bench"]').click();
  openShop('sell');const t0={dis:document.querySelector('[data-r9-sellback="bench"]')?.disabled,cr:X.credit.bench|0};await new Promise(r=>setTimeout(r,600));
  return {t0,t1:{dis:document.querySelector('[data-r9-sellback="bench"]')?.disabled,cr:X.credit.bench|0,txt:document.querySelector('[data-r9-furn="bench"] small')?.textContent}};});
 check('I4 refused shop log (rate) takes the optimistic credit back and re-renders',c.t0.dis===false&&c.t0.cr===1&&c.t1.dis===true&&c.t1.cr===0&&/没有联网时买的/.test(c.t1.txt||''),c);
 check('I errors 0',errs.length===0,errs);await ctx.close();}
// ---------- J. r9c L1: lock scoped to the account; clear reason offline; account switch ----------
const PK='templeGarden.r9.sellbackPending';
const buyIn=(p,ids)=>ev(p,async ids=>{S.coins=(S.coins|0)+2000;for(const id of ids){const c=TG_CATALOG.find(x=>x.id===id);openShop(c.cat);document.querySelector(`[data-buy="${id}"]`).click();}await new Promise(r=>setTimeout(r,400));await TG_R9.sell.probe();closeModal();},ids);
{const {p,ctx,errs}=await page('r9',null,{auth:'u1'});
 await buyIn(p,['lantern','lantern','screen']);
 const a=await ev(p,async()=>{const X=TG_R9.sell;__M.dropNext=1;await X.sellBack('lantern');const req=X.pending()[0]?.req;
  __M.off=true;TG_AUTH.online=false;await X.probe();openShop('sell');await new Promise(r=>setTimeout(r,300));const n0=__calls.filter(c=>c[0]==='sellback').length;
  const row=document.querySelector('[data-r9-furn="screen"] small')?.textContent,banner=document.querySelector('#r9SbPend')?.textContent,dis=document.querySelector('[data-r9-sellback="screen"]')?.disabled;
  await X.sellBack('screen');return {req,fb:X.fb,row,banner,dis,toast:__toasts.at(-1),calls:__calls.filter(c=>c[0]==='sellback').length-n0,keys:Object.keys(localStorage).filter(k=>k.startsWith('templeGarden.r9.sellbackPending'))};});
 check('J1 offline with a pending sale: per-account key, buy-back locked with a clear offline reason, no server call',a.req&&a.fb==='local'&&/没有联网/.test(a.row||'')&&/没有联网/.test(a.banner||'')&&a.dis===true&&/没有联网/.test(a.toast)&&a.calls===0&&a.keys.join()==='templeGarden.r9.sellbackPending.u1',a);
 const b=await ev(p,async()=>{const X=TG_R9.sell;__M.off=false;TG_AUTH.online=true;TG_AUTH._set('u2');await new Promise(r=>setTimeout(r,500));await X.probe();openShop('sell');await new Promise(r=>setTimeout(r,300));
  const pend=X.pending().length,dis=document.querySelector('[data-r9-sellback="screen"]')?.disabled,row=document.querySelector('[data-r9-furn="screen"] small')?.textContent;
  const c0=S.coins;await X.sellBack('screen');const last=__calls.filter(c=>c[0]==='sellback').at(-1);return {pend,dis,row,gain:S.coins-c0,who:last?.[6],item:last?.[1]};});
 check('J2 after switching to another account its buy-back is not locked by the first account\'s record',b.pend===0&&b.dis===false&&!/确认/.test(b.row||'')&&b.gain===40&&b.who==='u2'&&b.item==='screen',b);
 await p.waitForTimeout(16500);
 const c=await ev(p,(req)=>{const reps=__calls.filter(c=>c[0]==='sellback'&&c[4]===req);return {reps:reps.length,byU2:reps.filter(c=>c[6]==='u2').length,u1:JSON.parse(localStorage.getItem('templeGarden.r9.sellbackPending.u1')||'[]').length};},a.req);
 check('J3 the other account\'s record is never replayed under u2 (still stored for u1 after the 15 s window)',c.reps===1&&c.byU2===0&&c.u1===1,c);
 const d=await ev(p,async(req)=>{const X=TG_R9.sell;const c0=S.coins;TG_AUTH._set('u1');for(let i=0;i<30&&X.pending().length;i++)await new Promise(r=>setTimeout(r,200));
  const reps=__calls.filter(c=>c[0]==='sellback'&&c[4]===req);return {gain:S.coins-c0,reps:reps.length,last:reps.at(-1)?.[6],pend:X.pending().length};},a.req);
 check('J4 back on u1: its record replays once with the same req and is credited',d.gain===20&&d.reps===2&&d.last==='u1'&&d.pend===0,d);
 const e=await ev(p,async()=>{const X=TG_R9.sell;TG_AUTH._set(null);await new Promise(r=>setTimeout(r,300));openShop('sell');const n=X.pending().length;return {n,acct:X.acct()};});
 check('J5 signed out: no account → no pending shown, nothing replayed',e.n===0&&e.acct===null,e);
 check('J errors 0',errs.length===0,errs);await ctx.close();}
// ---------- K. r9c L2: confirmed sale whose item left the backpack ----------
{const {p,ctx,errs}=await page('r9',null,{auth:'k1'});
 await buyIn(p,['lantern','screen']);
 const a=await ev(p,async()=>{const X=TG_R9.sell;__M.dropNext=1;await X.sellBack('lantern');const pend=X.pending().length;
  const place=r3PlacementError('yard',{id:'lantern',x:0,z:0,rot:0},-1);const take=TG_INV_TAKE('decor','lantern',1);const bp=S.backpack.lantern;
  const place6=window.r6PlacementError?r6PlacementError('yard',{id:'lantern',x:0,y:0,z:0,rot:0},-1):'n/a';const other=r3PlacementError('yard',{id:'screen',x:0,z:0,rot:0},-1);
  return {pend,place,place6,take,bp,other};});
 check('K1 a unit being sold back cannot be placed or listed (r3/r6 placement, TG_INV_TAKE); other items unaffected',a.pend===1&&/卖回商铺确认中/.test(a.place||'')&&/卖回商铺确认中/.test(a.place6||'')&&a.take===false&&a.bp===1&&!/卖回商铺确认中/.test(a.other||''),a);
 const b=await ev(p,async()=>{const X=TG_R9.sell,d=r6Daily();S.backpack.lantern=0;const c0=S.coins,sb0=d.sellbackCoins|0,sl0=S.sellable.lantern|0;await X.retryPending();
  const r1={gain:S.coins-c0,sb:(d.sellbackCoins|0)-sb0,sl:sl0-(S.sellable.lantern|0),pend:X.pending().length,toast:__toasts.find(t=>/补给你/.test(t))};
  await X.retryPending();return {r1,gain2:S.coins-c0,applied:(S.sellApplied||[]).length};});
 check('K2 server confirmed but the item left the backpack → coins + quota still credited (server is authoritative), toast explains',b.r1.gain===20&&b.r1.sb===20&&b.r1.sl===1&&b.r1.pend===0&&!!b.r1.toast,b);
 check('K3 never double-credited (a second retry adds nothing; req recorded in the save)',b.gain2===20&&b.applied>=1,b);
 check('K errors 0',errs.length===0,errs);await ctx.close();}
// ---------- L. r9c L3: per-account key + cross-tab replays credit once ----------
for(const noLocks of [false,true]){const tag=noLocks?' (localStorage lease, no Web Locks)':' (Web Locks)';
 const A=await page('r9',null,{auth:'t1',noLocks});
 await buyIn(A.p,['lantern','lantern']);
 const a=await ev(A.p,async()=>{const X=TG_R9.sell;__M.dropNext=1;await X.sellBack('lantern');const p=X.pending()[0];localStorage.setItem('__hold','1');return {p,legacy:localStorage.getItem('templeGarden.r9.sellbackPending'),own:localStorage.getItem('templeGarden.r9.sellbackPending.t1'),locks:!!navigator.locks};});
 if(!noLocks)check('L1 pending stored per account (…Pending.t1), no shared key',a.p&&a.legacy===null&&a.own&&JSON.parse(a.own)[0].acct==='t1',a);
 const B=await page('r9',null,{auth:'t1',noLocks,ctx:A.ctx});
 const ready=await ev(B.p,async(a)=>{S.backpack.lantern=Math.max(S.backpack.lantern|0,2);S.sellable.lantern=Math.max(S.sellable.lantern|0,2);return {pend:TG_R9.sell.pending().length,locks:!!navigator.locks};},a);
 const go=pg=>ev(pg,async()=>{const c0=S.coins;await TG_R9.sell.retryPending();return S.coins-c0;});
 const rel=(async()=>{await new Promise(r=>setTimeout(r,1500));await ev(A.p,()=>localStorage.setItem('__hold','0'));})();
 const [ga,gb]=await Promise.all([go(A.p),go(B.p),rel]);
 const after=await ev(A.p,()=>({pend:TG_R9.sell.pending().length,applied:JSON.parse(localStorage.getItem('templeGarden.r9.sellbackApplied.t1')||'[]').map(x=>x.req)}));
 check('L2 two tabs replay the same pending record at once → credited exactly once'+tag,ready.pend===1&&ready.locks===!noLocks&&ga+gb===20&&after.pend===0&&after.applied.includes(a.p.req),{ga,gb,ready,after});
 const again=await Promise.all([go(A.p),go(B.p)]);
 check('L3 later replays in either tab add nothing'+tag,again[0]+again[1]===0,again);
 if(!noLocks){const x=await ev(B.p,async()=>{const X=TG_R9.sell,K='templeGarden.r9.sellbackPending.t1';const rec={id:'lantern',qty:1,unit:20,req:'sell-l4',at:Date.now(),acct:'t1'};
   localStorage.setItem('templeGarden.r9.sellbackApplied.t1',JSON.stringify([{req:'sell-l4',at:Date.now()}]));localStorage.setItem(K,JSON.stringify([rec]));const n0=__calls.filter(c=>c[0]==='sellback').length,c0=S.coins;
   await X.retryPending();return {calls:__calls.filter(c=>c[0]==='sellback').length-n0,gain:S.coins-c0,pend:X.pending().length};});
  check('L4 a req already credited by another tab is dropped without a server call or coins',x.calls===0&&x.gain===0&&x.pend===0,x);}
 {const cl=pg=>ev(pg,async()=>{const out=[];await Promise.all(Array.from({length:20},(_,i)=>TG_R9.sell.claim('race-'+i,'t1').then(r=>out[i]=r)));return out;});
  const [ca,cb]=await Promise.all([cl(A.p),cl(B.p)]);const per=ca.map((x,i)=>[x,cb[i]].filter(v=>v==='yes').length);
  check('L5 IndexedDB claim is atomic across tabs: 20 simultaneous claims per req from 2 tabs → exactly one winner each'+tag,per.every(n=>n===1),{ca,cb});}
 check('L errors 0'+tag,A.errs.length===0&&B.errs.length===0,[...A.errs,...B.errs]);await A.ctx.close();}
}finally{fs.writeFileSync(OUT+'/selltest.json',JSON.stringify({build:BUILD,fails,results},null,1));await br.close();srv.close();console.log('fails',fails,'of',results.length);}
