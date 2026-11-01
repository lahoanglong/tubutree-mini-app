import { api, lane, prismaFor, closePrisma } from '../../../2026-10-20-uat/tools/uat-harness/lib.mjs';
const L = lane(7);
const call = async (m, p, body) => { const r = await api(L, m, p, { user: 'admin', body }); console.log(m, p, r.status, r.ok ? '' : JSON.stringify(r.body).slice(0, 300)); return r; };
const db = prismaFor(L);
const vOf = async (slug, idx = 0) => {
  const p = await db.product.findUnique({ where: { slug }, include: { variations: { orderBy: { retailPrice: 'asc' } } } });
  if (!p) throw new Error('không có ' + slug);
  return p.variations[idx];
};
// tắt đợt mẫu cũ
const list = (await call('GET', '/admin/flash-sales')).body;
for (const s of (list.data ?? list)) if (/UAT/.test(s.title) && s.isActive) await call('PATCH', `/admin/flash-sales/${s.id}`, { isActive: false });

const mk = async (title, startAt, endAt, items) => {
  const s = await call('POST', '/admin/flash-sales', { title, startAt, endAt });
  if (!s.ok) return;
  for (const [slug, idx, pct, quota, sold] of items) {
    const v = await vOf(slug, idx);
    const standing = v.salePrice ?? v.retailPrice;
    const flashPrice = Math.round((standing * (100 - pct)) / 100 / 1000) * 1000;
    const r = await call('POST', `/admin/flash-sales/${s.body.id}/items`, { variationId: v.id, flashPrice, quota: Math.min(quota, v.stock), perUserLimit: 3 });
    if (r.ok && sold) await db.flashSaleItem.update({ where: { id: r.body.id }, data: { soldCount: Math.min(sold, Math.min(quota, v.stock) - 1) } });
  }
  console.log('sale', title, s.body.id);
};
await mk('Giờ vàng 20h', '2026-10-31T13:00:00.000Z', '2026-11-01T05:00:00.000Z', [
  ['nuoc-rua-chen-fuwa3e', 0, 30, 60, 41],
  ['nuoc-rua-chen-huong-chanh-la-xanh', 0, 35, 80, 72],
  ['vien-giat-sinh-hoc-la-xanh', 0, 30, 40, 12],
  ['khan-uot-khong-con-be-na', 1, 25, 50, 33],
  ['ca-phe-culi-rang-moc-le-plateau', 0, 25, 30, 5],
  ['mat-ong-hoa-ca-phe-bh-nong', 0, 20, 25, 24],
  ['binh-giu-nhiet-inox-vo-tre-tre-viet', 0, 40, 20, 9],
  ['toner-diep-ca-visante', 0, 30, 30, 0],
]);
await mk('Giờ vàng 12h trưa', '2026-11-01T05:00:00.000Z', '2026-11-01T07:00:00.000Z', [
  ['kem-duong-dem-sam-visante', 0, 35, 30, 0],
  ['hat-mac-ca-nut-vo-bh-nong', 0, 25, 40, 0],
  ['sua-tam-goi-2in1-cho-be-be-na', 0, 30, 50, 0],
  ['nuoc-lau-da-nang-vo-buoi-la-xanh', 0, 30, 50, 0],
  ['ong-hut-tre-tai-su-dung-tre-viet', 0, 40, 60, 0],
  ['dau-chong-ran-da-visante', 0, 30, 25, 0],
]);
await closePrisma();
process.exit(0);
