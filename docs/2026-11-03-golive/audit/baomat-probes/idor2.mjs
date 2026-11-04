import { req, guest, short } from './lib.mjs';
import fs from 'node:fs';
const c = JSON.parse(fs.readFileSync('idor-ctx.json','utf8'));
const X = await guest('d_baomat_attack_00000001');
const V = await guest('d_baomat_victim_00000001');
const t = X.tok;
const tests = [
  ['GET','/orders/'+c.code],
  ['POST','/orders/'+c.code+'/cancel',{reason:'x'}],
  ['POST','/orders/'+c.code+'/repurchase',{}],
  ['POST','/orders/'+c.code+'/return-estimate',{items:[]}],
  ['POST','/orders/'+c.code+'/return-request',{items:[],reason:'x'}],
  ['GET','/payments/bank-qr/'+c.code],
  ['PATCH','/me/addresses/'+c.addrId,{street:'HACKED'}],
  ['DELETE','/me/addresses/'+c.addrId],
  ['PATCH','/cart/items/'+c.itemId,{quantity:9}],
  ['DELETE','/cart/items/'+c.itemId],
  ['GET','/waste/requests/by-order/'+c.code],
  ['GET','/waste/requests/'+c.addrId],
  ['POST','/me/notifications/'+c.addrId+'/read',{}],
  ['POST','/me/subscriptions/'+c.addrId+'/skip',{}],
  ['PATCH','/me/subscriptions/'+c.addrId,{}],
  ['GET','/reviews/'+c.addrId],
  ['POST','/orders/me/refunds/'+c.addrId+'/destination',{destination:'WALLET'}],
];
for (const [m,p,b] of tests) {
  const r = await req(m,p,{tok:t,body:b});
  console.log('X→', m.padEnd(6), p.padEnd(60), r.status, short(r.body,110));
}
// control: owner sees
let r = await req('GET','/orders/'+c.code,{tok:V.tok}); console.log('V→ GET order', r.status);
r = await req('GET','/me/addresses',{tok:V.tok}); console.log('V addr still', r.status, short(r.body,120));
r = await req('GET','/cart',{tok:V.tok}); console.log('V cart', r.status, short(r.body?.items?.map?.(i=>i.quantity),80));
