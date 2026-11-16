/* r9 part 1 — 卖作物/产物 + 回收家具 front end.
 * r9f hotfix: crops/produce have NO daily coin ceiling once the server says sell_uncapped.
 *   That is the absence of a cap, not a larger number. Owned quantity still has to be a safe integer,
 *   and the coin total has to stay inside Number.MAX_SAFE_INTEGER.
 *   A positive numeric sell_left (legacy r9, usually 100) is honoured only until this page has seen
 *   sell_uncapped:true. After that, offline / error / a stale status that still carries sell_left
 *   does NOT put the old 100 back. An already-open page DOES revoke unlimited when the status
 *   says sell_uncapped:false (the rollback flag) with a newer sell_epoch. No reload is required.
 *   An earn reply carries the epoch it was decided under. A reply whose epoch is older than the
 *   epoch already applied, or a reply with no epoch after one has been applied, cannot change mode.
 *   In server mode a crop sale reserves inventory and adds coins only when that request is confirmed.
 *   While uncapped, a status may also carry sell_cap/sell_left 100. Those numbers are the legacy
 *   advertisement already-open r9b/r9c pages need so they do not fall onto the shared 40.
 *   This page ignores them. Pre-r9 servers, and offline before any uncapped confirmation, keep
 *   the shared 40 with 今日事项 / 善缘兑换.
 * - Furniture buy-back at floor(price/2) for the 11 shop items, only shop-bought units (S.sellable) that are stowed in the
 *   backpack; confirm dialog; never while visiting; separate cap 400/day; server credit when the r9 RPCs exist, hidden when the
 *   server lacks them, local rules when there is no server connection. Request-id idempotence is unchanged.
 * - Legacy saves (no sellSeeded flag): one-time seed, flush first, retry on no_save / stale_save.
 * - Entries: backpack button, 花木铺 prompt, hint after harvest.
 * The fortune stalls are NOT here. window.TG_R9 is the shared namespace. Save key stays templeGarden.v1. */
(()=>{
const R=window.TG_R9=Object.assign(window.TG_R9||{},{sell:{version:'r9f',mode:'?',cap:null,uncapped:false,confirmedUncapped:false,serverLeft:null,epoch:null,fb:'?',credit:null,prices:null,sbLeft:null,seed:null,log:[]}});
const X=R.sell;
const BUYBACK=['wood-table','bench','cabinet','daybed','altar-table','rocking-chair','vase','lantern','bonsai','screen','cushion'];
const STARTER={cushion:1,vase:1},SHARED_CAP=40,SB_CAP=400,SEED_BUDGET=1000,SEED_PER=10;
// SELL_CAP is not a live ceiling. It exists only so a test can see the retired number is not substituted.
const PEND_KEY='templeGarden.r9.sellbackPending';
const RETIRED_SELL_CAP=100; // documentation only — never used as a fallback
X.RETIRED_SELL_CAP=RETIRED_SELL_CAP;
X.BUYBACK=BUYBACK;
function positiveInt(v){const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;}
function reduceSellStatus(prev,st){
 const p=prev&&typeof prev==='object'?prev:{mode:'?',cap:null,confirmedUncapped:false};
 const confirmed=!!p.confirmedUncapped;
 const keep=()=>({mode:'uncapped',cap:null,confirmedUncapped:true,serverLeft:null,shared:false,uncapped:true,kind:'keep-uncapped'});
 const capped=(status,kind)=>{const left=Math.max(0,Math.floor(Number(status.sell_left)));
  return {mode:'r9',cap:positiveInt(status.sell_cap),confirmedUncapped:false,serverLeft:left,shared:false,uncapped:false,kind};};
 if(!st||typeof st!=='object'){
  if(confirmed)return keep();
  if(p.mode==='r9')return {mode:'r9',cap:positiveInt(p.cap),confirmedUncapped:false,serverLeft:typeof p.serverLeft==='number'?p.serverLeft:null,shared:false,uncapped:false,kind:'keep-capped'};
  if(p.mode==='offline'||p.mode==='local'||p.mode==='old-server'||p.mode==='old-client'||p.mode==='unknown')return {mode:p.mode,cap:null,confirmedUncapped:false,serverLeft:null,shared:true,uncapped:false,kind:'keep-shared'};
  return {mode:'unknown',cap:null,confirmedUncapped:false,serverLeft:null,shared:true,uncapped:false,kind:'ambiguous'};}
 if(st.sell_uncapped===true)return {mode:'uncapped',cap:null,confirmedUncapped:true,serverLeft:null,shared:false,uncapped:true,kind:'uncapped'};
 if(st.reason==='offline'||st.reason==='error'){if(confirmed)return keep();return {mode:'offline',cap:null,confirmedUncapped:false,serverLeft:null,shared:true,uncapped:false,kind:'offline'};}
 // Explicit rollback. Revokes unlimited on an already-open page. A missing sell_left fails closed (left 0) rather than staying uncapped.
 if(st.sell_uncapped===false){const hasLeft=typeof st.sell_left==='number'&&Number.isFinite(st.sell_left);
  return {mode:'r9',cap:positiveInt(st.sell_cap),confirmedUncapped:false,serverLeft:hasLeft?Math.max(0,Math.floor(st.sell_left)):0,shared:false,uncapped:false,kind:'explicit-cap'};}
 if(typeof st.sell_left==='number'&&Number.isFinite(st.sell_left)){if(confirmed)return keep();return capped(st,'capped');}
 if(st.day){if(confirmed)return keep();return {mode:'old-server',cap:null,confirmedUncapped:false,serverLeft:null,shared:true,uncapped:false,kind:'old-server'};}
 if(confirmed)return keep();
 if(p.mode==='r9')return {mode:'r9',cap:positiveInt(p.cap),confirmedUncapped:false,serverLeft:typeof p.serverLeft==='number'?p.serverLeft:null,shared:false,uncapped:false,kind:'keep-capped'};
 return {mode:'unknown',cap:null,confirmedUncapped:false,serverLeft:null,shared:true,uncapped:false,kind:'ambiguous'};}
function applyPolicy(next){X.mode=next.mode;X.cap=next.cap;X.confirmedUncapped=!!next.confirmedUncapped;X.uncapped=!!next.uncapped;X.shared=!!next.shared;
 if(next.kind==='capped'||next.kind==='explicit-cap'){let used=0,day=null;try{const d=r6Daily();used=d.sellCoins|0;day=d.date||null;}catch(e){}
  const prev=day!==X.serverDay||typeof X.serverLeft!=='number'?null:X.serverLeft-Math.max(0,used-(X.serverUsedAt|0));
  if(prev==null||next.serverLeft<=prev){X.serverLeft=next.serverLeft;X.serverUsedAt=used;X.serverDay=day;}}
 else if(next.uncapped){X.serverLeft=null;X.serverUsedAt=0;}
 else if(next.kind!=='keep-capped'){X.serverLeft=null;X.serverUsedAt=0;}
 try{window.TG_ECON?.adoptSell?.(policy());}catch(e){}
 return policy();}
function policy(){return {mode:X.mode,cap:X.cap,uncapped:X.mode==='uncapped'&&!!X.confirmedUncapped,confirmedUncapped:!!X.confirmedUncapped,serverLeft:X.serverLeft,epoch:X.epoch??null,shared:X.mode!=='r9'&&X.mode!=='uncapped'};}
function noteSellStatus(st){
 // A payload can move the crop policy only when it is at least as new as the epoch already applied
 // for this account. Missing epoch after one has been applied is stale, not a fresh unlimited grant.
 if(st&&typeof st==='object'&&typeof X.epoch==='number'){
  if(typeof st.sell_epoch!=='number'||!Number.isSafeInteger(st.sell_epoch)||st.sell_epoch<X.epoch)return policy();}
 if(st&&typeof st.sell_epoch==='number'&&Number.isSafeInteger(st.sell_epoch)&&(X.epoch==null||st.sell_epoch>=X.epoch)){
  X.epoch=st.sell_epoch;
  try{const a=(typeof acct==='function'?acct():null);if(a)localStorage.setItem('templeGarden.r9.sellEpoch.'+a,String(X.epoch));}catch(e){}}
 return applyPolicy(reduceSellStatus(policy(),st));}
X.reduceSellStatus=reduceSellStatus;X.noteSellStatus=noteSellStatus;X.policy=policy;
function readStock(id){const raw=S.inventory?S.inventory[id]:undefined;
 if(typeof raw!=='number'||!Number.isFinite(raw)||!Number.isSafeInteger(raw)||raw<0)return {ok:false,reason:'bad_qty'};
 return {ok:true,qty:raw};}
function coinsNow(){if(S.coins==null)return 0;if(typeof S.coins!=='number'||!Number.isSafeInteger(S.coins)||S.coins<0)return null;return S.coins;}
function cropSalePlan(o){const stock=o.stock,price=o.price,qty=o.qty,coins=o.coins,pol=o.policy||{};
 if(typeof stock!=='number'||!Number.isSafeInteger(stock)||stock<0)return {ok:false,reason:'bad_qty',n:0,gain:0};
 if(stock===0)return {ok:false,reason:'empty',n:0,gain:0};
 if(typeof qty!=='number'||!Number.isSafeInteger(qty)||qty<=0)return {ok:false,reason:'bad_qty',n:0,gain:0};
 if(qty>stock)return {ok:false,reason:'excess',n:0,gain:0};
 if(typeof price!=='number'||!Number.isSafeInteger(price)||price<0)return {ok:false,reason:'bad_price',n:0,gain:0};
 if(typeof coins!=='number'||!Number.isSafeInteger(coins)||coins<0)return {ok:false,reason:'bad_coins',n:0,gain:0};
 let n=qty;
 if(!pol.uncapped){const left=pol.left;if(typeof left!=='number'||!Number.isSafeInteger(left)||left<0)return {ok:false,reason:'no_room',n:0,gain:0};
  if(price>0){const fit=Math.floor(left/price);if(fit<=0)return {ok:false,reason:'daily_cap',n:0,gain:0};if(fit<n)n=fit;}}
 const gain=n*price;if(!Number.isSafeInteger(gain)||!Number.isSafeInteger(coins+gain))return {ok:false,reason:'unsafe_arith',n:0,gain:0};
 return {ok:true,n,gain,partial:n<qty,reason:n<qty?'partial_cap':'ok'};}
X.readStock=readStock;X.cropSalePlan=cropSalePlan;
const log=(...a)=>{X.log.push(a.join(' '));if(X.log.length>60)X.log.shift();};
const item=id=>window.TG_CATALOG.find(c=>c.id===id);
const isBB=id=>BUYBACK.includes(id);
const unitOf=id=>X.prices&&Number.isFinite(X.prices[id])?X.prices[id]:Math.floor((item(id)?.price|0)/2);
const econ=()=>window.TG_ECON||null;
const hasApi=()=>{const e=econ();return !!(e&&typeof e.left==='function'&&typeof e.sellback==='function'&&typeof e.sellbackCredit==='function');};
const placedOf=(d,id)=>{let n=0;for(const a of Object.values(d.decor||{}))if(Array.isArray(a))for(const e of a)if(e&&e.id===id)n++;return n;};
const ownedOf=(d,id)=>(Number(d.backpack?.[id])|0)+placedOf(d,id);
const visiting=()=>{try{return r3IsVisiting();}catch(e){return false;}};

/* ---------- save model: S.sellable sanitize + clamp ---------- */
function sanitizeSellable(d){
 const o=d.sellable&&typeof d.sellable==='object'&&!Array.isArray(d.sellable)?d.sellable:{};const out={};
 for(const id of BUYBACK){const v=Math.floor(Number(o[id]));if(Number.isSafeInteger(v)&&v>0)out[id]=Math.min(v,ownedOf(d,id));}   // placed units keep their credit (they come back on 收起)
 d.sellable=out;if(d.sellSeeded!==true&&d.sellSeeded!=='local')delete d.sellSeeded;
 // r9c (L3): request ids this save has already been credited for (kept with the save, last 64)
 if(Array.isArray(d.sellApplied))d.sellApplied=d.sellApplied.filter(x=>typeof x==='string'&&x.length<=64).slice(-64);else delete d.sellApplied;
 if(Array.isArray(d.cropApplied))d.cropApplied=d.cropApplied.filter(x=>typeof x==='string'&&x.length<=64).slice(-64);else delete d.cropApplied;
 if(Array.isArray(d.cropPending))d.cropPending=d.cropPending.filter(cropRecOk).slice(-16);else delete d.cropPending;}
X.sanitize=sanitizeSellable;
const san=sanitizeR4;sanitizeR4=function(d){const out=san.apply(this,arguments);try{sanitizeSellable(d);}catch(e){}return out;};
try{sanitizeSellable(S);}catch(e){}
window.r9OnShopBuy=function(id){   // r3.js coin purchase, after the local debit; offerings and merit items never get credit
 if(!isBB(id))return;S.sellable??={};S.sellable[id]=(S.sellable[id]|0)+1;
 // r9b (M2): the cached server credit follows the purchase at once (optimistic +1) and a probe that lands while the log is in
 // flight keeps that +1 (X.inflight); the server's reply then sets the exact count (ok) or takes the +1 back (rate/offline/error).
 const opt=X.fb==='server'&&X.credit&&typeof X.credit==='object';if(opt){X.credit[id]=(X.credit[id]|0)+1;X.inflight[id]=(X.inflight[id]|0)+1;}
 const done=r=>{if(opt)X.inflight[id]=Math.max(0,(X.inflight[id]|0)-1);if(X.credit){
   if(r&&r.ok&&Number.isFinite(Number(r.credit)))X.credit[id]=Math.max(0,Number(r.credit)|0)+(X.inflight[id]|0);
   else if(opt)X.credit[id]=Math.max(0,(X.credit[id]|0)-1);}
  if($('#sheet [data-r9-sell-tab]'))renderSell();};
 let p=null;try{p=econ()?.shopBuy?.(id,1);}catch(e){}
 if(p?.then)p.then(r=>{log('shopBuy',id,JSON.stringify(r));done(r);},()=>done(null));else if(opt)done(null);};
X.inflight={};
const take=window.TG_INV_TAKE;if(take)window.TG_INV_TAKE=function(k,id,q){
 if(isBB(id)&&(S.backpack?.[id]|0)-reserved(id)<Math.max(1,q|0)){toast('这件正在卖回商铺确认中，确认前先不能挂出或送出');return false;}   // r9c (L2)
 const ok=take.apply(this,arguments);if(ok&&isBB(id)&&S.sellable)S.sellable[id]=Math.min(S.sellable[id]|0,S.backpack[id]|0);return ok;};
// TG_INV_GIVE (market claim / refund), merit, family stow and the starter grant never touch S.sellable.

/* ---------- server mode ---------- */
const withInflight=c=>{const o={...c};for(const [k,v] of Object.entries(X.inflight))if(v>0)o[k]=(Number(o[k])|0)+v;return o;};
let probing=null;
X.probe=function(){if(probing)return probing;probing=(async()=>{
 const e=econ();
 if(!e){if(!X.confirmedUncapped){noteSellStatus({reason:'offline'});X.mode='local';X.fb='local';}return X;}
 if(!hasApi()){if(!X.confirmedUncapped){X.mode='old-client';X.cap=null;}X.fb='hidden';return X;}
 const a0=acct();
 let st=null;try{st=await e.status();}catch(x){st=null;}
 if(a0&&acct()!==a0)return X;
 noteSellStatus(st);
 let c=null;try{c=await e.sellbackCredit();}catch(x){}
 if(c&&c.credit&&typeof c.credit==='object'){X.fb='server';X.credit=withInflight(c.credit);X.prices=c.prices&&typeof c.prices==='object'?c.prices:null;X.sbLeft=typeof c.left==='number'?c.left:null;X.seededServer=!!c.seeded;}
 else if(c&&c.reason==='old_schema'){X.fb='hidden';X.credit=null;}
 else if(c&&c.reason==='offline'){X.fb='local';X.credit=null;}
 else if(X.fb!=='server'){X.fb='unknown';}
 return X;})().finally(()=>{probing=null;});return probing;};

/* ---------- crop / produce sale (no numeric ceiling once the server is uncapped) ---------- */
function sellCap(){const d=r6Daily(),e=econ(),pol=policy();
 if(pol.uncapped)return {cap:null,left:null,used:d.sellCoins|0,shared:false,uncapped:true};
 if(X.mode==='r9'){const used=d.sellCoins|0,cap=positiveInt(X.cap),local=cap==null?null:Math.max(0,cap-used);
  let L=null;try{const v=e?.left?.('sell');if(typeof v==='number'&&Number.isFinite(v))L=Math.max(0,Math.floor(v));}catch(err){}
  if(L==null&&cap==null&&typeof X.serverLeft==='number')L=Math.max(0,X.serverLeft-Math.max(0,used-(X.serverUsedAt|0)));
  let left;if(local==null&&L==null)left=0;else if(local==null)left=L;else if(L==null)left=local;else left=Math.max(0,Math.min(L,local));
  const shown=cap==null?(Number.isSafeInteger(used+left)?used+left:null):cap;
  return {cap:shown,left,used:shown==null?used:shown-left,shared:false,uncapped:false};}
 const local=Math.max(0,SHARED_CAP-(d.coinsEarned|0));let L=null;try{const v=typeof e?.left==='function'?e.left('sell'):null;if(typeof v==='number'&&Number.isFinite(v))L=Math.max(0,Math.floor(v));}catch(err){}
 const left=L==null?local:Math.max(0,Math.min(L,local));return {cap:SHARED_CAP,left,used:SHARED_CAP-left,shared:true,uncapped:false};}
X.sellCap=sellCap;
const earnNet=window.r6EarnCoins;   // kept for reference; the r9 version below replaces both r6 and r6-net paths
window.r6EarnCoins=function(n,source,exact){
 if(!r3CanEdit()||!Number.isSafeInteger(n)||n<0)return false;
 source=source||'task';const d=r6Daily(),sell=source==='sell',e=econ();
 if(sell){const ci=sellCap();if(!ci.uncapped&&n>ci.left){toast(`今日卖作物已满 ${ci.cap} 铜钱，明天再来卖`);return false;}}
 else if((d.coinsEarned|0)+n>SHARED_CAP){toast('今日铜钱已达上限');return false;}
 let got=n;
 if(e?.earn){got=Number(e.earn(n,source,!!exact))||0;if(got<=0||((!!exact||(sell&&sellCap().uncapped))&&got!==n)){toast(sell?(sellCap().uncapped?'出售没有完成，铜钱没有加上':`今日卖作物已满 ${sellCap().cap} 铜钱，明天再来卖`):'今日铜钱已达上限');return false;}}
 if(sell){d.sellCoins=(d.sellCoins|0)+got;if(!policy().uncapped&&X.mode!=='r9')d.coinsEarned=(d.coinsEarned|0)+got;}
 else d.coinsEarned=(d.coinsEarned|0)+got;
 const next=(S.coins||0)+got;if(!Number.isSafeInteger(next)){if(sell){d.sellCoins=(d.sellCoins|0)-got;if(!policy().uncapped&&X.mode!=='r9')d.coinsEarned=(d.coinsEarned|0)-got;}else d.coinsEarned=(d.coinsEarned|0)-got;toast('铜钱太多，先花掉一些再卖');return false;}
 S.coins=next;save();renderTop();return true;};
X.earnNet=earnNet;
// item 2: the merit exchange reports 'merit' (server 8/day sub-cap), and gives the 25 善缘 back if the coin is refused
window.r5MeritCoins=function(){if(r3DenyVisit())return false;const d=r6Daily();if(d.meritCoins>=8||d.coinsEarned>=SHARED_CAP)return toast('今日兑换已达上限'),false;if(S.merit<25)return toast('需要 25 善缘'),false;
 S.merit-=25;d.meritCoins++;if(r6EarnCoins(1,'merit'))return true;S.merit+=25;d.meritCoins--;save();renderTop();return false;};
// item 1: partial 「全卖」
function saleToast(reason,ci){if(reason==='empty')return toast('背包里没有这份');if(reason==='excess')return toast('不能卖得比拥有的多');if(reason==='bad_qty'||reason==='bad_price')return toast('背包里的数量不对，不能卖');if(reason==='bad_coins'||reason==='unsafe_arith')return toast('数量太大，算不过来，这次没有卖');if(reason==='daily_cap'||reason==='no_room')return toast(`今日卖作物已满 ${ci&&ci.cap!=null?ci.cap:''} 铜钱，明天再来卖`);return toast('这次没有卖成');}
function sellQty(id,qty){
 if(r3DenyVisit())return false;const c=CROP_BY_ID[id]||r3ProduceItem?.(id);if(!c)return false;
 const price=c.sell??((c.value||1)*8),ci=sellCap(),coins=coinsNow();
 if(coins==null){saleToast('bad_coins',ci);return false;}
 const stock=readStock(id);if(!stock.ok){saleToast(stock.reason,ci);return openShop('sell'),false;}
 const plan=cropSalePlan({stock:stock.qty,price,qty,coins,policy:ci});
 if(!plan.ok){saleToast(plan.reason,ci);return openShop('sell'),false;}
 const again=readStock(id);if(!again.ok||again.qty<plan.n){saleToast('bad_qty',ci);return openShop('sell'),false;}
 // Server-confirmed settlement only after this account has applied a sell_epoch. Without one, the
 // server is still the old 3-argument econ_earn and the synchronous earn() path stays (the original tests).
 if(typeof X.epoch==='number'&&typeof econ()?.confirmSell==='function'&&(ci.uncapped||X.mode==='r9'))return settleCrop(id,c,plan);
 if(!r6EarnCoins(plan.gain,'sell',true))return openShop('sell'),false;
 const live=readStock(id);
 if(!live.ok||live.qty<plan.n){const d=r6Daily();S.coins=Math.max(0,(S.coins||0)-plan.gain);d.sellCoins=Math.max(0,(d.sellCoins|0)-plan.gain);if(!policy().uncapped&&X.mode!=='r9')d.coinsEarned=Math.max(0,(d.coinsEarned|0)-plan.gain);save();renderTop();toast('背包里的数量变了，这笔出售已取消');return openShop('sell'),false;}
 S.inventory[id]=live.qty-plan.n;if(!S.inventory[id])delete S.inventory[id];save();
 const after=sellCap();
 toast(plan.partial?`已卖出 ${c.name}×${plan.n}，得 ${plan.gain} 铜钱；今日卖作物已满 ${after.cap}，剩下 ${qty-plan.n} 份明天再卖`:(after.uncapped?`已卖出 ${c.name}×${plan.n}，得 ${plan.gain} 铜钱`:`已卖出 ${c.name}×${plan.n}，得 ${plan.gain} 铜钱 · 今日出售 ${after.used}/${after.cap}`));
 openShop('sell');return true;}
function sellCrop(id,all){const stock=readStock(id);const qty=all===true?(stock.ok?stock.qty:0):1;return sellQty(id,qty);}
X.sellQty=sellQty;X.sellCrop=sellCrop;

/* ---------- furniture buy-back ---------- */
// r9b (M1): every unconfirmed sell-back is its own record keyed by its request id, replayed independently with the same req
// (the server is idempotent per req). An r9a single-object record is read as a one-item list.
// r9c (L1/L3): records live under a per-account key (templeGarden.r9.sellbackPending.<userId>) and carry their account, so another
// account's records never lock this account's buy-back and are never replayed by it. The r9a/r9b shared key is adopted once by
// the first signed-in account that opens this build (the account that wrote it in practice) and then removed.
const okP=p=>p&&typeof p==='object'&&isBB(p.id)&&typeof p.req==='string'&&p.req;
const acct=()=>{try{const A=window.TG_AUTH;if(!A)return 'default';const u=A.userId;return u?String(u):null;}catch(e){return null;}};   // no auth module at all → one local slot; signed out → none
function loadEpoch(){const a=acct();if(!a){X.epoch=null;return;}try{const raw=localStorage.getItem('templeGarden.r9.sellEpoch.'+a);if(raw==null||raw===''){X.epoch=null;return;}const n=Number(raw);X.epoch=Number.isSafeInteger(n)&&n>=1?n:null;}catch(e){X.epoch=null;}}
function cropRecOk(x){return !!(x&&typeof x==='object'&&typeof x.req==='string'&&x.req.length>=8&&x.req.length<=64&&typeof x.id==='string'&&Number.isSafeInteger(x.n)&&x.n>0&&Number.isSafeInteger(x.gain)&&x.gain>0&&Number.isSafeInteger(x.price)&&x.price>0&&typeof x.acct==='string');}
const CROP_KEY=a=>'templeGarden.r9.cropPending.'+a;
function readCrops(a){try{const v=JSON.parse(localStorage.getItem(CROP_KEY(a))||'[]');return Array.isArray(v)?v.filter(cropRecOk):[];}catch(e){return [];}}
function writeCrops(a,l){try{l&&l.length?localStorage.setItem(CROP_KEY(a),JSON.stringify(l)):localStorage.removeItem(CROP_KEY(a));}catch(e){}}
function cropApplied(req){return Array.isArray(S.cropApplied)&&S.cropApplied.includes(req);}
function markCrop(req){S.cropApplied=[...(S.cropApplied||[]).filter(x=>x!==req),req].slice(-64);}
function syncCropKey(a){writeCrops(a,(Array.isArray(S.cropPending)?S.cropPending:[]).filter(x=>x&&x.acct===a));}
function rememberCrop(rec){S.cropPending=[...(Array.isArray(S.cropPending)?S.cropPending:[]).filter(x=>x.req!==rec.req),rec].slice(-16);save();syncCropKey(rec.acct);}
function forgetCrop(a,req){S.cropPending=(Array.isArray(S.cropPending)?S.cropPending:[]).filter(x=>x.req!==req);if(!S.cropPending.length)delete S.cropPending;save();syncCropKey(a);}
function readPending(a){const fromS=(Array.isArray(S.cropPending)?S.cropPending:[]).filter(x=>x&&x.acct===a&&cropRecOk(x));const map=new Map(readCrops(a).map(x=>[x.req,x]));for(const x of fromS)map.set(x.req,x);return [...map.values()];}
let cropTimer=0;
function scheduleCrop(){if(cropTimer)return;cropTimer=setTimeout(()=>{cropTimer=0;retryCrops();},5000);}
async function applyCropResult(rec,r){
 if(!rec||!rec.acct)return false;
 if(acct()!==rec.acct)return false;   // another account is on screen; the reservation stays for the account that started it
 if(!r||r.reason==='error'||r.reason==='offline'){scheduleCrop();return false;}
 if(r.sell_uncapped===true||r.sell_uncapped===false||typeof r.sell_epoch==='number')noteSellStatus(r);
 if(cropApplied(rec.req)){forgetCrop(rec.acct,rec.req);return true;}   // coins were already saved with this request id; do not pay or restore again
 if(r.ok&&(r.granted|0)>0){
  const g=r.granted|0,next=(S.coins||0)+g;
  if(!Number.isSafeInteger(next)){scheduleCrop();saleToast('unsafe_arith');return false;}   // leave the reservation; do not put the items back while the server grant is still outstanding
  const d=r6Daily();S.coins=next;d.sellCoins=(d.sellCoins|0)+g;if(!policy().uncapped&&X.mode!=='r9')d.coinsEarned=(d.coinsEarned|0)+g;markCrop(rec.req);
  const paid=rec.price>0?Math.floor(g/rec.price):rec.n,back=Math.max(0,rec.n-paid);
  if(back>0)S.inventory[rec.id]=(S.inventory[rec.id]|0)+back;
  forgetCrop(rec.acct,rec.req);renderTop();toast(`已卖出 ${rec.name}×${paid}，得 ${g} 铜钱`);return true;}
 S.inventory[rec.id]=(S.inventory[rec.id]|0)+rec.n;forgetCrop(rec.acct,rec.req);renderTop();
 saleToast(r.reason==='daily_cap'?'daily_cap':'bad_qty',sellCap());return false;}
async function settleCrop(id,c,plan){
 const a=acct();if(!a){saleToast('bad_qty');return false;}
 const price=plan.n>0?plan.gain/plan.n:0;if(!Number.isSafeInteger(price)||price<=0){saleToast('bad_price');return false;}
 const req='crop-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
 const live=readStock(id);if(!live.ok||live.qty<plan.n){saleToast('bad_qty');return false;}
 const rec={id,n:plan.n,gain:plan.gain,price,req,acct:a,epoch:X.epoch||0,name:c.name,at:Date.now()};
 S.inventory[id]=live.qty-plan.n;if(!S.inventory[id])delete S.inventory[id];
 rememberCrop(rec);   // inventory deduction and the request id are one save, before the server is asked
 let r;try{r=await econ().confirmSell(rec);}catch(e){r={ok:false,reason:'error'};}
 const ok=await applyCropResult(rec,r);if($('#sheet [data-r9-sell-tab]'))openShop('sell');return ok;}
let cropRetrying=null;
async function retryCrops(){
 if(cropRetrying)return cropRetrying;
 const run=(async()=>{
  const a=acct();if(!a||typeof X.epoch!=='number')return;const e=econ();if(typeof e?.confirmSell!=='function')return;
  for(const rec of readPending(a)){if(acct()!==a)return;
   if(cropApplied(rec.req)){forgetCrop(a,rec.req);continue;}
   if(!(Array.isArray(S.cropPending)&&S.cropPending.some(x=>x.req===rec.req))){S.cropPending=[...(S.cropPending||[]),rec];save();}
   let r;try{r=await e.confirmSell(rec);}catch(err){r={ok:false,reason:'error'};}
   await applyCropResult(rec,r);}})();
 cropRetrying=run.finally(()=>{cropRetrying=null;});return cropRetrying;}
X.retryCrops=retryCrops;X.loadEpoch=loadEpoch;X.readPending=readPending;
const pkey=a=>PEND_KEY+'.'+a;
const readList=k=>{try{const v=JSON.parse(localStorage.getItem(k)||'null');return (Array.isArray(v)?v:v?[v]:[]).filter(okP);}catch(e){return [];}};
function migrateLegacy(a){if(!a)return;let old;try{old=localStorage.getItem(PEND_KEY);}catch(e){return;}if(old==null)return;
 const mine=readList(pkey(a)),add=readList(PEND_KEY).filter(p=>!mine.some(q=>q.req===p.req)).map(p=>({...p,acct:a}));
 try{if(mine.length+add.length)localStorage.setItem(pkey(a),JSON.stringify([...mine,...add]));localStorage.removeItem(PEND_KEY);}catch(e){}log('pending migrated',a,add.length);}
const getPendsOf=a=>{if(!a)return [];migrateLegacy(a);return readList(pkey(a)).map(p=>({...p,acct:a}));};
const getPends=()=>getPendsOf(acct());
const putPends=(a,l)=>{if(!a)return;try{l.length?localStorage.setItem(pkey(a),JSON.stringify(l)):localStorage.removeItem(pkey(a));}catch(e){}};
const addPend=p=>{const l=getPendsOf(p.acct).filter(q=>q.req!==p.req);l.push(p);putPends(p.acct,l);};
const dropPend=(req,a)=>putPends(a,getPendsOf(a).filter(q=>q.req!==req));
const reserved=id=>getPends().filter(p=>p.id===id).reduce((n,p)=>n+(p.qty|0||1),0);
X.pending=getPends;X.acct=acct;
// r9c (L3): each request id credits once. Across tabs, replays and fresh sells of one account run under one lock (Web Locks, or a
// localStorage lease where Web Locks is missing) and re-read the record inside it; credited ids are remembered per account in
// localStorage and in the save itself (S.sellApplied), so a record another tab already credited is only dropped.
const AKEY=a=>'templeGarden.r9.sellbackApplied.'+a,LKEY=a=>'templeGarden.r9.sellbackLock.'+a,TAB=Math.random().toString(36).slice(2,10);
const appliedLS=a=>{try{const v=JSON.parse(localStorage.getItem(AKEY(a))||'[]');return Array.isArray(v)?v.filter(x=>x&&typeof x.req==='string'):[];}catch(e){return [];}};
const isApplied=(req,a)=>(Array.isArray(S.sellApplied)&&S.sellApplied.includes(req))||appliedLS(a).some(x=>x.req===req);
function markApplied(req,a){S.sellApplied=[...(Array.isArray(S.sellApplied)?S.sellApplied:[]).filter(x=>x!==req),req].slice(-64);
 const now=Date.now(),l=appliedLS(a).filter(x=>x.req!==req&&now-(x.at|0)<30*864e5);l.push({req,at:now});try{localStorage.setItem(AKEY(a),JSON.stringify(l.slice(-200)));}catch(e){}}
async function withLock(a,fn){
 if(navigator.locks?.request)return navigator.locks.request('tg-r9-sellback-'+a,()=>fn());
 const k=LKEY(a),now=Date.now();try{const v=JSON.parse(localStorage.getItem(k)||'null');if(v&&v.tab!==TAB&&v.until>now)return 'locked';
  localStorage.setItem(k,JSON.stringify({tab:TAB,until:now+30000}));if(JSON.parse(localStorage.getItem(k)||'null')?.tab!==TAB)return 'locked';}catch(e){}
 try{return await fn();}finally{try{if(JSON.parse(localStorage.getItem(k)||'null')?.tab===TAB)localStorage.removeItem(k);}catch(e){}}}
X.withLock=withLock;
// The atomic part: before crediting, a tab claims "<account>|<req>" in IndexedDB with add() — one transaction, consistent across
// tabs (localStorage is not: another tab's writes can arrive late). Only the tab whose add() succeeds pays the coins.
let idbP=null;
function idb(){if(idbP)return idbP;idbP=new Promise(res=>{try{const r=indexedDB.open('templeGarden.r9',1);r.onupgradeneeded=()=>{try{r.result.createObjectStore('applied');}catch(e){}};r.onsuccess=()=>res(r.result);r.onerror=()=>res(null);r.onblocked=()=>res(null);}catch(e){res(null);}});return idbP;}
async function claim(req,a){if(isApplied(req,a))return 'no';const db=await idb();if(!db)return 'yes';
 return new Promise(res=>{try{const tx=db.transaction('applied','readwrite');let ok=true;const rq=tx.objectStore('applied').add(Date.now(),a+'|'+req);
  rq.onerror=e=>{ok=false;if(rq.error?.name==='ConstraintError')e.preventDefault();};tx.oncomplete=()=>res(ok?'yes':'no');tx.onabort=()=>res(ok?'err':'no');}catch(e){res('err');}});}
async function claimed(req,a){if(isApplied(req,a))return true;const db=await idb();if(!db)return false;
 return new Promise(res=>{try{const rq=db.transaction('applied','readonly').objectStore('applied').count(a+'|'+req);rq.onsuccess=()=>res(rq.result>0);rq.onerror=()=>res(false);}catch(e){res(false);}});}
X.claimed=claimed;X.claim=claim;
const serverUp=()=>X.fb==='server'&&navigator.onLine!==false&&window.TG_AUTH?.online!==false;
const pendWhy=()=>serverUp()?'上一笔卖回还在确认，请稍候':'没有联网：上一笔卖回要等联网后自动确认，确认前先不能卖别的家具';
const seeded=()=>X.fb==='server'?S.sellSeeded===true:!!S.sellSeeded;
function sellableNow(id){if(!isBB(id))return 0;let n=Math.min(S.sellable?.[id]|0,S.backpack?.[id]|0);if(X.fb==='server'&&X.credit)n=Math.min(n,X.credit[id]|0);return Math.max(0,n);}
X.sellableNow=sellableNow;
function reasonOf(id){const c=item(id),bp=S.backpack?.[id]|0,pl=placedOf(S,id);
 if(!isBB(id))return c?.meritPrice?'善缘换来的，不能折成铜钱':'这件不能卖回商铺';
 if(visiting())return '串门时不能卖，回自己家再卖';
 if(!seeded())return '正在核对旧存档里的家具，稍等片刻';
 if(bp<=0&&pl>0)return `已摆放 ${pl} 件，请先收起再卖`;
 if(bp<=0)return '背包里没有';
 const local=Math.min(S.sellable?.[id]|0,bp);
 if(local<=0)return STARTER[id]?'初始赠送的不能卖；只有在商铺用铜钱买的才能卖回':'寄售、赠送或家人那里得来的，不能卖回商铺';
 if(X.fb==='server'&&X.credit&&(X.credit[id]|0)<local)return '没有联网时买的，联网后不能卖回';
 if(getPends().length)return pendWhy();   // r9b (M1) lock, r9c (L1): only this account's records, with an offline reason
 return '';}
X.reasonOf=reasonOf;
function applySell(id,granted){const d=r6Daily();S.backpack[id]=Math.max(0,(S.backpack[id]|0)-1);S.sellable[id]=Math.max(0,(S.sellable[id]|0)-1);
 S.coins=(S.coins||0)+granted;d.sellbackCoins=(d.sellbackCoins|0)+granted;save();renderTop();toast(`已把 ${item(id)?.name||id} 卖回商铺，得 🪙 ${granted}`);}
const sbUsed=()=>r6Daily().sellbackCoins|0;
const sbLeft=()=>{const local=Math.max(0,SB_CAP-sbUsed());return X.fb==='server'&&X.sbLeft!=null?Math.min(local,X.sbLeft):local;};
let retryTimer=0,retrying=null;
function scheduleRetry(){if(retryTimer)return;retryTimer=setTimeout(()=>{retryTimer=0;retryPending();},15000);}
function creditOnly(id,granted){const d=r6Daily();S.sellable[id]=Math.max(0,(S.sellable[id]|0)-1);S.coins=(S.coins||0)+granted;d.sellbackCoins=(d.sellbackCoins|0)+granted;save();renderTop();
 toast(`这件已不在背包里，但商铺已经收下这笔卖回，补给你 🪙 ${granted}`);}
async function handle(r,p,replay){
 const id=p.id,a=p.acct;X.last=r;log('sellback',id,p.req,JSON.stringify(r));
 if(a&&a!==acct())return;   // r9c (L1): the account changed while this was in flight; the record stays with its owner (idempotent replay there)
 if(r&&r.ok){const still=getPendsOf(a).some(q=>q.req===p.req);dropPend(p.req,a);
  if(!still){log('sellback gone',p.req);return;}
  const cl=await claim(p.req,a);
  if(cl==='err'){addPend(p);scheduleRetry();return;}   // could not record the claim: keep the record, try again later
  if(cl==='no'){log('sellback dup',p.req);return;}   // r9c (L3): another tab / an earlier run already credited this req
  markApplied(p.req,a);
  if(X.credit&&typeof r.credit_left==='number')X.credit[id]=r.credit_left;if(typeof r.left==='number')X.sbLeft=r.left;
  if((S.backpack[id]|0)<=0)return creditOnly(id,Number(r.granted)|0);   // r9c (L2): the server took the credit and quota → the coins are paid
  applySell(id,Number(r.granted)|0);return;}
 const why=r&&r.reason;
 if(why==='error'||!why){if(!replay)toast('网络不稳，这笔卖回还没确认；稍后会自动再试，先别重复卖');scheduleRetry();return;}
 if(why==='offline'&&(replay||!a))return;   // a replay that cannot reach the server stays pending (the 'online' listener retries)
 dropPend(p.req,a);
 if(why==='no_credit'){if(X.credit)X.credit[id]=Number(r.credit)|0;toast('商铺没有这件的购买记录（没联网时买的或别处得来的），不能卖回');}
 else if(why==='daily_cap'){X.sbLeft=Number(r.left)|0;toast(`今日回收已满 ${SB_CAP} 铜钱，明天再来`);}
 else if(why==='price_changed'){X.prices??={};if(Number.isFinite(r.unit))X.prices[id]=r.unit;toast('回收价有变动，已刷新，请再确认一次');}
 else if(why==='not_sellable')toast('这件不能卖回商铺');
 else if(why==='bad_qty'||why==='bad_req')toast('这笔卖回没有成功，请重新再卖一次');
 else if(why==='old_schema'){X.fb='hidden';toast('卖回家具暂未开放');}
 else if(why==='offline'){X.fb='local';return localSell(id,true);}
 else toast('这笔卖回没有成功，请稍后再试');}
function retryPending(){if(retrying)return retrying;retrying=(async()=>{
 const a=acct();if(!a||!getPendsOf(a).length||visiting())return;if(X.busy){scheduleRetry();return;}const e=econ();if(!e?.sellback)return;
 if(X.fb!=='server')await X.probe();if(X.fb!=='server'||acct()!==a)return;
 X.busy=true;try{const got=await withLock(a,async()=>{for(const p0 of getPendsOf(a)){if(acct()!==a)break;const p=getPendsOf(a).find(q=>q.req===p0.req);if(!p)continue;
   if(await claimed(p.req,a)){dropPend(p.req,a);continue;}
   let r;try{r=await e.sellback(p.id,p.qty||1,p.unit,p.req);}catch(x){r={ok:false,reason:'error'};}await handle(r,p,true);}});
  if(got==='locked')scheduleRetry();}
 finally{X.busy=false;}
 if($('#sheet [data-r9-sell-tab]'))openShop('sell');})().finally(()=>{retrying=null;});return retrying;}
X.retryPending=retryPending;
function localSell(id,quiet){const unit=Math.floor((item(id)?.price|0)/2);if(sbUsed()+unit>SB_CAP){toast(`今日回收已满 ${SB_CAP} 铜钱，明天再来`);return false;}applySell(id,unit);return true;}
async function sellBack(id){
 if(visiting()){toast('串门时不能卖回家具，回自己家再卖');return;}
 if(X.busy)return toast('上一笔卖回还在确认，请稍候');if(getPends().length)return toast(pendWhy());
 const why=reasonOf(id);if(why||sellableNow(id)<=0){toast(why||'这件现在不能卖');return;}
 const unit=unitOf(id);if(unit>sbLeft()){toast(`今日回收已满 ${SB_CAP} 铜钱，明天再来`);return;}
 if(X.fb==='server'){const a=acct();if(!a){toast('暂时连不上商铺，稍后再卖');return;}
  const p={id,qty:1,unit,req:'sell-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10),at:Date.now(),acct:a};
  X.busy=true;let got;try{got=await withLock(a,async()=>{if(getPendsOf(a).length)return 'pending';addPend(p);let r;try{r=await econ().sellback(id,1,unit,p.req);}catch(e){r={ok:false,reason:'error'};}await handle(r,p,false);return 'done';});}finally{X.busy=false;}
  if(got==='locked')toast('另一个窗口正在卖回家具，请稍候再试');else if(got==='pending')toast(pendWhy());}
 else if(X.fb==='local')localSell(id);
 else toast('暂时连不上商铺，稍后再卖');
 openShop('sell');}
X.sellBack=sellBack;
function confirmSell(id){const c=item(id),unit=unitOf(id);if(!c)return;
 if(visiting())return toast('串门时不能卖回家具，回自己家再卖');
 openModal(`<h2>卖回商铺</h2><p data-r9-confirm="${id}">把 ${c.emoji||''} ${c.name} ×1 卖回商铺，得 🪙 ${unit}？</p><p class="center" style="font-size:13px">原价 ${c.price} 的一半，卖了就没了。</p><div class="r3-actions"><button class="btn" id="r9SellYes">确认卖出</button><button class="btn ghost" id="r9SellNo">再想想</button></div>`);
 $('#r9SellYes').onclick=()=>{$('#r9SellYes').disabled=true;sellBack(id);};$('#r9SellNo').onclick=()=>openShop('sell');}
X.confirmSell=confirmSell;

/* ---------- legacy seed (one time, before any sell-back) ---------- */
let seeding=null,seedTries=0;
function localSeedValues(d){const out={};let used=0;
 for(const id of [...BUYBACK].sort((a,b)=>unitOf(b)-unitOf(a)||a.localeCompare(b))){const unit=Math.floor((item(id)?.price|0)/2);if(unit<=0)continue;
  let n=Math.max(0,Math.min(ownedOf(d,id),SEED_PER)-(STARTER[id]||0));n=Math.min(n,Math.floor((SEED_BUDGET-used)/unit));if(n>0){out[id]=n;used+=n*unit;}}
 return {out,used};}
X.localSeedValues=localSeedValues;
function applyLocalSeed(flag){const {out,used}=localSeedValues(S);for(const id of BUYBACK){const v=Math.min(ownedOf(S,id),Math.max(S.sellable[id]|0,out[id]|0));if(v>0)S.sellable[id]=v;else delete S.sellable[id];}
 S.sellSeeded=flag;X.seed={kind:'local',flag,value:used,items:out};save();log('seed local',flag,used);}
async function alignToServer(){const e=econ();let c=null;try{c=await e.sellbackCredit();}catch(x){}
 if(c&&c.credit&&typeof c.credit==='object'){X.credit=withInflight(c.credit);X.fb='server';for(const id of BUYBACK){const v=Math.min(ownedOf(S,id),c.credit[id]|0);if(v>0)S.sellable[id]=v;else delete S.sellable[id];}return true;}return false;}
X.seedNow=function(){if(seeding)return seeding;seeding=(async()=>{
 if(S.sellSeeded===true||visiting())return 'skip';
 const st=S,e=econ();
 if(!e||!hasApi()){applyLocalSeed(e?'local':true);return 'local';}
 if(X.mode==='?'||X.fb==='?'||X.fb==='unknown')await X.probe();
 if(X.fb==='local'||X.fb==='hidden'){if(!S.sellSeeded)applyLocalSeed('local');return 'local';}
 const items={};for(const id of BUYBACK){const n=ownedOf(S,id);if(n>0)items[id]=n;}
 try{await window.TG_STORAGE?.flush?.();}catch(x){}
 let r=null;try{r=await e.sellbackSeed(items);}catch(x){r={ok:false,reason:'error'};}
 if(S!==st||visiting())return 'stale';
 X.seed={kind:'server',r};log('seed',JSON.stringify(r));
 const why=r&&r.ok?'ok':r&&r.reason;
 if(why==='ok'||why==='done'||why==='new_account'){
  if(!(await alignToServer())&&r&&r.ok&&r.credit)for(const id of BUYBACK){const v=Math.min(ownedOf(S,id),Math.max(S.sellable[id]|0,r.credit[id]|0));if(v>0)S.sellable[id]=v;}
  S.sellSeeded=true;save();try{await window.TG_STORAGE?.flush?.();}catch(x){}return why;}
 if(why==='no_save'||why==='stale_save'){try{await window.TG_STORAGE?.flush?.();}catch(x){}if(++seedTries<=6)setTimeout(()=>X.seedNow(),20000*seedTries);return why;}
 if(why==='offline'||why==='old_schema'){if(!S.sellSeeded)applyLocalSeed('local');return why;}
 if(++seedTries<=6)setTimeout(()=>X.seedNow(),20000*seedTries);return why||'error';})().finally(()=>{seeding=null;});return seeding;};

/* ---------- 卖作物/产物 tab ---------- */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function cropRows(ci){return [...CROPS,...R3_PRODUCE].filter(c=>{const raw=S.inventory[c.id];return typeof raw==='number'&&Number.isFinite(raw)&&raw!==0;}).map(c=>{const price=c.sell??((c.value||1)*8),raw=S.inventory[c.id],ok=Number.isSafeInteger(raw)&&raw>0;
  const fit=!ci.uncapped&&ok&&price>0?Math.min(raw,Math.floor((ci.left||0)/price)):raw,off=!ok||(!ci.uncapped&&fit<=0);
  const note=!ok?' · 数量不对，不能卖':ci.uncapped?'':off?' · 今日已满':fit<raw?` · 今天还能卖 ${fit} 份`:'';
  return `<div class="r3-row" data-r9-crop="${c.id}"><span class="r3-emoji">${c.emoji}</span><span><b>${esc(c.name)}</b><small>库存 ${esc(raw)} · 单价 🪙 ${price}${note}</small></span><button class="btn" data-r9-sell="${c.id}" ${off?'disabled style="opacity:.5"':''}>卖 1</button><button class="btn ghost" data-r9-sell-all="${c.id}" ${off?'disabled style="opacity:.5"':''}>全卖</button></div>`;}).join('');}
function furnRows(){const ids=new Set();for(const c of window.TG_CATALOG)if(['furniture','decor'].includes(c.cat)&&((S.backpack[c.id]|0)>0||isBB(c.id)&&placedOf(S,c.id)>0))ids.add(c.id);
 return [...ids].map(id=>{const c=item(id),bp=S.backpack[id]|0,k=sellableNow(id),why=k>0?reasonOf(id):reasonOf(id)||'这件现在不能卖',ok=k>0&&!why;
  return `<div class="r3-row" data-r9-furn="${id}"><span class="r3-emoji">${c.emoji||'🪑'}</span><span><b>${esc(c.name)}</b><small>背包 ${bp}${isBB(id)?`（可卖 ${k}）· 回收价 🪙 ${unitOf(id)}`:''}${why?`<br>${esc(why)}`:''}</small></span>${isBB(id)?`<button class="btn ghost" data-r9-sellback="${id}" ${ok?'':'disabled style="opacity:.5"'}>卖回 1</button>`:''}</div>`;}).join('');}
function renderSell(){const sheet=$('#sheet'),nav=sheet?.querySelector('.r3-tabs');if(!nav)return;
 while(nav.nextSibling)nav.nextSibling.remove();
 const ci=sellCap(),wrap=document.createElement('div');wrap.dataset.r9SellTab='1';
 const note=ci.uncapped?'':ci.shared?(X.mode==='local'||X.mode==='offline'?'（未联网，和今日事项、善缘兑换共用 40）':'（和今日事项、善缘兑换共用 40）'):'';
 const capLine=ci.uncapped?'按背包数量出售，没有每日铜钱上限':`今日出售 ${ci.used}/${ci.cap}${note}`;
 let html=`<h3>作物 / 产物</h3><p class="r3-balance" id="r9SellCap">${capLine}</p>`+(cropRows(ci)||'<p class="center">背包里还没有作物和产物，去小院收获吧。</p>');
 if(X.fb!=='hidden'&&X.fb!=='?'){
  html+=`<h3>回收家具</h3><p class="r3-balance" id="r9SbCap">在商铺买的家具和装饰，收进背包后可按原价一半卖回 · 今日回收 ${sbUsed()}/${SB_CAP}</p>`;
  if(getPends().length)html+=`<p class="center" id="r9SbPend">${serverUp()?'上一笔卖回还在和商铺确认，确认前先不能卖别的家具。':'没有联网：上一笔卖回要等联网后自动确认，确认前先不能卖别的家具。'}</p>`;
  if(visiting())html+='<p class="center">串门时不能卖，回自己家再卖。</p>';
  else html+=furnRows()||'<p class="center">背包里没有可以卖回的家具或装饰。摆着的要先收起。</p>';}
 wrap.innerHTML=html;sheet.append(wrap);
 wrap.querySelectorAll('[data-r9-sell]').forEach(b=>b.onclick=()=>sellCrop(b.dataset.r9Sell,false));
 wrap.querySelectorAll('[data-r9-sell-all]').forEach(b=>b.onclick=()=>sellCrop(b.dataset.r9SellAll,true));
 wrap.querySelectorAll('[data-r9-sellback]').forEach(b=>b.onclick=()=>confirmSell(b.dataset.r9Sellback));}
X.renderSell=renderSell;
// r9b (M2): everything the tab shows from the server (mode, credit, quota, prices, pending) — any change re-renders it
const sig=()=>JSON.stringify([acct(),serverUp(),X.fb,X.mode,X.cap,X.credit,X.sbLeft,X.prices,getPends().map(p=>p.req)]);X.sig=sig;
const shop=openShop;openShop=function(tab){const out=shop.apply(this,arguments);
 try{if(tab==='sell'){renderSell();
  const before=sig();X.probe().then(()=>{if(!S.sellSeeded||S.sellSeeded==='local'&&X.fb==='server')X.seedNow().then(()=>{if($('#sheet [data-r9-sell-tab]'))renderSell();});
   if(getPends().length&&!retryTimer)retryPending();if(sig()!==before&&$('#sheet [data-r9-sell-tab]'))renderSell();});}}catch(e){X.err=String(e&&e.stack||e);}
 return out;};

/* ---------- entries ---------- */
const hasGoods=()=>[...CROPS,...R3_PRODUCE].some(c=>(S.inventory[c.id]|0)>0);
window.r9BackpackHook=function(){const a=$('#sheet .r3-actions');if(!a||a.querySelector('#r9BagSell'))return;
 const b=document.createElement('button');b.className='btn';b.id='r9BagSell';
 const furn=X.fb!=='hidden'&&BUYBACK.some(id=>(S.backpack[id]|0)>0);
 if(!hasGoods()&&!furn)return;b.textContent=hasGoods()?'卖作物换铜钱':'卖回家具';b.onclick=()=>openShop('sell');a.prepend(b);};
function marketPrompt(){const m=W3?.spaces?.market;if(!m||m.r9Sell)return;const it=m.items.find(i=>i.label==='逛逛商铺'&&Math.abs(i.x+7)<.1&&Math.abs(i.z+2)<.1);if(!it)return;
 m.r9Sell=true;it.label=()=>hasGoods()?'卖作物 · 换铜钱':'逛逛商铺';it.run=()=>hasGoods()?openShop('sell'):openShop();}
const enter=worldEnter;worldEnter=function(){const out=enter.apply(this,arguments);try{marketPrompt();}catch(e){}return out;};try{marketPrompt();}catch(e){}
let lastHint=0;
const hv=harvest;harvest=function(){const before=Object.values(S.inventory||{}).reduce((a,b)=>a+(b|0),0);const out=hv.apply(this,arguments);
 Promise.resolve(out).then(()=>{const now=Date.now(),after=Object.values(S.inventory||{}).reduce((a,b)=>a+(b|0),0);
  const room=sellCap();if(after>before&&now-lastHint>180000&&(room.uncapped||room.left>0)&&!visiting()){lastHint=now;setTimeout(()=>toast('收获的作物可以到集市花木铺「卖作物 · 换铜钱」，也可从背包直接去卖'),1600);}}).catch(()=>{});return out;};

// Test seam. Reads and writes the save the sale code already closes over. It does not change prices, caps, or request-id rules.
X.debugState=function(){const d=r6Daily();return {coins:S.coins,merit:S.merit,inventory:Object.assign({},S.inventory),backpack:Object.assign({},S.backpack),sellable:Object.assign({},S.sellable),sellSeeded:S.sellSeeded,sellApplied:(S.sellApplied||[]).slice(),cropApplied:(S.cropApplied||[]).slice(),cropPending:(S.cropPending||[]).slice(),epoch:X.epoch??null,daily:{coinsEarned:d.coinsEarned|0,sellCoins:d.sellCoins|0,sellbackCoins:d.sellbackCoins|0,meritCoins:d.meritCoins|0}};};
X.debugPatch=function(p){if(!p)return X.debugState();if('coins' in p)S.coins=p.coins;if('merit' in p)S.merit=p.merit;if(p.inventory)S.inventory=Object.assign({},p.inventory);if(p.backpack)S.backpack=Object.assign({},p.backpack);if(p.sellable)S.sellable=Object.assign({},p.sellable);if('sellSeeded' in p)S.sellSeeded=p.sellSeeded;if(p.sellApplied)S.sellApplied=p.sellApplied.slice();if(p.daily){const d=r6Daily();for(const k of ['coinsEarned','sellCoins','sellbackCoins','meritCoins'])if(k in p.daily)d[k]=p.daily[k];}return X.debugState();};
/* ---------- boot ---------- */
loadEpoch();
setTimeout(()=>{X.probe().then(()=>{if(!S.sellSeeded||(S.sellSeeded==='local'&&X.fb==='server'))X.seedNow();if(getPends().length)retryPending();retryCrops();});},4000);
window.addEventListener('online',()=>{X.probe().then(()=>{if(getPends().length)retryPending();retryCrops();});});
window.addEventListener('offline',()=>{if($('#sheet [data-r9-sell-tab]'))renderSell();});
// r9c (L2): a unit that is being sold back stays in the backpack until the sale is confirmed (no placing it meanwhile)
const RES_MSG='这件正在卖回商铺确认中，先不能摆放';
const pe=window.r3PlacementError;if(typeof pe==='function')r3PlacementError=function(sceneId,it,ignore=-1,restoring=false){if(it&&ignore<0&&!restoring&&isBB(it.id)&&(S.backpack?.[it.id]|0)-reserved(it.id)<=0)return RES_MSG;return pe.apply(this,arguments);};
const pe6=window.r6PlacementError;if(typeof pe6==='function')window.r6PlacementError=r6PlacementError=function(scene,it,ignore=-1){if(it&&ignore<0&&isBB(it.id)&&(S.backpack?.[it.id]|0)-reserved(it.id)<=0)return RES_MSG;return pe6.apply(this,arguments);};
// r9c (L1): sign-in / account switch → re-render for the new account and replay only its own records
let lastAcct=acct();const onAcct=()=>{const a=acct();if(a===lastAcct)return;lastAcct=a;log('acct',a);if(retryTimer){clearTimeout(retryTimer);retryTimer=0;}
 loadEpoch();
 X.probe().then(()=>{if($('#sheet [data-r9-sell-tab]'))renderSell();if(getPends().length)retryPending();retryCrops();});};
try{window.TG_AUTH?.onChange?.(()=>setTimeout(onAcct,0));}catch(e){}setInterval(onAcct,5000);
// another tab finished or added a record → refresh the open tab
window.addEventListener('storage',e=>{if(e.key&&e.key.startsWith(PEND_KEY)&&$('#sheet [data-r9-sell-tab]'))renderSell();});
})();
