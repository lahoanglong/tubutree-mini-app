import { req, guest } from './lib.mjs';
const G = await guest('d_baomat_hdr_'+Date.now());
for (const p of ['/me','/orders','/me/addresses','/cart','/me/wallet','/home/me','/products/for-you','/flash-sales/upcoming','/group-buy']) {
  const r = await req('GET',p,{tok:G.tok});
  console.log(p.padEnd(24), r.status, 'cache-control=', r.headers.get('cache-control'), 'etag=', !!r.headers.get('etag'), 'vary=', r.headers.get('vary'));
}
// public with Authorization
for (const p of ['/products','/home','/config/public']) {
  const r = await req('GET',p,{tok:G.tok});
  console.log('(authed) '+p.padEnd(18), r.status, 'cache-control=', r.headers.get('cache-control'), 'vary=', r.headers.get('vary'));
}
// error responses leak stack?
let r = await req('GET','/orders/%00',{tok:G.tok}); console.log('null byte', r.status, r.text.slice(0,150));
r = await req('GET','/products/'+encodeURIComponent("' OR 1=1--"),{}); console.log('slug sqli', r.status, r.text.slice(0,120));
r = await req('GET','/nonexistent'); console.log('404 body', r.status, r.text.slice(0,200));
r = await req('POST','/auth/guest',{body:'{"deviceId":'}); console.log('bad json', r.status, r.text.slice(0,200));
r = await req('GET','/me',{headers:{authorization:'Bearer '+'a'.repeat(100000)}}); console.log('huge bearer', r.status);
r = await fetch('http://localhost:3261/api/products',{method:'OPTIONS',headers:{origin:'https://evil.example','access-control-request-method':'GET'}}); console.log('CORS preflight evil origin (NODE_ENV=development lane)', r.status, r.headers.get('access-control-allow-origin'));
