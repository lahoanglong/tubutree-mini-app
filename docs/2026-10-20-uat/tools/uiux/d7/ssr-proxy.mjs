// Proxy chỉ-đọc đứng trước API UAT cho phần SSR của Next (trình duyệt đã bị Playwright chặn route /api/**,
// nên chỉ server Next gọi tới đây). Mọi GET chuyển tiếp nguyên vẹn tới UIUX_API; non-GET bị từ chối 405
// để không ghi gì vào DB UAT. Riêng /storefront/public/:slug và /brand/public/:slug trả fixture dựng
// từ sản phẩm thật, vì DB UAT chưa có gian hàng nào và nhãn hàng chưa đăng (API thật trả 404).
//
// Chạy:
//   export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
//   UIUX_API=http://127.0.0.1:3221 SSR_PROXY_PORT=3231 node docs/2026-10-20-uat/tools/uiux/d7/ssr-proxy.mjs
import http from 'node:http';

const UP = (process.env.UIUX_API ?? 'http://127.0.0.1:3221').replace(/\/+$/, '');
const PORT = Number(process.env.SSR_PROXY_PORT ?? 3231);

let productsCache = null;
async function products() {
  if (productsCache) return productsCache;
  const r = await fetch(`${UP}/api/products?limit=12`);
  productsCache = (await r.json()).data ?? [];
  return productsCache;
}

const card = (p) => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  thumbnail: p.thumbnail,
  brand: p.brand,
  basePrice: p.basePrice,
  salePrice: p.salePrice,
  ratingAvg: p.ratingAvg,
  reviewCount: p.reviewCount,
  sold: p.sold,
});

async function storefront(slug) {
  const ps = await products();
  return {
    id: 'sf-uiux',
    slug,
    subdomain: slug,
    customDomain: null,
    type: 'AFFILIATE',
    isPartner: false,
    approved: true,
    subdomainEnabled: false,
    title: 'Góc Xanh của Minh',
    headerNote: 'Mình chọn đồ dùng tự nhiên cho gia đình nhỏ. Hỏi mình qua Zalo nhé!',
    avatarUrl: null,
    coverUrl: null,
    theme: null,
    themeColor: '#2E7D4F',
    ownerTier: { name: 'Lộc Biếc', emoji: '🌿' },
    referralCode: 'TUBU2410',
    collections: [
      { id: 'c1', title: 'Mình dùng mỗi ngày', kind: null, layout: 'grid', comboDiscountPct: null, items: ps.slice(0, 6).map((p, i) => ({ id: `i${i}`, note: i % 2 ? 'Mùi dịu, bé nhà mình dùng ổn.' : null, variationId: null, product: card(p) })) },
      { id: 'c2', title: 'Combo tiết kiệm', kind: 'COMBO', layout: 'grid', comboDiscountPct: 10, items: ps.slice(6, 9).map((p, i) => ({ id: `j${i}`, note: null, variationId: null, product: card(p) })) },
    ],
  };
}

async function brand(slug) {
  const ps = (await products()).filter((p) => (p.brand ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === slug.replace(/-/g, ''));
  const list = ps.length ? ps : (await products()).slice(0, 6);
  return {
    id: 'br-uiux',
    slug,
    name: list[0]?.brand ?? 'BH.Nong',
    logoUrl: null,
    coverUrl: null,
    tagline: 'Mật ong rừng và nông sản sạch từ Tây Nguyên',
    story: 'Chúng tôi làm việc trực tiếp với bà con ở Đắk Lắk từ năm 2016. Mỗi mẻ mật đều có phiếu kiểm nghiệm.',
    storyImages: [],
    origin: 'Đắk Lắk',
    isVerified: true,
    followerCount: 128,
    certifications: [{ code: 'OCOP', label: 'OCOP 4 sao', proofUrl: null }],
    promotions: [
      { id: 'pr1', title: 'Giảm 10% mật ong', subtitle: 'Đơn từ 199.000đ', themeColor: null, couponCode: 'XANH10', startAt: '2026-10-01T00:00:00+07:00', endAt: '2026-11-30T23:59:59+07:00' },
    ],
    products: list.map(card),
    // brand.service.ts getPublic luôn trả dealerRewards (mảng); thiếu là BrandDealerBlock sập (rewards.length).
    dealerRewards: [{ id: 'dr1', type: 'GIFT', title: 'Quà tặng đại lý đạt mốc', description: 'Đạt 20 thùng trong tháng', threshold: 20, period: 'MONTH' }],
    commissionRate: 0.08,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'application/json' });
      return res.end('{"message":"ssr-proxy chỉ cho GET"}');
    }
    const u = new URL(req.url, 'http://x');
    let m;
    if ((m = /^\/api\/storefront\/public\/([^/]+)\/?$/.exec(u.pathname))) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await storefront(decodeURIComponent(m[1]))));
    }
    if ((m = /^\/api\/brand\/public\/([^/]+)\/?$/.exec(u.pathname))) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(await brand(decodeURIComponent(m[1]))));
    }
    const headers = { accept: req.headers.accept ?? 'application/json' };
    const r = await fetch(UP + u.pathname + u.search, { method: req.method, headers, signal: AbortSignal.timeout(15000) });
    const body = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'ssr-proxy: ' + String(e).slice(0, 120) }));
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`ssr-proxy ${PORT} -> ${UP}`));
