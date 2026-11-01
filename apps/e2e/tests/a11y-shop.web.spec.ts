import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { test as plain, type APIRequestContext } from '@playwright/test';
import { test, expect, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery } from './support/discovery-mocks';
import { blockingViolations, runAxe, staleBaseline } from './support/axe';
import { A11Y_BRAND_SLUG, A11Y_STOREFRONT_SLUG, assertSeededOnCi, firstPublicBrandSlug, seedDatabaseUrl, seedShopScreens } from './support/a11y-db';
import { mockFlashSlots } from './support/flash-slot-mocks';
import { mockCollectable } from './support/voucher-mocks';
import { mockBuilder, setBuilderSession } from './support/builder-web-mocks';

/**
 * Web khách, axe smoke 375px bảy màn mua sắm (bản web của a11y-shop.miniapp.spec.ts; P17b, review/a11y.md C7): Trang chủ, Danh mục (hub và danh sách), chi tiết sản phẩm,
 * gian hàng CTV, thương hiệu, Ưu đãi, Giờ vàng. WCAG AA; chỉ `serious`/`critical` chặn; vi phạm có sẵn ở support/a11y-baseline.ts kèm lý do.
 * Ưu đãi và Giờ vàng chạy hoàn toàn bằng mock phía trình duyệt. Chi tiết sản phẩm, gian hàng và thương hiệu do máy chủ web dựng từ API thật: `seedShopScreens()`
 * bảo đảm DB tạm (web-gate.sh, job CI) có thương hiệu, sản phẩm và gian hàng công khai, nên ở đó trang 404 là LỖI chứ không được bỏ qua. Chỉ khi DB không phải
 * DB tạm (máy dev chạy vào DB dùng chung) mới bỏ qua, kèm lý do; trên GitHub Actions không seed được thì beforeAll ném lỗi (assertSeededOnCi). Trang chủ và Danh mục (danh sách) đợi thẻ sản phẩm dựng xong rồi mới đo, hub Danh mục đợi nút "Xem tất cả sản phẩm": không đo khung rỗng.
 * Host phải là localhost (baseURL) vì middleware coi nhãn đầu của Host là subdomain gian hàng.
 */
test.use({ viewport: { width: 375, height: 812 } });

const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const TILE = '[data-ds="product-tile"]';
/** Nút "Lưu mã" chỉ có khi khối Nhận mã đã dựng thẻ: đợi tiêu đề khối Giờ vàng thì axe quét lúc mã chưa có. */
const VOUCHER_READY = 'button:has-text("Lưu mã")';

/** Slug của sản phẩm đầu tiên API thật trả về, hoặc null khi DB chưa có sản phẩm nào (cùng cách với pdp-mobile.web.spec.ts). */
async function firstProductSlug(request: APIRequestContext): Promise<string | null> {
  const res = await request.get(`${API_ORIGIN}/api/products?limit=1`).catch(() => null);
  if (!res?.ok()) return null;
  return ((await res.json()) as { data?: { slug: string }[] }).data?.[0]?.slug ?? null;
}

// Seed ở cả hai project web (idempotent): project "Web Customer" chạy trước "Web Customer Mobile" và shop.web.spec.ts ở đó cũng cần nhãn và gian hàng công khai.
let seeded = false;
test.beforeAll(async () => {
  seeded = await seedShopScreens();
  assertSeededOnCi(seeded);
});

const HOUR = 3_600_000;
const mockFlash = (api: MockApi): void => {
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return CATALOG.slice(4, 7).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
};

interface Screen {
  name: string;
  /** Đường dẫn; null = chưa có dữ liệu thật để mở (chỉ xảy ra khi DB không phải DB tạm, xem `seeded`). */
  path(request: APIRequestContext): Promise<string | null>;
  ready: string;
  /** Trang do máy chủ web dựng từ API thật: cần dữ liệu thật trong DB. */
  needsServerData?: boolean;
  setup(api: MockApi): void;
}

const fixed = (path: string) => async () => path;

const SCREENS: Screen[] = [
  { name: 'Trang chủ', path: fixed('/'), ready: TILE, setup: (api) => { mockDiscovery(api, { returning: true }); mockFlash(api); } },
  // Hub: kệ Bán chạy nhất do máy chủ dựng từ API thật và chỉ hiện khi có từ 3 món bán chạy, nên đợi nút "Xem tất cả sản phẩm" (luôn có) chứ không đợi thẻ.
  { name: 'Danh mục', path: fixed('/san-pham'), ready: '#browse-see-all button', setup: (api) => mockDiscovery(api, { tree: true }) },
  // Danh sách (`all=1`): máy chủ dựng thẻ từ sản phẩm thật nên luôn có thẻ để đo.
  { name: 'Danh mục (danh sách)', path: fixed('/san-pham?all=1'), ready: TILE, setup: (api) => mockDiscovery(api, { tree: true }) },
  // Nút Mua ngay của thanh dưới bị khoá tới khi phiên khôi phục xong rồi mới mở: đợi `h1` thì axe có lúc đo nút đang mờ dần (color-contrast).
  {
    name: 'Chi tiết sản phẩm', ready: '[aria-label^="Mua ngay"]:enabled', needsServerData: true, setup: (api) => mockDiscovery(api),
    path: async (request) => { const slug = await firstProductSlug(request); return slug ? `/san-pham/${slug}` : null; },
  },
  { name: 'Gian hàng CTV', path: fixed(`/s/${A11Y_STOREFRONT_SLUG}`), ready: 'h1', needsServerData: true, setup: (api) => mockDiscovery(api) },
  { name: 'Thương hiệu', path: fixed(`/brand/${A11Y_BRAND_SLUG}`), ready: 'h1', needsServerData: true, setup: (api) => mockDiscovery(api) },
  { name: 'Ưu đãi', path: fixed('/uu-dai'), ready: VOUCHER_READY, setup: (api) => { mockFlash(api); mockCollectable(api); } },
  { name: 'Giờ vàng', path: fixed('/gio-vang'), ready: '[data-ds="product-tile"][data-ds-variant="line"]', setup: (api) => mockFlashSlots(api) },
];

test.describe('axe smoke web 375px: serious/critical', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ 375px chỉ chạy ở project Web Customer Mobile');
  });

  for (const screen of SCREENS) {
    test(screen.name, async ({ page, api, request }) => {
      screen.setup(api);
      const path = await screen.path(request);
      if (path === null) {
        expect(seeded, `${screen.name}: DB tạm đã seed mà API không trả sản phẩm nào`).toBe(false);
        test.skip(true, `${screen.name}: DB không phải DB tạm nên không seed, và chưa có sản phẩm nào`);
      }
      const response = await page.goto(path!);
      if (screen.needsServerData === true && !seeded && response?.status() === 404) test.skip(true, `${screen.name}: DB không phải DB tạm nên không seed, trang 404`);
      expect(response?.status(), `${screen.name}: ${path}`).toBe(200);
      await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 20_000 });
      // Next 15 stream metadata của trang động sau thân trang: máy tải nặng thì axe chạy lúc `<title>` chưa tới (document-title).
      await expect(page).toHaveTitle(/\S/, { timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);
      const found = await runAxe(page);
      expect(blockingViolations('web', screen.name, found)).toEqual([]);
      expect(staleBaseline('web', screen.name, found)).toEqual([]);
    });
  }
});

test.describe('axe smoke web 375px: chi tiết khối của trình dựng gian hàng (G6 #25)', () => {
  const SCREEN = 'Chi tiết khối (trình dựng)';
  test.beforeEach(async ({ page, api }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ 375px chỉ chạy ở project Web Customer Mobile');
    await setBuilderSession(page);
    // Khối Combo: có ô % và nút "Lưu" đang tắt (chưa đổi số), nút phụ tắt là điều #25 sửa màu.
    mockBuilder(api, { combo: true });
  });

  test('axe serious/critical (gồm color-contrast) ở chi tiết khối', async ({ page }) => {
    await page.goto('/ctv/gian-hang?khoi=c1');
    await expect(page.getByTestId('shop-section-preview')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveTitle(/\S/, { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    const found = await runAxe(page);
    expect(blockingViolations('web', SCREEN, found)).toEqual([]);
    expect(staleBaseline('web', SCREEN, found)).toEqual([]);
  });

  // axe bỏ qua nút `disabled` ở color-contrast, nên #25 (nút tắt cùng màu, đọc được) phải đo thẳng màu đã tính.
  test('nút phụ đang tắt ("Lưu" của ô %) chữ trên nền đạt 4,5:1', async ({ page }) => {
    await page.goto('/ctv/gian-hang?khoi=c1');
    const save = page.locator('button.tubu-phone-secondary:disabled', { hasText: 'Lưu' });
    await expect(save).toBeVisible({ timeout: 20_000 });
    const ratio = await save.evaluate((el) => {
      const toRgb = (css: string): [number, number, number] => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0]!, d[1]!, d[2]!];
      };
      const lum = ([r, g, b]: [number, number, number]) => {
        const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const cs = getComputedStyle(el);
      const [a, b] = [lum(toRgb(cs.color)), lum(toRgb(cs.backgroundColor))];
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio, `tỉ lệ tương phản của nút phụ tắt: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe('axe smoke web: bài tự kiểm', () => {
  test('nút không tên chèn vào trang thì bị bắt (button-name, critical)', async ({ page, api, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'khổ 375px chỉ chạy ở project Web Customer Mobile');
    const screen = SCREENS.find((s) => s.name === 'Ưu đãi')!;
    screen.setup(api);
    await page.goto((await screen.path(request))!);
    await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button id="axe-probe"></button>'));
    const found = await runAxe(page);
    const lines = blockingViolations('web', screen.name, found);
    expect(lines.some((l) => l.includes('button-name') && l.includes('axe-probe'))).toBe(true);
  });
});

// Hai bài thuần hàm: dùng `test` trơn của Playwright (không mở trang, không bật mock-api) và chỉ chạy ở một project, không lặp ở "Web Customer".
plain.describe('axe smoke web: rào seed', () => {
  plain.beforeEach(({}, testInfo) => {
    plain.skip(testInfo.project.name !== 'Web Customer Mobile', 'hàm thuần: chạy một lần ở project Web Customer Mobile');
  });

  plain('seedDatabaseUrl: process.env thắng, thiếu thì rơi về apps/api/.env như job CI', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'a11y-env-')), '.env');
    writeFileSync(file, 'NODE_ENV=test\n# ghi chú\nDATABASE_URL="postgresql://tubu:tubu@localhost:5434/tubutree"\n');
    expect(seedDatabaseUrl({}, file)).toBe('postgresql://tubu:tubu@localhost:5434/tubutree');
    expect(seedDatabaseUrl({ DATABASE_URL: 'postgresql://x' }, file)).toBe('postgresql://x');
    expect(seedDatabaseUrl({}, path.join(path.dirname(file), 'khong-co.env'))).toBe('');
  });

  plain('firstPublicBrandSlug: danh sách có slug thì dùng; danh sách cũ (đệm 60 giây) chưa thấy nhãn mẫu thì hỏi thẳng trang công khai của nó', async () => {
    const reply = (ok: boolean, body: unknown = null) => ({ ok: () => ok, json: async () => body });
    const fake = (routes: Record<string, ReturnType<typeof reply>>) =>
      ({ get: async (url: string) => routes[new URL(url).pathname] ?? reply(false) }) as unknown as APIRequestContext;
    const origin = 'http://localhost:1';

    const listed = fake({ '/api/brands': reply(true, [{ slug: null }, { slug: 'mộc-an' }]) });
    expect(await firstPublicBrandSlug(listed, origin)).toBe('mộc-an');

    const stale = fake({ '/api/brands': reply(true, [{ slug: null }]), [`/api/brand/public/${A11Y_BRAND_SLUG}`]: reply(true, {}) });
    expect(await firstPublicBrandSlug(stale, origin)).toBe(A11Y_BRAND_SLUG);

    const none = fake({ '/api/brands': reply(true, [{ slug: null }]), [`/api/brand/public/${A11Y_BRAND_SLUG}`]: reply(false) });
    expect(await firstPublicBrandSlug(none, origin)).toBeNull();
  });

  plain('assertSeededOnCi: trên CI không seed được thì đỏ, ngoài CI thì để spec bỏ qua có lý do', () => {
    expect(() => assertSeededOnCi(false, { GITHUB_ACTIONS: 'true' })).toThrow(/seedShopScreens/);
    expect(() => assertSeededOnCi(true, { GITHUB_ACTIONS: 'true' })).not.toThrow();
    expect(() => assertSeededOnCi(false, {})).not.toThrow();
  });
});
