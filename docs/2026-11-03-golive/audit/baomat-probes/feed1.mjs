import { req, guest, short } from './lib.mjs';
const G = await guest('d_baomat_feed_'+Date.now());
const img = 'data:image/png;base64,' + 'A'.repeat(600000);   // ~600 KB, hợp lệ theo regex, không phải ảnh thật
let r = await req('POST','/feed',{tok:G.tok,body:{kind:'MANUAL',body:'baomat probe',images:[img,img,img,img,img,img]}});
console.log('guest post with 6 x 600KB fake PNG', r.status, short(r.body,200), 'req bytes ≈', (6*600000/1e6).toFixed(1),'MB');
const id = r.body?.id;
if (id) {
  const g = await req('GET','/feed/'+id,{tok:G.tok}); console.log('own post visible', g.status, short({status:g.body?.status, images:g.body?.images?.length},100));
  // second post immediately
  let ok=0; for(let i=0;i<6;i++){ const x=await req('POST','/feed',{tok:G.tok,body:{kind:'MANUAL',body:'baomat probe '+i,images:[img]}}); if(x.status<300){ok++; if(x.body?.id) await req('DELETE','/feed/'+x.body.id,{tok:G.tok});} else console.log(' post',i,x.status); }
  console.log('posts accepted in burst (5/min limit):',ok);
  const d = await req('DELETE','/feed/'+id,{tok:G.tok}); console.log('cleanup delete', d.status);
}
