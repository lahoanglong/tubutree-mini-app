import { req, short } from './lib.mjs';
const dev='d_baomat_thr_'+Date.now();
let seq=[];
for(let i=0;i<13;i++){const r=await req('POST','/auth/guest',{body:{deviceId:dev}}); seq.push(r.status+(r.status===429?'(RA='+r.headers.get('retry-after')+')':''));}
console.log('same device x13:',seq.join(' '));
// new devices from same IP
seq=[];
for(let i=0;i<34;i++){const r=await req('POST','/auth/guest',{body:{deviceId:'d_baomat_thr_ip_'+Date.now()+'_'+i}}); seq.push(r.status);}
console.log('34 new devices:',seq.join(' '));
// refresh with junk tokens
seq=[];
for(let i=0;i<12;i++){const r=await req('POST','/auth/refresh',{body:{refreshToken:'x'.repeat(40)+'_fixed'}}); seq.push(r.status);}
console.log('refresh same bad token x12:',seq.join(' '));
// zalo-mini-app with junk token
seq=[];
for(let i=0;i<12;i++){const r=await req('POST','/auth/zalo-mini-app',{body:{code:'c',accessToken:'tok_same_'+'a'.repeat(20)}}); seq.push(r.status);}
console.log('zalo-mini-app x12:',seq.join(' '));
