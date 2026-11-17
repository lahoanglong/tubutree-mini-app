import { test, type MockApi } from './support/mock-api';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { assertSeededOnCi } from './support/a11y-db';
import { observeCls, readClsTotal } from './support/cls-observer';
import { solidPng } from './support/noise-png';
import { probeTapTargets } from './support/touch-probe';
import { seedTourPublicData } from './support/tour-db';
import { mockTourWorld, tourUser } from './support/tour-world';

/**
 * Wave tubu-nav-merge, nhánh D (web): chân trang không bị đẩy trong tầm nhìn khi nội dung thay khung chờ (CLS ≤ 0,1 ở /mua-chung, /gio-vang, /kho-qua,
 * 390×844 và 1440×900, khách mới bộ nhớ trống, 3 lần lấy trung vị), trang ngắn không có khoảng trắng vô lý trước chân trang, canonical của hai landing,
 * vùng chạm chip ở Trang chủ và link Điều khoản/Bảo mật ở /dang-nhap, chữ ≥ 12px ở /cau-chuyen, bóng gợi ý Vườn Xanh không đè tiêu đề kệ.
 * Dữ liệu trình duyệt mock (API về trễ như PROD để khung chờ hiện); Trang chủ dựng phía máy chủ từ DB e2e đã seed như w182-acceptance.
 */
const CLS_MAX = 0.1;
/** API về sau chừng này: đủ để khung chờ vẽ xong rồi mới bị thay, như PROD ở mạng điện thoại (nội dung chính hiện sau FCP ~1,7 giây). */
const SLOW_MS = 700;
const RUNS = 3;
const HINT_KEY = 'tubu_garden_hint_seen';

const later = <T>(value: T, ms = SLOW_MS) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

/** Khổ theo project: điện thoại 390×844 ở "Web Customer Mobile", máy tính 1440×900 ở "Web Customer" (cùng hai khổ đo PROD trong review). */
const viewportOf = (project: string) => (project === 'Web Customer Mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
const runsHere = (project: string) => project === 'Web Customer' || project === 'Web Customer Mobile';

/** Như PROD 17/11: danh sách nhóm rỗng, 8 món bán chạy (kệ mở nhóm lấy 6 món Tubu giao còn hàng). */
const STARTERS = Array.from({ length: 8 }, (_, i) => ({
  id: `p-start-${i + 1}`,
  slug: `nuoc-rua-chen-fuwa3e-${i + 1}`,
  brand: 'Fuwa3e',
  name: `Nước rửa chén sinh học Fuwa3e loại ${i + 1}`,
  thumbnail: null,
  basePrice: 125_000,
  salePrice: 109_000,
  isFeatured: false,
  inStock: true,
  fulfiller: { kind: 'TUBU', name: 'Tubu Tree', shippingFee: 0, freeShipFrom: 0 },
}));

/** Như PROD 17/11: khách chưa đăng nhập xem 8 quà đổi bằng Điểm Xanh. */
const PREVIEW = {
  rewards: Array.from({ length: 8 }, (_, i) => ({
    id: `reward-${i + 1}`,
    kind: 'VOUCHER',
    name: `Mã giảm ${(i + 1) * 10}.000đ`,
    description: 'Đơn từ 199.000đ',
    label: null,
    pointsCost: (i + 1) * 5000,
    imageUrl: null,
    stockRemaining: null,
    soldOut: false,
    canRedeem: false,
    claimInstructions: null,
    voucher: { type: 'FIXED', value: (i + 1) * 10_000, minOrder: 199_000, maxDiscount: null, validDays: 30 },
    sortOrder: i + 1,
  })),
  giftClaimDays: 60,
  claimPoint: null,
  tiers: [{ id: 'MAM_XANH', name: 'Mầm Xanh', minPoints: 0, minSpending: null, multiplier: 1, perks: ['Quà sinh nhật'] }],
  rates: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1, maxRedeemPct: 0.2 },
  pointExpireMonths: 12,
};

interface ClsPage {
  path: string;
  mock: (api: MockApi) => void;
  ready: (page: Page) => Locator;
}

const CLS_PAGES: ClsPage[] = [
  {
    path: '/mua-chung',
    mock: (api) => {
      api.get('/group-buy', () => later([]));
      api.get('/products', () => later({ data: STARTERS, meta: { page: 1, limit: 8, total: STARTERS.length } }));
    },
    ready: (page) => page.getByTestId('group-buy-starter-shelf'),
  },
  {
    // PROD 17/11: không có khung giờ nào (trạng thái rỗng). Có khung giờ và món thì gio-vang-cls.web.spec đã giữ.
    path: '/gio-vang',
    mock: (api) => {
      api.get('/flash-sales/slots', () => later({ serverNow: new Date().toISOString(), slots: [] }));
      api.get('/categories', []);
    },
    ready: (page) => page.getByText('Chưa có Giờ vàng lúc này'),
  },
  {
    path: '/kho-qua',
    mock: (api) => {
      api.get('/loyalty/preview', () => later(PREVIEW));
    },
    ready: (page) => page.getByText('Mã giảm 80.000đ'),
  },
];

/** Một lần tải như khách mới: xoá cookie và bộ nhớ của lần trước, tải trang, chờ trạng thái cuối, đọc tổng layout-shift (không tính dịch do thao tác). */
async function loadOnce(page: Page, path: string, ready: (page: Page) => Locator): Promise<{ cls: number; sources: string[] }> {
  await page.context().clearCookies();
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // trang trắng ban đầu không có bộ nhớ
    }
  });
  await page.goto(path);
  await expect(ready(page).first()).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
  await page.waitForTimeout(800);
  return readClsTotal(page);
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

for (const p of CLS_PAGES) {
  test(`CLS ${p.path}: khách mới, khung chờ rồi nội dung về trễ, trung vị ${RUNS} lần ≤ ${CLS_MAX}`, async ({ page, api }, testInfo) => {
    test.skip(!runsHere(testInfo.project.name), 'chỉ hai project web khách');
    const vp = viewportOf(testInfo.project.name);
    await page.setViewportSize(vp);
    await observeCls(page);
    p.mock(api);
    const runs: { cls: number; sources: string[] }[] = [];
    for (let i = 0; i < RUNS; i += 1) runs.push(await loadOnce(page, p.path, p.ready));
    const values = runs.map((r) => r.cls);
    const mid = median(values);
    const line = `NAV_MERGE_CLS ${p.path} ${vp.width}x${vp.height} median=${mid.toFixed(4)} runs=[${values.map((v) => v.toFixed(4)).join(', ')}]`;
    console.log(`${line}\n${runs.flatMap((r) => r.sources).map((s) => `  shift ${s}`).join('\n')}`);
    testInfo.annotations.push({ type: 'CLS', description: line });
    expect(mid, `${line} ${runs.flatMap((r) => r.sources).join(' ; ')}`).toBeLessThanOrEqual(CLS_MAX);
  });
}

/** Chân trang đang hiện ở khổ này (máy tính: chân trang đầy đủ; điện thoại: chân trang gọn, có thể bị ẩn bởi thanh dính). */
async function footerGeometry(page: Page) {
  return page.evaluate(() => {
    const footer = Array.from(document.querySelectorAll('footer')).find((f) => getComputedStyle(f).display !== 'none' && f.getBoundingClientRect().height > 0);
    const wrap = document.getElementById('main-content');
    const contentBottom = wrap ? Math.max(0, ...Array.from(wrap.children).map((c) => c.getBoundingClientRect().bottom + window.scrollY)) : 0;
    return {
      footerTop: footer ? Math.round(footer.getBoundingClientRect().top + window.scrollY) : null,
      contentBottom: Math.round(contentBottom),
      viewport: window.innerHeight,
    };
  });
}

/**
 * Trang ngắn (giỏ trống của khách, Đổi rác của khách): chân trang không nằm trong màn đầu để rồi bị đẩy, và cũng không bị đẩy xa vô lý:
 * nó bắt đầu ngay dưới mép màn đầu (hay ngay dưới nội dung nếu nội dung dài hơn), chỉ cách bằng lề trên của chính nó.
 */
for (const path of ['/gio-hang', '/doi-rac']) {
  test(`trang ngắn ${path}: chân trang ngay dưới mép màn đầu, không nhảy, không khoảng trắng thừa`, async ({ page, api }, testInfo) => {
    test.skip(!runsHere(testInfo.project.name), 'chỉ hai project web khách');
    const vp = viewportOf(testInfo.project.name);
    await page.setViewportSize(vp);
    await observeCls(page);
    api.get('/config/public', { waste: { enabled: true, dropoff: true, mailin: true, pickup: false } });
    api.allowUnmocked('GET /waste/items', 'GET /waste/points', 'GET /waste/desk/points', 'GET /waste/rules', 'GET /waste/catalogue');
    await page.goto(path);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
    await page.waitForTimeout(800);
    const { cls, sources } = await readClsTotal(page);
    const g = await footerGeometry(page);
    console.log(`NAV_MERGE_SHORT ${path} ${vp.width}x${vp.height} cls=${cls.toFixed(4)} ${JSON.stringify(g)}`);
    expect(cls, `CLS ${sources.join(' ; ')}`).toBeLessThanOrEqual(CLS_MAX);
    if (g.footerTop === null) return;
    expect(g.footerTop, 'chân trang nằm ngoài màn đầu').toBeGreaterThanOrEqual(g.viewport);
    // Lề trên của chân trang là 32px (điện thoại) hay 48px (máy tính); thêm 16px cho làm tròn.
    expect(g.footerTop - Math.max(g.viewport, g.contentBottom), 'khoảng trắng trước chân trang').toBeLessThanOrEqual(64);
  });
}

test.describe('canonical của landing công khai', () => {
  const canonicalOf = async (request: APIRequestContext, path: string) => {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const html = await res.text();
    return [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
  };

  for (const path of ['/doi-rac', '/vuon-xanh']) {
    test(`${path} có đúng một <link rel="canonical"> trỏ chính nó`, async ({ request }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer', 'HTML máy chủ như nhau ở mọi khổ');
      const links = await canonicalOf(request, path);
      expect(links).toHaveLength(1);
      expect(new URL(links[0]!).pathname).toBe(path);
    });
  }

  for (const path of ['/doi-rac/tao', '/vuon-xanh/choi/daily_quiz']) {
    test(`${path} (trang con noindex) không kế thừa canonical của landing`, async ({ request }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer', 'HTML máy chủ như nhau ở mọi khổ');
      expect(await canonicalOf(request, path)).toEqual([]);
    });
  }
});

test.describe('Trang chủ 390px (dữ liệu máy chủ từ DB e2e)', () => {
  test.beforeAll(async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        assertSeededOnCi(await seedTourPublicData());
        return;
      } catch (e) {
        if (attempt >= 4 || !/40P01|deadlock/i.test(String(e))) throw e;
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      }
    }
  });

  const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
  const IMAGE_PNG = solidPng(150, 60, [47, 107, 79]);

  /** Khách vãng lai; `?hint=1` thì bóng gợi ý Vườn Xanh chưa xem (bộ nhớ trống), không thì coi như đã xem để đo Trang chủ yên. */
  async function openHome(page: Page, api: MockApi, request: APIRequestContext, size: { width: number; height: number }, hint: boolean) {
    mockTourWorld(api, tourUser('CUSTOMER'));
    api.get('/config/public', await (await request.get(`${API_ORIGIN}/api/config/public`)).json());
    api.allowUnmocked('GET /auth/me', 'GET /me/summary', 'GET /waste/requests');
    await page.route(
      (url) => url.pathname === '/api/img' || url.pathname.startsWith('/api/public-image/'),
      (route) => route.fulfill({ contentType: 'image/png', body: IMAGE_PNG }),
    );
    await page.addInitScript((key) => {
      try {
        if (location.search.includes('hint=1')) localStorage.removeItem(key);
        else localStorage.setItem(key, '1');
      } catch {
        // không có localStorage
      }
    }, HINT_KEY);
    await page.setViewportSize(size);
    await page.goto(hint ? '/?hint=1' : '/');
    await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
  }

  const bubble = (page: Page) => page.locator('nav[aria-label="Thanh điều hướng dưới"] [role="status"]');
  /** Tiêu đề (h1–h3) nhìn thấy mà bóng đang đè. */
  const coveredHeadings = (page: Page) =>
    bubble(page).evaluate((b) => {
      const box = b.getBoundingClientRect();
      return Array.from(document.querySelectorAll('h1, h2, h3'))
        .filter((h) => {
          const r = h.getBoundingClientRect();
          return r.width > 1 && r.height > 1 && r.bottom > box.top && r.top < box.bottom && r.right > box.left && r.left < box.right;
        })
        .map((h) => (h.textContent ?? '').trim());
    });
  const hintSeen = (page: Page) => page.evaluate((key) => localStorage.getItem(key), HINT_KEY);

  test('chip lọc gợi ý: vùng chạm thật ≥ 44×44px (hộp nhìn 36px, ::after của .tubu-hit-44 giãn dọc)', async ({ page, api, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ chạm điện thoại');
    await openHome(page, api, request, { width: 390, height: 844 }, false);
    const row = page.locator('[role="region"][aria-label="Lọc gợi ý theo danh mục"]');
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator('button').first()).toBeVisible();
    const box = await row.locator('button').first().boundingBox();
    console.log(`NAV_MERGE_CHIP visual ${box?.width}x${box?.height}`);
    expect(await probeTapTargets(page, { scope: '[role="region"][aria-label="Lọc gợi ý theo danh mục"]' })).toEqual([]);
  });

  test('bóng gợi ý Vườn Xanh ở 390×844 không đè tiêu đề "Bán chạy nhất" (hay tiêu đề nào khác)', async ({ page, api, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'thanh tab đáy chỉ có dưới md');
    await openHome(page, api, request, { width: 390, height: 844 }, true);
    await page.waitForTimeout(2500);
    if (await bubble(page).isVisible()) expect(await coveredHeadings(page)).toEqual([]);
  });

  test('bóng gợi ý: chỗ bóng nổi lên có tiêu đề kệ thì chưa hiện, khách cuộn tới chỗ trống thì hiện và không đè tiêu đề', async ({ page, api, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'thanh tab đáy chỉ có dưới md');
    // Đo vị trí "Bán chạy nhất" ở khổ thường (bóng coi như đã xem), rồi chọn chiều cao màn để tiêu đề rơi đúng dải bóng nổi
    // (bóng cách mép trên thanh tab 60px thêm 26px, cao ~44px): đáy màn = tiêu đề + 100px.
    await openHome(page, api, request, { width: 390, height: 844 }, false);
    const shelf = page.getByRole('heading', { name: 'Bán chạy nhất' }).filter({ visible: true }).first();
    await expect(shelf).toBeVisible();
    const top = (await shelf.boundingBox())!.y;
    await openHome(page, api, request, { width: 390, height: Math.round(top + 100) }, true);
    await expect(shelf).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(bubble(page)).toHaveCount(0);
    expect(await hintSeen(page), 'chưa hiện thì chưa đánh dấu đã xem').toBeNull();

    let shown = false;
    for (let i = 0; i < 8 && !shown; i += 1) {
      await page.mouse.wheel(0, 140);
      await page.waitForTimeout(2200);
      shown = await bubble(page).isVisible();
      if (shown) expect(await coveredHeadings(page)).toEqual([]);
    }
    expect(shown, 'cuộn tới chỗ không có tiêu đề dưới dải bóng thì bóng hiện').toBe(true);
    expect(await hintSeen(page)).toBe('1');
  });
});

test.describe('/dang-nhap và /cau-chuyen 390px', () => {
  test('link Điều khoản và Chính sách bảo mật cao ≥ 44px, cả hộp chạm thuộc về link', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ chạm điện thoại');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dang-nhap');
    await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeVisible();
    // Đoạn đồng ý chỉ có khi đăng nhập Zalo trên web bật (bản build có NEXT_PUBLIC_ZALO_APP_ID); chân trang cũng có link "Điều khoản" nên phải tìm trong đoạn này.
    const consent = page.getByRole('main').locator('p', { hasText: 'Bằng việc đăng nhập' });
    test.skip((await consent.count()) === 0, 'Bản build không có NEXT_PUBLIC_ZALO_APP_ID: trang báo đăng nhập tạm ngưng, không có đoạn đồng ý');
    for (const name of ['Điều khoản', 'Chính sách bảo mật']) {
      const link = consent.getByRole('link', { name, exact: true });
      await expect(link).toBeVisible();
      const hit = await link.evaluate((a) => {
        // Link dài có thể xuống dòng: đo từng mảnh dòng, mảnh thấp nhất phải đủ 44px và hai mép trên/dưới (cách 2px) vẫn chạm trúng link.
        const rects = Array.from(a.getClientRects());
        const r = rects.reduce((lo, x) => (x.height < lo.height ? x : lo), rects[0]!);
        const cx = r.left + r.width / 2;
        const owns = (y: number) => {
          const el = document.elementFromPoint(cx, y);
          return !!el && (el === a || a.contains(el));
        };
        return { height: r.height, top: owns(r.top + 2), bottom: owns(r.bottom - 2) };
      });
      console.log(`NAV_MERGE_LOGIN_LINK ${name} ${JSON.stringify(hit)}`);
      expect(hit.height, name).toBeGreaterThanOrEqual(44);
      expect(hit.top && hit.bottom, `${name}: mép hộp chạm không bị phần tử khác che`).toBe(true);
    }
  });

  for (const width of [320, 360, 390]) {
    test(`/cau-chuyen ${width}px: không phần tử chữ nào nhỏ hơn 12px, nhãn bản đồ không đè nhau`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ điện thoại');
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/cau-chuyen');
      await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
      const r = await page.evaluate(() => {
        const tiny: string[] = [];
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const hasText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
          if (!hasText) continue;
          const s = getComputedStyle(el);
          const b = el.getBoundingClientRect();
          if (!b.width || s.display === 'none' || s.visibility === 'hidden') continue;
          if (el.closest('.sr-only, [aria-hidden="true"] svg')) continue;
          if (parseFloat(s.fontSize) < 12) tiny.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(' ')[0]} ${s.fontSize} "${(el.textContent ?? '').trim().slice(0, 24)}"`);
        }
        const labels = Array.from(document.querySelectorAll('.brandmap-label')).map((l) => l.getBoundingClientRect());
        const overlaps: string[] = [];
        labels.forEach((a, i) =>
          labels.slice(i + 1).forEach((b, j) => {
            if (a.bottom > b.top + 0.5 && a.top < b.bottom - 0.5 && a.right > b.left + 0.5 && a.left < b.right - 0.5) overlaps.push(`${i}×${i + j + 1}`);
          }),
        );
        return { tiny, overlaps, labels: labels.length };
      });
      console.log(`NAV_MERGE_STORY ${width} tiny=${r.tiny.length} labels=${r.labels} overlaps=${r.overlaps.length}`);
      expect(r.tiny).toEqual([]);
      expect(r.labels).toBeGreaterThan(0);
      expect(r.overlaps).toEqual([]);
    });
  }
});
