import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery } from './support/discovery-mocks';
import { blockingViolations, runAxe, staleBaseline, type AxeViolation } from './support/axe';
import type { AxeBaselineEntry } from './support/a11y-baseline';
import { mockFlashSlots, mockNoSession } from './support/flash-slot-mocks';
import { BRAND_SLUG, SHOP_SLUG, mockBrandPage, mockShopPage } from './support/shop-page-mocks';
import { mockCollectable } from './support/voucher-mocks';
import { mockComboCart } from './support/cart-combo-mocks';

/**
 * Mini App, axe smoke 375px tám màn mua sắm (P17b, review/a11y.md C7): Trang chủ, Danh mục, chi tiết sản phẩm, gian hàng CTV, thương hiệu, Ưu đãi, Giờ vàng, Giỏ có combo (K5).
 * WCAG AA (a, aa, 2.1 aa, 2.2 aa); chỉ `serious`/`critical` chặn. Vi phạm có sẵn ghi ở support/a11y-baseline.ts kèm lý do, không tắt luật. API mock toàn bộ.
 */
test.use({ viewport: { width: 375, height: 812 } });

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

/** Nút "Lưu mã" chỉ có khi khối Nhận mã đã thay khung chờ (đợi phiên khách ngã ngũ rồi mới dựng thẻ); đợi tiêu đề khối Giờ vàng thì axe quét lúc mã còn là khung chờ. */
const VOUCHER_READY = 'button:has-text("Lưu mã")';

interface Screen {
  name: string;
  path: string;
  ready: string;
  setup(api: MockApi): void;
}

const SCREENS: Screen[] = [
  { name: 'Trang chủ', path: '/', ready: '[data-ds="product-tile"]', setup: (api) => { mockDiscovery(api, { returning: true }); mockFlash(api); } },
  { name: 'Danh mục', path: '/browse', ready: '[data-ds="product-tile"]', setup: (api) => mockDiscovery(api, { tree: true }) },
  { name: 'Chi tiết sản phẩm', path: `/product/${CATALOG[0]!.slug}`, ready: 'h1', setup: (api) => mockDiscovery(api) },
  { name: 'Gian hàng CTV', path: `/s/${SHOP_SLUG}`, ready: 'h1', setup: mockShopPage },
  { name: 'Thương hiệu', path: `/brand/${BRAND_SLUG}`, ready: 'h1', setup: mockBrandPage },
  { name: 'Ưu đãi', path: '/offers', ready: VOUCHER_READY, setup: (api) => { mockNoSession(api); mockFlash(api); mockCollectable(api); } },
  { name: 'Giờ vàng', path: '/flash-sale', ready: '[data-ds="product-tile"][data-ds-variant="line"]', setup: (api) => { mockNoSession(api); mockFlashSlots(api); } },
  {
    name: 'Giỏ có combo', path: '/cart', ready: '[data-testid="cart-combo-group"]',
    setup: (api) => { mockSession(api, makeUser({ id: 'a11y-combo', fullName: 'Khách Giỏ Combo' })); mockComboCart(api); },
  },
];

test.describe('axe smoke Mini App 375px: serious/critical', () => {
  for (const screen of SCREENS) {
    test(screen.name, async ({ page, api }) => {
      screen.setup(api);
      await page.goto(screen.path);
      await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);
      const found = await runAxe(page);
      expect(blockingViolations('miniapp', screen.name, found)).toEqual([]);
      expect(staleBaseline('miniapp', screen.name, found)).toEqual([]);
    });
  }
});

test.describe('axe smoke: bài tự kiểm', () => {
  test('nút không tên chèn vào trang thì bị bắt (button-name, critical)', async ({ page, api }) => {
    const screen = SCREENS.find((s) => s.name === 'Ưu đãi')!;
    screen.setup(api);
    await page.goto(screen.path);
    await expect(page.locator(screen.ready).first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button id="axe-probe"></button>'));
    const found = await runAxe(page);
    const lines = blockingViolations('miniapp', screen.name, found);
    expect(lines.some((l) => l.includes('button-name') && l.includes('axe-probe'))).toBe(true);
  });

  test('blockingViolations: bỏ qua minor/moderate, chặn serious/critical, tôn trọng baseline của đúng màn và nền tảng, baseline thiếu lý do thì ném', () => {
    const v = (id: string, impact: AxeViolation['impact']): AxeViolation => ({ id, impact, nodes: [{ target: ['#a'] }, { target: ['#b'] }] });
    expect(blockingViolations('miniapp', 'X', [v('a', 'minor'), v('b', 'moderate'), v('c', null)], [])).toEqual([]);
    expect(blockingViolations('miniapp', 'X', [v('color-contrast', 'serious')], [])).toEqual(['X: color-contrast [serious] 2 nút, vd #a']);
    const base: AxeBaselineEntry[] = [{ side: 'miniapp', screen: 'X', rule: 'color-contrast', reason: 'giá gạch sẽ đổi ở gói riêng' }];
    expect(blockingViolations('miniapp', 'X', [v('color-contrast', 'serious')], base)).toEqual([]);
    expect(blockingViolations('web', 'X', [v('color-contrast', 'serious')], base)).toHaveLength(1);
    expect(blockingViolations('miniapp', 'Y', [v('color-contrast', 'critical')], base)).toHaveLength(1);
    expect(() => blockingViolations('miniapp', 'X', [], [{ side: 'miniapp', screen: 'X', rule: 'r', reason: '' }])).toThrow(/thiếu lý do/);
    expect(staleBaseline('miniapp', 'X', [], base)).toEqual(['X: color-contrast không còn vi phạm, xoá khỏi AXE_BASELINE']);
  });
});

test.describe('axe smoke Mini App 375px: hộp báo bỏ món của combo (K5)', () => {
  const SCREEN = 'Giỏ có combo (hộp báo bỏ món)';
  test('axe serious/critical khi hộp "Bỏ món khỏi combo?" đang mở', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'a11y-combo', fullName: 'Khách Giỏ Combo' }));
    mockComboCart(api);
    await page.goto('/cart');
    await expect(page.getByTestId('cart-combo-group')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Xoá Món combo 2' }).click();
    await expect(page.getByText('Bỏ món khỏi combo?')).toBeVisible();
    await page.waitForTimeout(400);
    await page.evaluate(() => document.fonts.ready);
    const found = await runAxe(page);
    expect(blockingViolations('miniapp', SCREEN, found)).toEqual([]);
    expect(staleBaseline('miniapp', SCREEN, found)).toEqual([]);
  });
});
