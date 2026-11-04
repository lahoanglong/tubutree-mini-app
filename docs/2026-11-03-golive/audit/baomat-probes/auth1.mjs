import { req, guest, short } from './lib.mjs';
const G = await guest('d_baomat_auth_'+Date.now());
console.log('login', G.status, 'access len', G.tok.length, 'refresh len', G.refresh.length);
const dec = (t)=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString());
const p = dec(G.tok); console.log('payload', JSON.stringify(p), 'ttl s', p.exp-p.iat);
let r1 = await req('POST','/auth/refresh',{body:{refreshToken:G.refresh}});
console.log('refresh #1', r1.status, 'new refresh differs', r1.body.refreshToken!==G.refresh);
let r2 = await req('POST','/auth/refresh',{body:{refreshToken:G.refresh}});
console.log('refresh reuse of old token', r2.status, short(r2.body,120));
let r3 = await req('POST','/auth/refresh',{body:{refreshToken:r1.body.refreshToken}});
console.log('refresh with newer token after reuse (family revoked?)', r3.status, short(r3.body,120));
// old access token still valid after logout? 
const G2 = await guest('d_baomat_auth2_'+Date.now());
let lo = await req('POST','/auth/logout',{body:{refreshToken:G2.refresh}});
console.log('logout',lo.status);
let me = await req('GET','/me',{tok:G2.tok});
console.log('access token after logout', me.status, '(access token stays valid until exp: stateless)');
// alg none / tampered tokens
const [h,pl,s]=G2.tok.split('.');
const none = Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')+'.'+pl+'.';
console.log('alg none', (await req('GET','/me',{tok:none})).status);
const admin = {...dec(G2.tok), role:'ADMIN'};
const forged = h+'.'+Buffer.from(JSON.stringify(admin)).toString('base64url')+'.'+s;
console.log('forged admin payload', (await req('GET','/admin/orders',{tok:forged})).status);
console.log('garbage bearer', (await req('GET','/me',{tok:'abc'})).status);
