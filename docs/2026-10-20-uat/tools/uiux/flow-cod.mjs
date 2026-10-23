// Đếm số chạm luồng mua lõi Mini App: Trang chủ -> chi tiết SP -> Mua ngay -> thanh toán COD -> đặt đơn thành công.
// Mock toàn bộ API như capture.mjs (ApiRouter); ghi đè thêm POST /cart/items, GET /me/addresses (địa chỉ theo địa giới mới)
// và POST /orders (đơn COD) để luồng đi hết. Không ghi gì vào API thật.
//   node docs/2026-10-20-uat/tools/uiux/flow-cod.mjs [chromium|webkit] [buynow|cart]
// Ghi: docs/2026-10-20-uat/screens/flow/<engine>-<mode>-<n>.png + flow-<engine>-<mode>.json
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit, VIEWPORTS, ROOT } from './lib/pw.mjs';
import { ApiRouter, loadEndpoints } from './lib/api-router.mjs';
import { makeSession, makeCurated } from './lib/sessions.mjs';
import { artUri } from './lib/art.mjs';

const engine = process.argv[2] ?? 'chromium';
const mode = process.argv[3] ?? 'buynow';
const API = (process.env.UIUX_API ?? 'http://127.0.0.1:3221') + '/api';
const BASE = process.env.MINIAPP_BASE ?? 'http://localhost:3223';
const OUT = path.join(ROOT, 'docs/2026-10-20-uat/screens/flow');
fs.mkdirSync(OUT, { recursive: true });

const products = (await (await fetch(API + '/products?limit=8')).json()).data.map((p) => ({ ...p, thumbnail: p.thumbnail ?? artUri(p.name) }));
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch();
const context = await browser.newContext({ ...VIEWPORTS[390], locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', reducedMotion: 'reduce' });
const page = await context.newPage();
const router = new ApiRouter({ state: 'normal', session: makeSession('customer'), endpoints: loadEndpoints('miniapp-endpoints.json'), curated: makeCurated({ persona: 'customer', products }), products });
await router.install(page);
// Bóng gợi ý Vườn Xanh chỉ hiện một lần mỗi máy: đánh dấu đã xem để không che nút trong luồng đếm chạm.
await page.addInitScript(() => {
  try {
    localStorage.setItem('tubu_garden_hint_seen', '1');
  } catch {
    /* bỏ qua */
  }
});

let cart = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
await page.route((u) => u.pathname === '/api/cart/items', async (route) => {
  if (route.request().method() !== 'POST') return route.fallback();
  const body = JSON.parse(route.request().postData() ?? '{}');
  const p = products[0];
  const unit = p.salePrice ?? p.basePrice;
  const qty = body.quantity ?? 1;
  cart = { ...cart, items: [{ id: 'cart-1', variationId: body.variationId, productName: p.name, variationName: 'Chai 500ml', slug: p.slug, thumbnail: p.thumbnail, unitPrice: unit, quantity: qty, stock: 20, weight: 500, total: unit * qty }], subtotal: unit * qty, itemCount: qty, freeship: unit * qty >= 200000 };
  return json(route, cart);
});
await page.route((u) => u.pathname === '/api/cart', (route) => (route.request().method() === 'GET' && cart.items.length ? json(route, cart) : route.fallback()));
await page.route((u) => u.pathname === '/api/me/addresses', (route) =>
  route.request().method() === 'GET'
    ? json(route, [{ id: 'addr-0', recipient: 'Nguyễn Thị Hoa', phone: '0901234567', province: 'TP. Hồ Chí Minh', provinceCode: '84_VN_79', district: null, districtCode: null, ward: 'Phường Sài Gòn', wardCode: '26734', street: '12 Lê Lợi', isDefault: true }])
    : route.fallback(),
);
await page.route((u) => u.pathname === '/api/checkout/place-order', (route) => {
  if (route.request().method() !== 'POST') return route.fallback();
  const total = cart.subtotal || 260000;
  return json(route, { code: 'TUBU26101901', id: 'o-1', status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', subtotal: total, discount: 0, shippingFee: 0, total, pointsEarned: Math.floor(total * 0.02 * 1.2), pointsUsed: 0, items: cart.items, createdAt: new Date().toISOString() });
});

const steps = [];
let n = 0;
async function snap(label) {
  await page.waitForTimeout(900);
  const f = path.join(OUT, `${engine}-${mode}-${String(n).padStart(2, '0')}.png`);
  await page.screenshot({ path: f });
  steps.push({ n, label, url: await page.evaluate(() => location.pathname + location.search), shot: path.relative(ROOT, f) });
  n++;
}
async function tap(label, locator) {
  const box = await locator.boundingBox();
  await locator.click({ timeout: 10000 });
  steps.push({ tap: label, box: box && { w: Math.round(box.width), h: Math.round(box.height), y: Math.round(box.y) } });
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await snap(`sau chạm: ${label}`);
}

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1500);
await snap('Trang chủ');
// Thẻ SP là <button aria-label={tên}> phủ cả thẻ (stretched link). Kệ "Mua lại"/giờ vàng của bộ chụp là SP giả (slug không có
// trong DB) nên chọn thẻ đầu tiên mang tên SP thật (kệ Bán chạy, dữ liệu API UAT); cuộn tới đó không tính là chạm.
const names = new Set(products.map((p) => p.name));
const cards = page.locator('button[aria-describedby]');
let pick = null;
for (let i = 0; i < Math.min(await cards.count(), 60); i++) {
  if (names.has(await cards.nth(i).getAttribute('aria-label'))) {
    pick = cards.nth(i);
    break;
  }
}
const scrolled = pick ? await pick.evaluate((el) => { const y = el.getBoundingClientRect().top; el.scrollIntoView({ block: 'center' }); return Math.round(y); }) : null;
steps.push({ note: `thẻ SP thật đầu tiên ở y=${scrolled}px (cuộn, không tính chạm)` });
await tap('thẻ sản phẩm', pick ?? cards.first());
if (mode === 'buynow') {
  await tap('Mua ngay', page.getByRole('button', { name: /Mua ngay/ }).first());
} else {
  await tap('Thêm vào giỏ', page.getByRole('button', { name: /Thêm vào giỏ/ }).first());
  await tap('icon giỏ', page.getByRole('button', { name: /giỏ/i }).or(page.locator('a[href="/cart"]')).first());
  await tap('Thanh toán', page.getByRole('button', { name: /Thanh toán/ }).first());
}
// COD đã được chọn sẵn? Ghi nhận trạng thái radio rồi mới bấm đặt.
const codChecked = await page.getByRole('radio', { name: /COD|khi nhận hàng/ }).first().isChecked().catch(() => null);
steps.push({ note: `COD chọn sẵn: ${codChecked}` });
if (codChecked === false) await tap('chọn COD', page.getByRole('radio', { name: /COD|khi nhận hàng/ }).first());
await tap('Đặt hàng', page.getByRole('button', { name: /Đặt hàng/ }).first());
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 600));
const taps = steps.filter((s) => s.tap).length;
const out = { engine, mode, taps, steps, finalText: bodyText };
fs.writeFileSync(path.join(OUT, `flow-${engine}-${mode}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ engine, mode, taps, final: steps.at(-1)?.url, finalText: bodyText.slice(0, 200) }));
router.dispose();
await browser.close();
