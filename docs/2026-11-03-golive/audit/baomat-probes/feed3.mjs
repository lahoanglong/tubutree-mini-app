import { req, guest } from './lib.mjs';
const A1 = await guest('d_baomat_feedA3_'+Date.now());
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let r = await req('POST','/feed',{tok:A1.tok,body:{kind:'MANUAL',body:'baomat pending probe 3',images:['data:image/png;base64,'+png]}});
const id=r.body.id; const mine=(await req('GET','/feed/'+id,{tok:A1.tok})).body; const path=mine.images[0].replace(/^.*\/api/,'');
const base=path.replace(/\?v=.*/,'');
for (const [label,p] of [['anon, no v',base],['anon, wrong v',base+'?v=deadbeef'],['anon, correct v',path]]) { const x=await req('GET',p,{}); console.log(label.padEnd(18), x.status, x.headers.get('cache-control')); }
await req('DELETE','/feed/'+id,{tok:A1.tok});
const x=await req('GET',path,{}); console.log('after owner delete (REMOVED), anon correct v:', x.status);
