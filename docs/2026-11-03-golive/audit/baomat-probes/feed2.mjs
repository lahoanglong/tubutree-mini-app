import { req, guest, short, A } from './lib.mjs';
const A1 = await guest('d_baomat_feedA_'+Date.now()); const B1 = await guest('d_baomat_feedB_'+Date.now());
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const img='data:image/png;base64,'+png;
let r = await req('POST','/feed',{tok:A1.tok,body:{kind:'MANUAL',body:'baomat pending probe',images:[img]}});
const id=r.body.id; console.log('post', r.status, r.body.status);
const mine=(await req('GET','/feed/'+id,{tok:A1.tok})).body; const url=mine.images?.[0]; console.log('image url owner sees:', url);
const path = url.replace(/^.*\/api/,'');
for (const [who,tok] of [['owner',A1.tok],['other guest',B1.tok],['anonymous',undefined]]) {
  const x=await req('GET',path,{tok}); console.log(who.padEnd(12), x.status, 'cache-control=',x.headers.get('cache-control'), 'ctype=',x.headers.get('content-type'));
}
const other=await req('GET','/feed/'+id,{tok:B1.tok}); console.log('other guest GET /feed/:id', other.status);
const lst=await req('GET','/feed',{tok:B1.tok}); console.log('other guest sees in list?', JSON.stringify(lst.body).includes(id));
const noV = await req('GET',path.replace(/\?v=.*/,''),{tok:A1.tok}); console.log('owner no v', noV.status, noV.headers.get('cache-control'));
await req('DELETE','/feed/'+id,{tok:A1.tok});
