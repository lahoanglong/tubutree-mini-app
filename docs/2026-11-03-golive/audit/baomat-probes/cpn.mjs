import { req, guest } from './lib.mjs';
const G = await guest('d_baomat_cpn_'+Date.now());
for (const [m,p,mk] of [['POST','/cart/coupon',(i)=>({code:'ZZGUESS'+i})],['POST','/coupons/claim',(i)=>({code:'ZZGUESS'+i})]]) {
  const seq={}; let first429=null;
  for(let i=0;i<60;i++){ const r=await req(m,p,{tok:G.tok,body:mk(i)}); seq[r.status]=(seq[r.status]||0)+1; if(r.status===429&&first429===null)first429=i+1; }
  console.log(m,p,JSON.stringify(seq),'first429 at',first429);
}
const r = await req('POST','/coupons/claim',{tok:G.tok,body:{code:'FREESHIP'}}); console.log('claim FREESHIP as guest',r.status, r.text.slice(0,160));
const r2 = await req('POST','/coupons/claim',{tok:G.tok,body:{code:'XANH10'}}); console.log('claim XANH10 as guest',r2.status, r2.text.slice(0,160));
