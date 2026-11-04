import { req, guest, short } from './lib.mjs';
const G = await guest('d_baomat_caps_'+Date.now());
const addr=(i)=>({recipient:'Test '+i,phone:'0912345678',province:'Thành phố Hồ Chí Minh',district:'',ward:'Phường Bến Thành',street:'S '+i,provinceCode:'84_VN79',districtCode:'',wardCode:'84_VN7926743'});
let ok=0,last; for(let i=0;i<30;i++){ const r=await req('POST','/me/addresses',{tok:G.tok,body:addr(i)}); if(r.status===201)ok++; else {last=r.status+' '+short(r.body,100);break;} }
console.log('addresses created before refusal:',ok, last||'(no cap within 30)');
const list=(await req('GET','/me/addresses',{tok:G.tok})).body; console.log('count',list.length);
for (const a of list) await req('DELETE','/me/addresses/'+a.id,{tok:G.tok});
// wishlist
const prods=(await req('GET','/products?limit=50')).body.data; console.log('products', prods.length);
let w=0; for(const p of prods){ const r=await req('POST','/me/wishlist',{tok:G.tok,body:{productId:p.id}}); if(r.status<300)w++; }
console.log('wishlist adds ok', w);
