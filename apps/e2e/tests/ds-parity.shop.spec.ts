import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, makeUser, mockSession, test, type MockApi } from './support/mock-api';
import { CATALOG } from './support/discovery-mocks';
import { diffMeasure, expectedFor, measure, probesFor, type Measure, type Side } from './support/ds-parity';
import { mockFlashSlots, mockNoSession } from './support/flash-slot-mocks';
import { mockPilotProduct } from './support/pilot-mocks';
import { mockCollectable } from './support/voucher-mocks';

/**
 * So số đo 375px của thẻ sản phẩm, tiêu đề khối và giá giữa Mini App (project "Zalo Mini App") và web ("Web Customer Mobile") trên cùng dữ liệu mock.
 * Spec chạy ở cả hai project (playwright.config.ts thêm đúng một chỗ testMatch cho mỗi project); mỗi project đo trang của mình và so với bảng chuẩn
 * chung trong support/ds-parity.ts (lý do không so trực tiếp hai project ở đầu file đó). Chỉ dùng trang chạy hoàn toàn bằng mock phía trình duyệt ở cả
 * hai app, nên không dính dữ liệu máy chủ web: Ưu đãi (thẻ flash + tiêu đề khối), Giờ vàng (thẻ line), Yêu thích (thẻ grid).
 * Số đo mỗi lần chạy ghi vào test-results (đính kèm báo cáo) để người xem đối chiếu tay Mini ↔ web.
 */
test.use({ viewport: { width: 375, height: 812 } });

const HOUR = 3_600_000;

function mockOffersFlash(api: MockApi): void {
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return CATALOG.slice(4, 7).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3 * HOUR).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
}

const wish = (n: number, over: Record<string, unknown> = {}) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Nước rửa chén sinh học hương chanh sả ${n}`, thumbnail: null, basePrice: 65_000 + n,
  salePrice: 52_000 + n, isFeatured: false, inStock: true, ratingAvg: 4.8, reviewCount: 32, sold: 1234, ...over,
});

interface Scenario {
  name: string;
  route: Record<Side, string>;
  ready: string;
  probeIds: readonly string[];
  setup(api: MockApi, side: Side, page: Page): Promise<void> | void;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'Ưu đãi: tiêu đề khối Giờ vàng + thẻ flash',
    route: { miniapp: '/offers', web: '/uu-dai' },
    ready: '[data-ds="product-tile"][data-ds-variant="flash"]',
    probeIds: ['section-title', 'section-header', 'tile-flash', 'tile-flash-body', 'tile-flash-name', 'tile-flash-price', 'tile-flash-compare'],
    setup(api, side) {
      if (side === 'miniapp') mockNoSession(api);
      mockOffersFlash(api);
      mockCollectable(api);
    },
  },
  {
    name: 'Giờ vàng: thẻ line',
    route: { miniapp: '/flash-sale', web: '/gio-vang' },
    ready: '[data-ds="product-tile"][data-ds-variant="line"]',
    probeIds: ['tile-line', 'tile-line-media', 'tile-line-name', 'tile-line-price', 'tile-line-compare'],
    setup(api, side) {
      if (side === 'miniapp') mockNoSession(api);
      mockFlashSlots(api);
    },
  },
  {
    name: 'Yêu thích: thẻ grid',
    route: { miniapp: '/wishlist', web: '/tai-khoan/yeu-thich' },
    ready: '[data-ds="product-tile"][data-ds-variant="grid"]',
    probeIds: ['tile-grid', 'tile-grid-body', 'tile-grid-brand', 'tile-grid-name', 'tile-grid-price', 'tile-grid-compare', 'tile-grid-meta'],
    async setup(api, side, page) {
      if (side === 'miniapp') {
        mockPilotProduct(api);
      } else {
        mockSession(api, makeUser({ id: 'u-parity', fullName: 'Nguyễn Văn An' }));
        await page.addInitScript(() => {
          try {
            localStorage.setItem('tubu_web_session', '1');
          } catch {
            // không có localStorage: trang vẫn mở, chỉ không khôi phục phiên
          }
        });
        api.get('/flash-sales/active', []);
      }
      api.get('/me/wishlist', [wish(1), wish(2, { salePrice: null })]);
      api.get('/me/wishlist/ids', ['p1', 'p2']);
    },
  },
];

const sideOf = (projectName: string): Side => (projectName === 'Zalo Mini App' ? 'miniapp' : 'web');

test.describe('ds-parity: số đo thuần (không cần trình duyệt)', () => {
  test('diffMeasure: bằng nhau thì rỗng, dung sai 0,5px, lệch thì nêu phần tử + thuộc tính + hai giá trị', () => {
    const want: Measure = { a: { fontSize: '16px', color: 'rgb(0, 0, 0)' } };
    expect(diffMeasure(want, { a: { fontSize: '16px', color: 'rgb(0, 0, 0)' } })).toEqual([]);
    expect(diffMeasure(want, { a: { fontSize: '16.4px', color: 'rgb(0, 0, 0)' } })).toEqual([]);
    expect(diffMeasure(want, { a: { fontSize: '17px', color: 'rgb(0, 0, 0)' } })).toEqual(['a.fontSize: chuẩn "16px", đo "17px"']);
    expect(diffMeasure(want, { a: { fontSize: '16px', color: 'rgb(1, 0, 0)' } })).toEqual(['a.color: chuẩn "rgb(0, 0, 0)", đo "rgb(1, 0, 0)"']);
    expect(diffMeasure(want, { a: null })).toEqual(['a: không thấy phần tử']);
    expect(diffMeasure(want, {})).toEqual(['a: không thấy phần tử']);
  });

  test('mọi phần tử đo đều có số đo chuẩn (bảng chuẩn không để trống)', () => {
    const missing = SCENARIOS.flatMap((s) => s.probeIds).filter((id) => !expectedFor([id])[id]);
    expect(missing).toEqual([]);
  });
});

test.describe('ds-parity: Mini ↔ web ở 375px', () => {
  for (const scenario of SCENARIOS) {
    test(scenario.name, async ({ page, api }, testInfo) => {
      const side = sideOf(testInfo.project.name);
      await scenario.setup(api, side, page);
      await page.goto(scenario.route[side]);
      await expect(page.locator(scenario.ready).first()).toBeVisible({ timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);
      const got = await measure(page, probesFor(scenario.probeIds));
      const file = testInfo.outputPath(`ds-parity-${side}.json`);
      writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
      await testInfo.attach(`ds-parity-${side}`, { path: file, contentType: 'application/json' });
      expect(diffMeasure(expectedFor(scenario.probeIds), got)).toEqual([]);
    });
  }

  test('bắt được lệch: ép tiêu đề khối 17px thì diffMeasure đỏ và gọi đúng tên thuộc tính', async ({ page, api }, testInfo) => {
    const side = sideOf(testInfo.project.name);
    const scenario = SCENARIOS[0]!;
    await scenario.setup(api, side, page);
    await page.goto(scenario.route[side]);
    await expect(page.locator(scenario.ready).first()).toBeVisible({ timeout: 20_000 });
    await page.addStyleTag({ content: '[data-testid="section-header"] h2 { font-size: 17px !important; }' });
    const got = await measure(page, probesFor(scenario.probeIds));
    const diff = diffMeasure(expectedFor(scenario.probeIds), got);
    expect(diff[0]).toContain('section-title.fontSize');
    expect(diff[0]).toContain('"17px"');
  });
});
