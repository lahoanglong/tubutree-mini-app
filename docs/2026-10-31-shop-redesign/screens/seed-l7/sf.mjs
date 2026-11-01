import { api, lane, prismaFor, closePrisma } from '../../../2026-10-20-uat/tools/uat-harness/lib.mjs';
const L = lane(7);
const db = prismaFor(L);
const call = async (m, p, body) => { const r = await api(L, m, p, { user: 'ctv', body }); console.log(m, p, r.status, r.ok ? '' : JSON.stringify(r.body).slice(0, 300)); return r; };
const pid = async (slug) => (await db.product.findUnique({ where: { slug } })).id;
const cols = [
  ['Bếp xanh mỗi ngày', 'GRID', undefined, undefined, ['nuoc-rua-chen-fuwa3e', 'nuoc-rua-chen-huong-chanh-la-xanh', 'nuoc-lau-bep-da-nang-fuwa3e', 'mieng-rua-chen-xo-muop-tre-viet', 'khan-lau-bep-soi-tre-moc-an', 'nuoc-rua-rau-qua-fuwa3e']],
  ['Chăm bé an toàn', 'CAROUSEL', undefined, undefined, ['sua-tam-goi-2in1-cho-be-be-na', 'khan-uot-khong-con-be-na', 'nuoc-giat-do-em-be-be-na', 'dau-tram-be-cobote', 'kem-duong-am-cho-be-be-na']],
  ['Combo giặt sạch tiết kiệm', 'STACK', 'COMBO', 10, ['nuoc-giat-huu-co-oai-huong-la-xanh', 'nuoc-xa-vai-huong-lavender-fuwa3e', 'xit-tay-vet-ban-co-ao-fuwa3e']],
];
for (const [title, layout, kind, comboDiscountPct, slugs] of cols) {
  const c = await call('POST', '/storefront/me/collections', { title, layout, ...(kind ? { kind } : {}), ...(comboDiscountPct ? { comboDiscountPct } : {}) });
  if (!c.ok) continue;
  for (const s of slugs) await call('POST', `/storefront/me/collections/${c.body.id}/items`, { productId: await pid(s) });
}
await closePrisma();
process.exit(0);
