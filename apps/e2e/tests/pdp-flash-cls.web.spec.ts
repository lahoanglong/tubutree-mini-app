import { test, expect } from './support/mock-api';
import { observeCls, readClsTotal } from './support/cls-observer';
import { removeFlashPdp, seedFlashPdp, type FlashPdp } from './support/pdp-flash-db';

/**
 * Web, trang sản phẩm đang trong Giờ vàng: thanh Giờ vàng dưới ảnh, giá và "Đã bán" đã có trong HTML server (trang tải sẵn danh sách Giờ vàng),
 * nên danh sách về ở trình trình duyệt sau hydrate không chèn thanh hay đổi dòng giá. Phần server gọi API thật (DB tạm có đợt Giờ vàng gieo ở đây);
 * mọi lời gọi từ trình duyệt đi qua mock, trả cùng đợt đó.
 */
const CLS_MAX = 0.02;
const HOUR = 3_600_000;
let flash: FlashPdp | null = null;

// Các ca dùng chung một đợt Giờ vàng gieo vào DB tạm, và bản dựng sẵn của trang chỉ đúng khi không ai xoá/gieo lại giữa chừng: chạy tuần tự trong một worker, và chỉ ở project desktop
// (khung nhìn tự đặt trong từng ca). Project Mobile chạy cùng tệp ở worker khác sẽ gieo/xoá cùng phân loại song song, rồi một lần dựng lại có thể cache danh sách rỗng.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }, testInfo) => {
  test.setTimeout(240_000);
  if (testInfo.project.name !== 'Web Customer') return;
  flash = await seedFlashPdp(request);
  if (!flash) return;
  // Bản server của Next giữ danh sách Giờ vàng trong bộ nhớ đệm fetch tới 60 giây (Trang chủ của spec trước đã gọi cùng đường), và trang chi tiết dựng lại sau tối đa 60 giây.
  // Cả hai đều trả bản cũ rồi mới làm mới ở nền, nên lần dựng lại đầu tiên có thể vẫn đọc danh sách cũ: tệ nhất khoảng 3 phút (60 giây fetch + hai lượt dựng lại 60 giây).
  // Hỏi chính trang mỗi 5 giây tới khi HTML có thanh Giờ vàng. Đường dẫn tương đối theo baseURL của project: CI không đặt E2E_WEB_PORT (chỉ web-gate.sh đặt).
  const deadline = Date.now() + 200_000;
  let last = 'chưa hỏi lần nào';
  while (Date.now() < deadline) {
    try {
      const res = await request.get(`/san-pham/${flash.slug}`);
      if ((await res.text()).includes('flash-price-bar')) return;
      last = `HTTP ${res.status()}, HTML chưa có thanh Giờ vàng`;
    } catch (err) {
      last = `lỗi gọi trang: ${String(err)}`;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`HTML của /san-pham/${flash.slug} không có thanh Giờ vàng sau 200 giây (lần cuối: ${last}): bản dựng sẵn không thấy đợt vừa gieo`);
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  if (!flash) return;
  await removeFlashPdp(flash.saleId);
  // Bộ nhớ đệm fetch của Next còn giữ đợt này tới 60 giây: đợi hết rồi mới trả sân cho spec sau, kẻo trang dựng sẵn của chúng (Trang chủ) dựng lại trong lúc đó và nhúng khối Giờ vàng của đợt đã xoá.
  await new Promise((r) => setTimeout(r, 65_000));
});

for (const vp of [{ name: 'web375', width: 375, height: 812 }, { name: 'web1280', width: 1280, height: 800 }]) {
  test(`CLS PDP Giờ vàng ${vp.name}: thanh Giờ vàng và giá không dịch sau hydrate`, async ({ page, api }) => {
    test.skip(!flash, 'DB e2e không phải DB tạm hoặc chưa có sản phẩm để gieo đợt Giờ vàng');
    const f = flash!;
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await observeCls(page);
    api.get('/flash-sales/active', () => {
      const now = Date.now();
      return [
        {
          itemId: 'fi-cls', variationId: f.variationId, productSlug: f.slug, productName: f.name, variationName: f.variationName, thumbnail: null,
          flashPrice: f.flashPrice, retailPrice: f.retailPrice, salePrice: null, soldCount: 10, quota: 100, perUserLimit: 3,
          endAt: new Date(now + 5 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
        },
      ];
    });
    api.get('/flash-sales/me/allowance', { items: {} });
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get('/me/wishlist/ids', []);
    api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
    const p = `/products/${f.slug}`;
    api.allowUnmocked(`GET ${p}`, `GET ${p}/related`, `GET ${p}/bought-together`, `GET ${p}/bundles`, `GET ${p}/reviews`, `GET ${p}/stock`, 'GET /products', 'GET /products/for-you', 'GET /me/coupons', 'POST /events');
    await page.goto(`/san-pham/${f.slug}`);
    await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(1500);
    const { cls, sources } = await readClsTotal(page);
    test.info().annotations.push({ type: 'CLS', description: cls.toFixed(4) });
    console.log(`CLS PDP flash ${vp.name} = ${cls.toFixed(4)}\n${sources.map((s) => `  shift ${s}`).join('\n')}`);
    expect(cls).toBeLessThan(CLS_MAX);
  });
}

test('PDP Giờ vàng: điện thoại chạy nhanh 7 giờ, đợt còn chạy theo giờ thật: hydrate không lỗi và thanh Giờ vàng không bị giấu trong lúc lần hỏi danh sách chưa xong', async ({ page, api, request }) => {
  test.skip(!flash, 'DB e2e không phải DB tạm hoặc chưa có sản phẩm để gieo đợt Giờ vàng');
  const f = flash!;
  const html = await request.get(`/san-pham/${f.slug}`).then((r) => r.text());
  expect(html, 'HTML server phải đã có thanh Giờ vàng (đợt còn chạy lúc dựng)').toContain('flash-price-bar');
  // Đồng hồ treo tường của máy khách chạy trước 7 giờ, trong khi đợt gieo ở đây kết thúc sau 6 giờ: nếu mốc lọc đợt lấy theo đồng hồ điện thoại trước khi đồng bộ thì thanh bị giấu
  // rồi hiện lại khi lần hỏi đầu xong. `performance.now()` không bị đổi nên mốc đơn điệu vẫn giữ thanh.
  await page.addInitScript(() => {
    const real = Date.now.bind(Date);
    Date.now = () => real() + 7 * 3_600_000;
  });
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /hydrat|did not match|Minified React error #4(18|19|2\d)/i.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  api.get('/flash-sales/me/allowance', { items: {} });
  api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
  api.get('/me/wishlist/ids', []);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
  const p = `/products/${f.slug}`;
  api.allowUnmocked(`GET ${p}`, `GET ${p}/related`, `GET ${p}/bought-together`, `GET ${p}/bundles`, `GET ${p}/reviews`, `GET ${p}/stock`, 'GET /products', 'GET /products/for-you', 'GET /me/coupons', 'POST /events');
  // Không bao giờ trả lời danh sách Giờ vàng (đăng ký sau cùng nên thắng mock chung): lần hỏi đầu không xong thì giờ không bao giờ chuyển sang đồng hồ điện thoại.
  let activeAsked = 0;
  await page.route('**/flash-sales/active*', () => {
    activeAsked += 1;
  });
  await observeCls(page);
  await page.goto(`/san-pham/${f.slug}`);
  await expect(page.getByTestId('flash-price-bar')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2_000);
  await expect(page.getByTestId('flash-price-bar')).toBeVisible();
  expect(activeAsked, 'trình duyệt phải đã hỏi danh sách (và không nhận được trả lời nào)').toBeGreaterThan(0);
  expect(problems).toEqual([]);
  const { cls } = await readClsTotal(page);
  expect(cls).toBeLessThan(CLS_MAX);
});

// Móc `data-restore-mask` của dòng freeship (pdp-extras): HTML server đã có dòng, và lớp CSS giấu chữ chỉ có hiệu lực khi <html> có `data-restoring`.
// Tắt JavaScript để giữ nguyên HTML server (hydrate sẽ đổi pha phiên và bỏ móc), rồi đo visibility tính ra của trình duyệt chứ không đọc tên lớp.
test.describe('PDP: chữ freeship bị giấu theo data-restoring', () => {
  test.use({ javaScriptEnabled: false });
  test('HTML server: chữ hiện khi <html> chưa có data-restoring, ẩn khi có (chỗ vẫn giữ)', async ({ page, api }) => {
    test.skip(!flash, 'DB e2e không phải DB tạm hoặc chưa có sản phẩm để gieo đợt Giờ vàng');
    api.allowUnmocked('GET /products', 'GET /me/coupons', 'POST /events');
    await page.goto(`/san-pham/${flash!.slug}`);
    const line = page.getByTestId('pdp-freeship');
    await expect(line).toHaveAttribute('data-restore-mask', 'restoring');
    await expect(line).toHaveCSS('visibility', 'visible');
    const box = await line.boundingBox();
    await page.evaluate(() => document.documentElement.setAttribute('data-restoring', ''));
    await expect(line).toHaveCSS('visibility', 'hidden');
    expect((await line.boundingBox())?.height).toBe(box?.height);
  });
});
