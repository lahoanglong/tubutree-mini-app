import { expect, test, type Page } from '@playwright/test';
import { solidPng } from './support/noise-png';
import { assertProductOnCi, firstProduct } from './support/pdp-product';

/**
 * Luồng lõi của web khách ở đúng hai khổ chuẩn: 390×844 (project "Web Core 390") và 1440×900 ("Web Core 1440"). Project "Web Customer Mobile"
 * chạy Pixel 7 (412px) và "Web Customer" chạy 1280px nên không đo hai khổ này. Khách vãng lai, chưa đăng nhập: máy chủ Next và trình duyệt cùng gọi
 * API thật trên DB tạm của web-gate.sh, không mock; chỉ ảnh được thay bằng PNG một màu vì ảnh nguồn nằm ở mạng ngoài.
 * Mỗi trang, sau khi cuộn hết để các khối tải muộn hiện ra:
 * - không cuộn ngang (`scrollWidth <= clientWidth` của cả trang và body);
 * - không lỗi console, không lỗi JS chưa bắt (lỗi hydrate, tài nguyên 4xx/5xx đều hiện thành lỗi console);
 * - mọi nút chính đang hiện (xem PRIMARY) cao và rộng từ 44px.
 */
const SIZES: Record<string, { width: number; height: number }> = {
  'Web Core 390': { width: 390, height: 844 },
  'Web Core 1440': { width: 1440, height: 900 },
};

const ROUTES = ['/', '/san-pham', '/san-pham/[slug]', '/gio-hang', '/thanh-toan', '/vuon-xanh', '/doi-rac'] as const;

/**
 * Nút chính: Button primary của DS (`zaui-btn-primary`), nút mua ở khối kể chuyện PDP, và nút/liên kết nền màu hành động chính (`ui.btnPrimary` = bg-forest-600,
 * hoặc token `--color-action-primary-bg`). Chỉ tính phần tử có nhãn chữ: chấm, biểu tượng nền xanh không phải nút chính.
 */
const PRIMARY = [
  '.zaui-btn-primary',
  '.tubu-story-btn-primary',
  'a.bg-forest-600',
  'button.bg-forest-600',
  'a[class*="--color-action-primary-bg"]',
  'button[class*="--color-action-primary-bg"]',
].join(', ');
const MIN_PRIMARY = 44;

/**
 * API báo tính năng đang tắt bằng 404 (GET /game/mini/today khi cờ game mini tắt, như DB tạm của web-gate); trình duyệt vẫn ghi lỗi tải tài nguyên
 * vào console. Chỉ miễn đúng 404 của các đường này, mọi lỗi khác vẫn đỏ.
 */
const FEATURE_OFF_404 = [/\/api\/game\/mini\/today(\?|$)/];
const featureOff404 = (status: number, url: string) => status === 404 && FEATURE_OFF_404.some((re) => re.test(url));

const IMAGE_PNG = solidPng(150, 60, [47, 107, 79]);
const isServedImage = (url: URL) => url.pathname === '/api/img' || url.pathname.startsWith('/api/public-image/');

interface PageFacts {
  docOverflow: number;
  bodyOverflow: number;
  wide: string[];
  primaries: { label: string; width: number; height: number }[];
}

/** Cuộn từng khung tới cuối trang để khối tải muộn (dynamic, IntersectionObserver) dựng xong, rồi về đầu trang. */
async function scrollThrough(page: Page): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    const done = await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
      return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    });
    await page.waitForTimeout(150);
    if (done) break;
  }
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function factsOf(page: Page): Promise<PageFacts> {
  return page.evaluate(
    ({ primarySel }) => {
      const doc = document.documentElement;
      const vw = doc.clientWidth;
      const label = (el: Element): string => {
        const id = el.getAttribute('data-testid');
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32);
        return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''} "${name}"`;
      };
      const shown = (el: Element): boolean => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 1 && r.height > 1 && !el.closest('[aria-hidden="true"], [hidden], [inert]');
      };
      // Phần tử thò ra mép phải của khung (thủ phạm cuộn ngang). Bỏ qua phần tử nằm trong khối tự cuộn ngang hay cắt tràn (kệ ngang, băng chuyền).
      const clipsX = (el: Element): boolean => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
        }
        return false;
      };
      const wide: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.right <= vw + 1 || getComputedStyle(el).position === 'fixed') continue;
        if (clipsX(el) || !shown(el)) continue;
        wide.push(`${label(el)} phải ${Math.round(r.right)} > ${vw}`);
        if (wide.length >= 8) break;
      }
      const primaries = Array.from(document.querySelectorAll(primarySel))
        .filter((el) => shown(el) && (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().length >= 2)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { label: label(el), width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
        });
      return {
        docOverflow: doc.scrollWidth - doc.clientWidth,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        wide,
        primaries,
      };
    },
    { primarySel: PRIMARY },
  );
}

for (const route of ROUTES) {
  test(`luồng lõi ${route}: không cuộn ngang, không lỗi console, nút chính ≥ 44px`, async ({ page, request }, testInfo) => {
    const size = SIZES[testInfo.project.name];
    test.skip(!size, 'chỉ chạy ở hai project khổ chuẩn Web Core 390 / Web Core 1440');
    expect(page.viewportSize(), 'khổ của project').toEqual(size);

    let path: string = route;
    if (route === '/san-pham/[slug]') {
      const product = await firstProduct(request);
      assertProductOnCi(product, 'sản phẩm cho PDP');
      test.skip(!product, 'API/DB e2e chưa có sản phẩm');
      path = `/san-pham/${product!.slug}`;
    }

    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/status of 404\b/.test(m.text()) && featureOff404(404, m.location().url)) return;
      errors.push(`console: ${m.text().slice(0, 300)} @ ${m.location().url}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
    page.on('response', (r) => {
      if (r.status() >= 400 && !featureOff404(r.status(), r.url())) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
    });

    await page.route(isServedImage, (r) => r.fulfill({ contentType: 'image/png', body: IMAGE_PNG }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const res = await page.goto(path);
    expect(res?.status(), `${path} trả về`).toBeLessThan(400);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
    await scrollThrough(page);
    await page.waitForTimeout(400);

    const f = await factsOf(page);
    console.log(`CORE_FLOW ${testInfo.project.name} ${path} tràn=${f.docOverflow} lỗi=${errors.length} nút chính=${f.primaries.map((b) => `${b.width}×${b.height}`).join(',') || 'không có'}`);
    await testInfo.attach('facts.json', { body: JSON.stringify({ path, url: page.url(), ...f, errors }, null, 2), contentType: 'application/json' });

    expect.soft(f.docOverflow, `cuộn ngang ở ${path}: ${f.wide.join('; ')}`).toBeLessThanOrEqual(0);
    expect.soft(f.bodyOverflow, `body rộng hơn khung ở ${path}`).toBeLessThanOrEqual(0);
    expect.soft(errors, `lỗi console / JS / HTTP ở ${path}`).toEqual([]);
    const small = f.primaries.filter((b) => b.width < MIN_PRIMARY || b.height < MIN_PRIMARY);
    expect.soft(small, `nút chính dưới ${MIN_PRIMARY}×${MIN_PRIMARY}px ở ${path}`).toEqual([]);
  });
}

test('bản dựng sẵn cho khách: HTML đầu của /vuon-xanh và /gio-hang là giao diện khách qua middleware; có cookie phiên thì là bản thường', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Core 390', 'chỉ đọc HTML, không phụ thuộc khổ: chạy một lần');
  const html = async (path: string, cookie?: string) => (await request.get(path, { headers: cookie ? { cookie } : {} })).text();

  expect(await html('/vuon-xanh')).toContain('data-testid="garden-guest-preview"');
  expect(await html('/vuon-xanh', 'tubu_web_session=1')).not.toContain('data-testid="garden-guest-preview"');

  // Bản khách của giỏ là giỏ trống (cờ giỏ khách bật) hoặc tường đăng nhập (cờ tắt, như DB e2e); bản thường là khung chờ khôi phục phiên.
  const guestCart = /Giỏ còn trống|Đăng nhập để xem giỏ hàng/;
  expect(await html('/gio-hang')).toMatch(guestCart);
  expect(await html('/gio-hang', 'tubu_web_session=1')).not.toMatch(guestCart);
  expect(await html('/gio-hang', 'tubu_guest_cart=1')).not.toMatch(guestCart);

  const direct = await request.get('/gio-hang/khach?from=zalo', { maxRedirects: 0 });
  expect(direct.status()).toBe(308);
  expect(direct.headers()['location']).toMatch(/\/gio-hang\?from=zalo$/);
});
