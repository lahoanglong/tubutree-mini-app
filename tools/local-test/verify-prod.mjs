// Verify nhanh PROD (chỉ đọc, không tạo dữ liệu): health, brands, ảnh sản phẩm, backfill, product detail.
const BASE = process.env.API_BASE ?? 'https://api.tubutree.com/api';
async function j(path) { const r = await fetch(BASE + path, { cache: 'no-store' }); return { status: r.status, body: await r.json().catch(() => null) }; }
(async () => {
  console.log('API_BASE =', BASE);
  const h = await j('/health'); console.log('health:', JSON.stringify(h.body));
  const b = await j('/brands'); console.log('brands:', (b.body ?? []).map((x) => `${x.brand}(${x.count})`).join(', '));
  const p = await j('/products?limit=100');
  const items = p.body?.data ?? [];
  const noImg = items.filter((x) => !x.thumbnail);
  console.log(`products total=${p.body?.meta?.total}, trả=${items.length}, KHÔNG ảnh=${noImg.length}` +
    (noImg.length ? ` (${[...new Set(noImg.map((x) => x.brand))].join(',')})` : ''));
  const lp = await j('/products/arabica-cau-dat-le-plateau');
  console.log(`Le Plateau detail: ${lp.status} · ${lp.body?.name} · ảnh=${(lp.body?.images || []).length}`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
