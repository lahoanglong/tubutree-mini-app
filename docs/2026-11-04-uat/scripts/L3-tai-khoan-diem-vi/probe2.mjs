import { place, codeOf, done, A, sql1 } from './lib3.mjs';
const p = await place('brand', [{ slug: 'nuoc-rua-chen-fuwa3e', qty: 50 }], { tag: 'p2' });
console.log(p.quoteStatus, JSON.stringify(p.quote).slice(0, 600), p.placeStatus, JSON.stringify(p.raw).slice(0, 300));
await done();
