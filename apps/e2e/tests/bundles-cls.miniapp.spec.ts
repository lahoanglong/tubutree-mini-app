import type { Page } from '@playwright/test';
import { test, expect } from './support/mock-api';
import { CATALOG, NRC, XA_PHONG, mockDiscovery, productDetail, toCard } from './support/discovery-mocks';
import { publicConfig } from './support/checkout-mocks';
import { PDP_SLUG, homeCombos, mockPdpBundles, pdpAddon, pdpCombo } from './support/bundle-mocks';
import { HOME_PUBLIC, mockMergedHome } from './support/home-merged';
import { reply, type MockApi } from './support/mock-api';

const PDP_BUNDLES_WAIT_MS = 300; // khớp apps/miniapp/src/components/product/use-product-bundles.ts

/**
 * Zalo Mini App E2E — Combo ưu đãi, Mua kèm (trang sản phẩm) và Combo tiết kiệm (Trang chủ) không làm trang xê dịch (gói P15). Dự án Mini chạy WebKit,
 * không có PerformanceObserver 'layout-shift', nên spec này ép Chromium để đo CLS thật. API mock toàn bộ; không dùng waitForTimeout.
 */
test.use({ browserName: 'chromium', viewport: { width: 375, height: 812 } });

async function trackLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __shifts: string[] };
    w.__cls = 0;
    w.__shifts = [];
    type Rect = { x: number; y: number; width: number; height: number };
    type Src = { node: Node | null; previousRect: Rect; currentRect: Rect };
    const describe = (n: Node | null): string => {
      const el = n instanceof Element ? n : n?.parentElement;
      if (!el) return '?';
      const id = el.getAttribute('data-testid');
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
    };
    const box = (r: Rect): string => `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number; startTime: number; sources: Src[] }[]) {
        if (e.hadRecentInput) continue;
        w.__cls += e.value;
        w.__shifts.push(`${e.value.toFixed(4)} @${Math.round(e.startTime)}ms ` + e.sources.map((s) => `${describe(s.node)} ${box(s.previousRect)} -> ${box(s.currentRect)}`).join(' | '));
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}
test.beforeEach(async ({ page }) => {
  const rate = Number(process.env.E2E_CPU_THROTTLE ?? 1);
  if (rate > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate });
});

/**
 * Sản phẩm trả sau cấu hình công khai, Giờ vàng và đánh giá. Trang chèn dòng Vận chuyển (ngưỡng freeship) và các dòng phụ khi những dữ liệu ấy về;
 * trên máy chậm chúng về sau sản phẩm nên trang xê dịch ~76px, không liên quan tới Combo/Mua kèm mà spec này đo. Cho chúng về trước thì CLS
 * chỉ còn phần do khối bộ gây ra, không phụ thuộc tốc độ máy.
 * Phông chữ chỉ được tải khi có chữ dùng tới, mà khung chờ không có chữ: trên CI (Linux) sản phẩm vẽ chữ lần đầu bằng phông dự phòng rộng hơn rồi
 * đổi sang Inter/Fraunces (font-display: swap), tiêu đề từ 2 dòng thành 1 dòng, CLS ~0,023 không liên quan bộ. Giữ sản phẩm tới khi phông đã tải,
 * như khách đã có phông trong bộ nhớ đệm, để CLS chỉ còn phần của khối bộ.
 */
function auxiliaryBeforeProduct(api: MockApi, page: Page): Promise<void> {
  let markProductServed!: () => void;
  const productServed = new Promise<void>((resolve) => (markProductServed = resolve));
  const served = new Set<string>();
  let release!: () => void;
  const auxReady = new Promise<void>((resolve) => (release = resolve));
  const serve = (pattern: string, data: unknown): void => {
    api.get(pattern, () => {
      setTimeout(() => {
        served.add(pattern);
        if (served.size === 3) setTimeout(release, 50);
      }, 0);
      return data;
    });
  };
  serve('/config/public', publicConfig());
  serve('/flash-sales/active', []);
  serve('/products/:slug/reviews', { average: 0, count: 0, items: [] });
  api.get('/products/:slug', async ({ params }) => {
    // Hạn dự phòng tính từ lúc request sản phẩm tới (không phải lúc test bắt đầu): thiếu request phụ thì báo rõ thay vì để heading timeout.
    let guard: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      guard = setTimeout(() => {
        api.handlerErrors.push(`thiếu request phụ: ${['/config/public', '/flash-sales/active', '/products/:slug/reviews'].filter((p) => !served.has(p)).join(', ')}`);
        resolve();
      }, 5_000);
    });
    await Promise.race([auxReady.then(() => page.waitForFunction(() => document.fonts.size > 0 && Promise.allSettled([...document.fonts].map((f) => f.load())).then(() => true))), timedOut]);
    clearTimeout(guard);
    markProductServed();
    return productDetail(params.slug!) ?? reply(404, { statusCode: 404, message: 'Không tìm thấy sản phẩm.' });
  });
  return productServed;
}

const shiftLog = (page: Page): Promise<string> => page.evaluate(() => ((window as unknown as { __shifts: string[] }).__shifts ?? []).join('\n'));
const readCls = async (page: Page): Promise<number> => {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
};

test.describe('Trang sản phẩm Mini: CLS', () => {
  let productServed: Promise<void>;
  test.beforeEach(({ api, page }) => {
    mockDiscovery(api);
    productServed = auxiliaryBeforeProduct(api, page);
  });

  test('không có bộ nào: không có khối, CLS 0 (nền để so)', async ({ page }) => {
    await trackLayoutShift(page);
    await page.goto(`/product/${PDP_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: NRC.name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pdp-bundle-slots')).toHaveCount(0);
    const cls = await readCls(page);
    expect(cls, `CLS ${cls.toFixed(4)}\n${await shiftLog(page)}`).toBeLessThanOrEqual(0.02);
  });

  test('bộ về sau sản phẩm, trước khi hết PDP_BUNDLES_WAIT_MS (hạn kéo dài): khung chờ giữ tới khi bộ về, khối vào cùng lần vẽ đầu (CLS ≤ 0,02)', async ({ page, api }) => {
    // Hạn chờ 300ms là đồng hồ thật nên máy chậm làm bộ "về trễ quá hạn" và CLS tăng dù mã đúng. Kéo hạn đó ra 20 lần chỉ trong trang này:
    // tốc độ máy không còn quyết định, còn mã bỏ khung chờ vẫn đỏ vì khối chèn vào sau lần vẽ đầu. Hành vi "hết hạn thì thôi chờ" do vitest của hook phủ.
    await page.addInitScript((waitMs) => {
      const native = window.setTimeout.bind(window);
      window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => native(fn, ms === waitMs ? waitMs * 20 : ms, ...args)) as typeof window.setTimeout;
    }, PDP_BUNDLES_WAIT_MS);
    mockPdpBundles(api, { combos: [pdpCombo()], addons: [pdpAddon()], hold: productServed, delayMs: 50 });
    await trackLayoutShift(page);
    await page.goto(`/product/${PDP_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: NRC.name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pdp-combos')).toBeVisible();
    await expect(page.getByTestId('pdp-addons')).toBeVisible();
    const cls = await readCls(page);
    expect(cls, `CLS ${cls.toFixed(4)}\n${await shiftLog(page)}`).toBeLessThanOrEqual(0.02);
  });
});

test.describe('Trang sản phẩm Mini: bộ tắt khi khách đang ở trang', () => {
  test.beforeEach(({ api }) => mockDiscovery(api));

  test('hai khối ở nguyên chỗ, ghi "Đã kết thúc", mờ; khung khối không đổi kích thước nên phần bên dưới không xê dịch', async ({ page, api }) => {
    const bundles = { combos: [pdpCombo()], addons: [pdpAddon()] };
    mockPdpBundles(api, bundles);
    await page.clock.install(); // đẩy giờ qua hạn "tươi" 30 giây của truy vấn, không phải chờ thật
    await page.goto(`/product/${PDP_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: NRC.name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pdp-combos')).toBeVisible();
    await expect(page.getByTestId('pdp-addons')).toBeVisible();
    const slots = page.getByTestId('pdp-bundle-slots');
    await page.waitForLoadState('networkidle');
    // Chiều cao khối và khoảng từ đáy khối tới phần tử kế bên dưới: hai số này đổi thì phần dưới đã xê dịch (vị trí tuyệt đối còn phụ thuộc phần trên trang).
    const measure = () =>
      slots.evaluate((el) => {
        const next = el.nextElementSibling;
        const box = el.getBoundingClientRect();
        return { height: box.height, gapBelow: next ? next.getBoundingClientRect().top - box.bottom : null };
      });
    const before = await measure();
    expect(before.gapBelow, 'có phần tử bên dưới để so').not.toBeNull();

    // Khách ra Trang chủ rồi quay lại sau hơn 30 giây (dữ liệu cũ đã "ôi"): trang vẽ ngay từ bộ nhớ đệm, lần tải lại ngầm thì bộ đã tắt.
    await page.evaluate(() => {
      history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByTestId('pdp-bundle-slots')).toHaveCount(0);
    await page.clock.fastForward(60_000);
    bundles.combos = [];
    bundles.addons = []; // bộ vừa tắt: lần tải lại sau đây không còn trả bộ nào
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: NRC.name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pdp-combos')).toHaveAttribute('aria-label', 'Combo ưu đãi · Đã kết thúc');
    await expect(page.getByTestId('pdp-addons')).toHaveAttribute('aria-label', 'Mua kèm giá tốt · Đã kết thúc');
    expect(api.callsTo('GET', '/products/:slug/bundles').length).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('bundle-ended')).toHaveCount(2);

    await page.waitForLoadState('networkidle');
    expect(await measure()).toEqual(before);
    // Nội dung vẫn hiện (mờ) nhưng ẩn khỏi cây truy cập và không bấm được, nên chỉ tìm được khi tính cả phần tử ẩn.
    await expect(page.getByRole('button', { name: /^Thêm cả combo/, includeHidden: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Thêm cả combo/ })).toHaveCount(0);
  });
});

/** Mở Trang chủ bằng request gộp `/home` (đường chạy thật), đo CLS; có combo hay không là biến duy nhất giữa hai ca. */
function mockMergedHomeWith(api: MockApi, combos: unknown[]): void {
  mockDiscovery(api, { returning: true });
  mockMergedHome(api);
  api.get('/home', { ...HOME_PUBLIC, combos });
}

test.describe('Trang chủ Mini: CLS của kệ Combo tiết kiệm', () => {
  test.describe.configure({ mode: 'serial' });
  let baseline = 0;

  test('request gộp không có combo: đo CLS nền', async ({ page, api }) => {
    mockMergedHomeWith(api, []);
    await trackLayoutShift(page);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Danh mục', exact: true }).getByText('Danh mục gộp')).toBeVisible({ timeout: 15_000 });
    baseline = await readCls(page);
    expect(baseline, `CLS nền ${baseline.toFixed(4)}`).toBeLessThanOrEqual(0.1);
  });

  test('request gộp có 2 combo: kệ hiện từ chính request gộp (không gọi /bundles/combos) và CLS không tăng quá 0,01 so với nền', async ({ page, api }) => {
    mockMergedHomeWith(api, homeCombos());
    await trackLayoutShift(page);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Combo tiết kiệm', exact: true })).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    expect(api.callsTo('GET', '/bundles/combos')).toHaveLength(0);
    const cls = await readCls(page);
    expect(cls, `CLS ${cls.toFixed(4)} so với nền ${baseline.toFixed(4)}`).toBeLessThanOrEqual(baseline + 0.01);
  });

  test('Bán chạy nhất có món của combo (cùng request gộp): kệ không còn món ấy và CLS ≤ 0,02 (món không hiện rồi biến mất: vitest use-home-shelves giữ)', async ({ page, api }) => {
    mockMergedHomeWith(api, homeCombos());
    api.get('/home', {
      ...HOME_PUBLIC,
      combos: homeCombos(),
      bestSellers: { data: CATALOG.slice(0, 8).map(toCard), meta: { page: 1, limit: 12, total: 8 } },
    });
    await trackLayoutShift(page);
    await page.goto('/');
    const best = page.getByRole('region', { name: 'Bán chạy nhất', exact: true });
    await expect(best).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Combo tiết kiệm', exact: true })).toBeVisible();
    await expect(best.getByText(XA_PHONG.name)).toHaveCount(0);
    expect(api.callsTo('GET', '/bundles/combos')).toHaveLength(0);
    const cls = await readCls(page);
    expect(cls, `CLS ${cls.toFixed(4)}\n${await shiftLog(page)}`).toBeLessThanOrEqual(0.02);
  });
});
