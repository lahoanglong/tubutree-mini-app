// Seed bổ sung cho lần chụp bước chốt (2026-11-01 tối), chỉ DB lane 7 (tubutree_uat_l7) qua API admin của lane 7.
// Thêm: danh mục 2 tầng, mã nhận được (listed), 2 chiến dịch banner, combo BUNDLE_PCT + mua kèm ADDON, Giờ vàng đang chạy + sắp mở.
// Chạy lại được: món đã có (theo tên/mã/slug) thì bỏ qua. Dùng: node final.mjs [--step cats,coupons,campaigns,bundles,flash]
import { api, lane, prismaFor, closePrisma, playwright } from '../../../2026-10-20-uat/tools/uat-harness/lib.mjs';

const L = lane(7);
const db = prismaFor(L);
const argv = process.argv.slice(2);
const steps = (argv.includes('--step') ? argv[argv.indexOf('--step') + 1] : 'cats,coupons,campaigns,bundles,flash').split(',');
const call = async (m, p, body, user = 'admin') => {
  const r = await api(L, m, p, { user, body });
  console.log(m, p, r.status, r.ok ? '' : JSON.stringify(r.body).slice(0, 400));
  return r;
};
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const H = 3600e3;
const D = 24 * H;

async function cats() {
  const tree = (await call('GET', '/admin/categories')).body;
  const all = tree.categories ?? tree.items ?? tree;
  const flat = Array.isArray(all) ? all.flatMap((c) => [c, ...(c.children ?? [])]) : [];
  const byName = (name, parentId) => flat.find((c) => c.name === name && (c.parentId ?? null) === parentId);
  const plan = {
    'cat-cleaning': {
      'Rửa chén & rau quả': ['p7-combo-bep-xanh-rua-chen-lau-san-fuwa3e', 'p7-mieng-rua-chen-xo-muop-tre-viet', 'p-fuwa-bottle', 'p7-nuoc-rua-binh-sua-thao-moc-be-na', 'p7-nuoc-rua-chen-bo-hon-la-xanh', 'p-fuwa-dishwash', 'p7-nuoc-rua-chen-fuwa3e-tui-refill-2l', 'p7-nuoc-rua-chen-huong-chanh-la-xanh', 'p7-nuoc-rua-rau-qua-fuwa3e'],
      'Lau nhà & bếp': ['p7-bot-tay-can-da-nang-la-xanh', 'p7-nuoc-lau-bep-da-nang-fuwa3e', 'p7-nuoc-lau-da-nang-vo-buoi-la-xanh', 'p-fuwa-glass', 'p-fuwa-floor', 'p7-xit-khu-mui-tu-giay-la-xanh'],
      'Nhà tắm & bồn cầu': ['p7-bot-ve-sinh-nha-tam-la-xanh', 'p7-gel-thong-cong-sinh-hoc-fuwa3e', 'p7-nuoc-tay-bon-cau-sinh-hoc-la-xanh', 'p-fuwa-handwash'],
    },
    'cat-laundry': {
      'Nước giặt & bột giặt': ['p7-bot-giat-enzyme-fuwa3e', 'p7-nuoc-giat-do-em-be-be-na', 'p7-nuoc-giat-do-len-lua-la-xanh', 'p7-nuoc-giat-do-lot-la-xanh', 'p-fuwa-laundry', 'p7-nuoc-giat-huu-co-oai-huong-la-xanh', 'p7-nuoc-giat-sinh-hoc-fuwa3e-tui-refill-2l', 'p7-vien-giat-sinh-hoc-la-xanh'],
      'Nước xả & tẩy vết': ['p7-nuoc-xa-vai-dam-dac-huong-nang-la-xanh', 'p7-nuoc-xa-vai-huong-lavender-fuwa3e', 'p7-xit-tay-vet-ban-co-ao-fuwa3e', 'p7-vien-tay-long-may-giat-fuwa3e'],
    },
  };
  for (const [parentId, children] of Object.entries(plan)) {
    const moved = new Set();
    for (const [name, productIds] of Object.entries(children)) {
      let child = byName(name, parentId);
      if (!child) {
        const r = await call('POST', '/admin/categories', { name, parentId, confirmDirectProducts: true });
        if (!r.ok) continue;
        child = r.body.category ?? r.body;
      }
      await call('POST', '/admin/product-categories/assign', { productIds, categoryId: child.id, mode: 'ADD' });
      productIds.forEach((id) => moved.add(id));
    }
    // Sản phẩm đã vào mục lá thì gỡ khỏi mục cha để cha chỉ còn là nhóm (P16: chỉ gán vào mục lá).
    await call('POST', '/admin/product-categories/assign', { productIds: [...moved], categoryId: parentId, mode: 'REMOVE' });
    // nuoc-giat-fuwa3e và vien-tay-long-may-giat-fuwa3e cũng nằm trong cat-cleaning: gỡ ở đó, chúng thuộc nhánh Giặt xả.
    if (parentId === 'cat-laundry') await call('POST', '/admin/product-categories/assign', { productIds: ['p-fuwa-laundry', 'p7-vien-tay-long-may-giat-fuwa3e'], categoryId: 'cat-cleaning', mode: 'REMOVE' });
  }
}

const COUPONS = [
  { code: 'NHANXANH20K', type: 'AMOUNT', value: 20000, minOrder: 150000, title: 'Giảm 20.000đ đơn từ 150.000đ', days: 6 },
  { code: 'NHANSHIP', type: 'FREESHIP', value: 0, minOrder: 99000, title: 'Miễn phí giao hàng đơn từ 99.000đ', days: 2 },
  { code: 'NHAN10', type: 'PERCENT', value: 10, maxDiscount: 50000, minOrder: 300000, title: 'Giảm 10% tối đa 50.000đ', days: 14 },
];

async function coupons() {
  for (const c of COUPONS) {
    const exists = await db.coupon.findUnique({ where: { code: c.code } });
    if (!exists) {
      await call('POST', '/admin/coupons', {
        code: c.code, type: c.type, value: c.value, minOrder: c.minOrder, ...(c.maxDiscount ? { maxDiscount: c.maxDiscount } : {}),
        startAt: iso(NOW - H), endAt: iso(NOW + c.days * D), usageLimit: 500, perUserLimit: 1, scope: 'CLAIM', listed: true, title: c.title,
      });
    }
  }
  // Khách cũ nhận sẵn 1 mã để tab "Mã của tôi" có nội dung.
  await call('POST', '/coupons/claim', { code: 'NHANXANH20K' }, 'returning');
}

async function bannerImage(title, sub, colors) {
  const { chromium } = playwright();
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 400 } });
  await p.setContent(`<html><body style="margin:0"><div style="width:1000px;height:400px;background:linear-gradient(120deg,${colors[0]},${colors[1]});display:flex;flex-direction:column;justify-content:center;padding:0 72px;box-sizing:border-box;font-family:Georgia,serif;color:#fff">
    <div style="font-size:64px;font-weight:700;line-height:1.1">${title}</div><div style="font-size:32px;margin-top:20px;font-family:Helvetica,Arial,sans-serif;opacity:.92">${sub}</div></div></body></html>`);
  const buf = await p.screenshot({ type: 'jpeg', quality: 80 });
  await b.close();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function campaigns() {
  const list = (await call('GET', '/admin/campaigns')).body;
  const rows = list.data ?? list.items ?? list;
  const has = (slug) => Array.isArray(rows) && rows.some((r) => r.slug === slug);
  const defs = [
    { slug: 'tuan-le-song-xanh', title: 'Tuần lễ sống xanh', subtitle: 'Đồ tẩy rửa sinh học giảm đến 30%', placement: 'HOME_TOP', colors: ['#1F4D3A', '#4F7F52'],
      products: ['p-fuwa-laundry', 'p-fuwa-floor', 'p-fuwa-glass', 'p7-nuoc-lau-da-nang-vo-buoi-la-xanh', 'p7-vien-giat-sinh-hoc-la-xanh', 'p7-nuoc-rua-chen-fuwa3e-tui-refill-2l', 'p7-bot-giat-enzyme-fuwa3e', 'p7-nuoc-xa-vai-huong-lavender-fuwa3e'], coupons: ['NHANXANH20K', 'NHAN10'] },
    { slug: 'uu-dai-thang-11', title: 'Ưu đãi tháng 11', subtitle: 'Nhận mã, mua combo tiết kiệm hơn', placement: 'OFFERS_TOP', colors: ['#7A4A12', '#B9772E'],
      products: ['p7-sua-tam-goi-2in1-cho-be-be-na', 'p7-kem-duong-am-cho-be-be-na', 'p7-nuoc-giat-do-em-be-be-na', 'p7-khan-uot-khong-con-be-na'], coupons: ['NHANSHIP'] },
  ];
  for (const c of defs) {
    if (has(c.slug)) {
      const row = rows.find((r) => r.slug === c.slug);
      await call('PUT', `/admin/campaigns/${row.id}/coupons`, { codes: c.coupons });
      continue;
    }
    const image = await bannerImage(c.title, c.subtitle, c.colors);
    const r = await call('POST', '/admin/campaigns', {
      title: c.title, subtitle: c.subtitle, slug: c.slug, placement: c.placement, image, linkType: 'CAMPAIGN_PAGE', audience: 'ALL',
      startAt: iso(NOW - H), endAt: iso(NOW + 14 * D), sortOrder: 0, isActive: true,
    });
    if (!r.ok) continue;
    await call('PUT', `/admin/campaigns/${r.body.id}/products`, { productIds: c.products });
    await call('PUT', `/admin/campaigns/${r.body.id}/coupons`, { codes: c.coupons });
  }
}

async function bundles() {
  const list = (await call('GET', '/admin/bundles')).body;
  const rows = list.data ?? list.items ?? list;
  const has = (title) => Array.isArray(rows) && rows.some((r) => r.title === title);
  const win = { startAt: iso(NOW - H), endAt: iso(NOW + 14 * D), isActive: true };
  const defs = [
    { kind: 'BUNDLE_PCT', title: 'Bộ giặt sạch Fuwa3e', pct: 15, items: [{ productId: 'p-fuwa-laundry' }, { productId: 'p7-nuoc-xa-vai-huong-lavender-fuwa3e' }, { productId: 'p7-xit-tay-vet-ban-co-ao-fuwa3e' }] },
    { kind: 'BUNDLE_PCT', title: 'Bộ bếp sạch Fuwa3e', pct: 12, items: [{ productId: 'p7-nuoc-lau-bep-da-nang-fuwa3e' }, { productId: 'p-fuwa-handwash' }, { productId: 'p-fuwa-glass' }] },
    { kind: 'ADDON', title: 'Mua kèm cho nước giặt Fuwa3e', anchorProductId: 'p-fuwa-laundry', items: [
      { productId: 'p7-vien-tay-long-may-giat-fuwa3e', variationId: 'v7-vien-tay-long-may-giat-fuwa3e-1', addonPrice: 69000, maxQty: 2 },
      { productId: 'p7-bot-giat-enzyme-fuwa3e', variationId: 'v7-bot-giat-enzyme-fuwa3e-1', addonPrice: 109000, maxQty: 1 },
    ] },
  ];
  for (const b of defs) if (!has(b.title)) await call('POST', '/admin/bundles', { ...b, ...win });
}

async function flash() {
  const vOf = async (slug, idx = 0) => {
    const p = await db.product.findUnique({ where: { slug }, include: { variations: { orderBy: { retailPrice: 'asc' } } } });
    if (!p) throw new Error('không có ' + slug);
    return p.variations[idx];
  };
  const list = (await call('GET', '/admin/flash-sales')).body;
  const rows = list.data ?? list;
  const mk = async (title, startAt, endAt, items) => {
    if (rows.some((s) => s.title === title && s.startAt === startAt)) return;
    const s = await call('POST', '/admin/flash-sales', { title, startAt, endAt });
    if (!s.ok) return;
    for (const [slug, idx, pct, quota, sold] of items) {
      const v = await vOf(slug, idx);
      const standing = v.salePrice ?? v.retailPrice;
      const flashPrice = Math.round((standing * (100 - pct)) / 100 / 1000) * 1000;
      const q = Math.min(quota, v.stock);
      const r = await call('POST', `/admin/flash-sales/${s.body.id}/items`, { variationId: v.id, flashPrice, quota: q, perUserLimit: 3 });
      if (r.ok && sold) await db.flashSaleItem.update({ where: { id: r.body.id }, data: { soldCount: Math.min(sold, q - 1) } });
    }
    console.log('sale', title, s.body.id);
  };
  // 01/11 20:00 → 02/11 01:00 giờ VN (dài hơn khung 2 giờ cho đủ thời gian chụp), và 02/11 12:00 → 14:00 sắp mở.
  await mk('Giờ vàng 20:00', '2026-11-01T13:00:00.000Z', '2026-11-01T18:00:00.000Z', [
    ['nuoc-rua-chen-fuwa3e', 0, 30, 60, 41],
    ['nuoc-rua-chen-huong-chanh-la-xanh', 0, 35, 80, 72],
    ['vien-giat-sinh-hoc-la-xanh', 0, 30, 40, 12],
    ['khan-uot-khong-con-be-na', 0, 25, 50, 33],
    ['ca-phe-culi-rang-moc-le-plateau', 0, 25, 30, 5],
    ['mat-ong-hoa-ca-phe-bh-nong', 0, 20, 25, 24],
    ['binh-giu-nhiet-inox-vo-tre-tre-viet', 0, 40, 20, 9],
    ['toner-diep-ca-visante', 0, 30, 30, 0],
  ]);
  await mk('Giờ vàng 12:00', '2026-11-02T05:00:00.000Z', '2026-11-02T07:00:00.000Z', [
    ['kem-duong-dem-sam-visante', 0, 35, 30, 0],
    ['hat-mac-ca-nut-vo-bh-nong', 0, 25, 40, 0],
    ['sua-tam-goi-2in1-cho-be-be-na', 0, 30, 50, 0],
    ['nuoc-lau-da-nang-vo-buoi-la-xanh', 0, 30, 50, 0],
    ['ong-hut-tre-tai-su-dung-tre-viet', 0, 40, 60, 0],
    ['dau-chong-ran-da-visante', 0, 30, 25, 0],
  ]);
}

const fns = { cats, coupons, campaigns, bundles, flash };
for (const s of steps) {
  console.log(`== ${s}`);
  await fns[s]();
}
await closePrisma();
process.exit(0);
