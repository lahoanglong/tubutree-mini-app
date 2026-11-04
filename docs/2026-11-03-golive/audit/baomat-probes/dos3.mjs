import { req, guest } from './lib.mjs';
const G = await guest('d_baomat_dos3_'+Date.now());
for (const n of [3000, 10000]) {
  const items = Array.from({length:n},(_,i)=>({orderItemId:'x'+i,quantity:1}));
  const body = JSON.stringify({items});
  const t=Date.now(); const r = await req('POST','/orders/TUBU0000000000000/return-estimate',{tok:G.tok, body});
  console.log(`items[${n}] body=${(body.length/1024).toFixed(0)}KB → status ${r.status} in ${Date.now()-t}ms; msg0=${(Array.isArray(r.body?.message)?r.body.message[0]:r.body?.message||'').slice(0,70)}`);
}
