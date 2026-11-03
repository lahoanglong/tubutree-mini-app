import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, makeUser, mockSession, test, type MockApi } from './support/mock-api';
import { CHECKOUT_QUOTE, CHECKOUT_WALLET, mockCheckout, mockWebCheckoutExtras } from './support/checkout-mocks';
import { CATALOG } from './support/discovery-mocks';
import { diffMeasure, expectedFor, measure, probesFor, type Measure, type Side } from './support/ds-parity';
import { mockFlashSlots, mockNoSession } from './support/flash-slot-mocks';
import { mockPilotProduct } from './support/pilot-mocks';
import { mockCollectable } from './support/voucher-mocks';
import { mockBuilder as mockBuilderMini } from './support/builder-mocks';
import { mockBuilder as mockBuilderWeb, setBuilderSession } from './support/builder-web-mocks';
import { CTV_DASHBOARD, CTV_MILESTONES, mockAffiliateDashboard } from './support/affiliate-mocks';

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
  {
    name: 'Trình dựng: tiêu đề khối + ô thống kê',
    route: { miniapp: '/storefront', web: '/ctv/gian-hang' },
    ready: '[data-testid="builder-stats"]',
    probeIds: ['builder-stats-title', 'builder-stats-card', 'builder-stat-value', 'builder-stat-label', 'builder-stat-box', 'builder-sections-title'],
    async setup(api, side, page) {
      if (side === 'miniapp') {
        mockBuilderMini(api, { storefront: { isPublished: true, status: 'LIVE' } });
      } else {
        mockBuilderWeb(api);
        await setBuilderSession(page);
      }
      // Cùng một số liệu ở hai app (đơn 0: đo luôn dòng "Chưa có đơn nào"), cùng chiều cao thẻ.
      api.get('/storefront/me/stats', { orders7d: 0, orders30d: 0, revenue30d: 0, commission30d: 0, byProduct: [] });
    },
  },
  {
    name: 'Trang CTV: thưởng mốc doanh số tháng',
    route: { miniapp: '/affiliate', web: '/ctv' },
    ready: '[data-testid="milestone-rewards"]',
    probeIds: ['tier-toggle', 'tier-toggle-label', 'tier-toggle-icon', 'milestone-card', 'milestone-title', 'milestone-meta', 'milestone-note', 'milestone-row', 'milestone-row-title', 'milestone-row-meta', 'milestone-claim'],
    async setup(api, side, page) {
      if (side === 'miniapp') {
        mockSession(api, makeUser({ id: 'aff-1', role: 'AFFILIATE', fullName: 'Affiliate 1', referralCode: 'AFF1' }));
      } else {
        mockSession(api, makeUser({ id: 'u-parity', fullName: 'Nguyễn Văn An' }));
        await setBuilderSession(page);
      }
      mockAffiliateDashboard(api, { milestones: CTV_MILESTONES });
      api.get('/affiliate/dashboard', CTV_DASHBOARD);
    },
  },
];

/** Web đọc ví từ /me và điểm từ báo giá, Mini đọc /me/wallet và /me/loyalty: đặt cùng số (ví 350.000đ, 50 điểm + 50 điểm quy đổi) để hai nền so được từng chữ. */
async function mockWebCheckoutData(api: MockApi): Promise<void> {
  await mockWebCheckoutExtras(api);
  api.get('/me', { id: 'user-checkout', fullName: 'Nguyễn Văn A', email: null, avatarUrl: null, dob: null, onboarded: true, segments: [], walletBalance: CHECKOUT_WALLET.walletBalance });
  api.post('/checkout/quote', { ...CHECKOUT_QUOTE, pointsBalance: 50, pointsConvertedBalance: 50 });
}

SCENARIOS.push({
  name: 'Thanh toán: thẻ địa chỉ, dòng tóm tắt, ghi chú',
  route: { miniapp: '/checkout', web: '/thanh-toan' },
  ready: '[data-ds="checkout-summary-total"]',
  probeIds: [
    'checkout-block-title', 'checkout-address-card', 'checkout-summary-row', 'checkout-summary-label', 'checkout-summary-value',
    'checkout-summary-total-label', 'checkout-summary-total-value', 'checkout-note',
  ],
  async setup(api, side, page) {
    mockCheckout(api);
    if (side === 'web') {
      await mockWebCheckoutData(api);
      await page.addInitScript(() => {
        try {
          localStorage.setItem('tubu_web_session', '1');
        } catch {
          // không có localStorage: trang vẫn mở, chỉ không khôi phục phiên
        }
      });
    }
  },
});

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

test.describe('ds-parity: thanh toán 375px, ghi chú, VAT, câu đồng ý, Điểm Xanh (R-23)', () => {
  const CHECKOUT_FORM_EXPECTED = {
    notePlaceholder: 'Ví dụ: giao giờ hành chính…',
    noteCounterVisible: false,
    vatLabel: 'Yêu cầu xuất hoá đơn VAT',
    vatCheckboxOnRight: true,
    pointsTitle: 'Điểm Xanh',
    pointsSubtext: 'Dùng 100 điểm, giảm 100đ trong đó 50 điểm không hết hạn, trả tới 100% giá trị hàng',
    consentText: 'Bằng việc đặt hàng, bạn đồng ý với Điều khoản và Chính sách đổi trả.',
    consentAboveButton: true,
    consentGapToButton: 'gần',
    walletLabel: 'Ví Tubu (350.000đ)',
  };
  // Vị trí ngang (px CSS ở 375) của Mini làm chuẩn; web phải khớp ±2px.
  const POS_TOLERANCE = 2;
  const MINI_POS = { vatCheckboxRight: 339, pointsCheckboxRight: 339, payTextLeft: 70 };

  test('ghi chú một dòng không hiện bộ đếm, ô VAT bên phải, điểm Xanh cùng chữ, câu đồng ý sát nút Đặt hàng', async ({ page, api }, testInfo) => {
    const side = sideOf(testInfo.project.name);
    mockCheckout(api);
    api.allowUnmocked('POST /events');
    if (side === 'web') {
      await mockWebCheckoutData(api);
      await page.addInitScript(() => {
        try {
          localStorage.setItem('tubu_web_session', '1');
        } catch {
          // không có localStorage: trang vẫn mở, chỉ không khôi phục phiên
        }
      });
    }
    await page.goto(side === 'web' ? '/thanh-toan' : '/checkout');
    await expect(page.locator('[data-ds="checkout-summary-total"]').first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);

    const note = page.getByPlaceholder(/Ví dụ: giao giờ hành chính/);
    await note.scrollIntoViewIfNeeded();
    const counter = page.getByText(/^\d+\/500 ký tự$/);
    const noteCounterVisible = (await counter.count()) > 0 && (await counter.first().isVisible()) && ((await counter.first().boundingBox())?.width ?? 0) > 1;

    const vat = page.getByText('Yêu cầu xuất hoá đơn VAT', { exact: true });
    await vat.scrollIntoViewIfNeeded();
    // Chữ nằm sát lề trái (16px đệm) thì ô tick ở bên phải; ô tick bên trái đẩy chữ ra sau ~52px.
    const vatTextLeft = await vat.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect().left;
    });
    const vatCheckboxOnRight = vatTextLeft < 40;

    const pointsTitle = page.getByText('Điểm Xanh', { exact: true }).first();
    await pointsTitle.scrollIntoViewIfNeeded();
    const rightOfCheckbox = (label: typeof vat) =>
      label.evaluate((el) => {
        let row: Element | null = el;
        while (row && !row.querySelector('input[type=checkbox]')) row = row.parentElement;
        const box = row?.querySelector('input[type=checkbox]')?.getBoundingClientRect();
        return box ? Math.round(box.right) : -1;
      });
    const vatCheckboxRight = await rightOfCheckbox(vat);

    const pointsBlockText = (await pointsTitle.locator('xpath=..').innerText()).replace(/\s+/g, ' ').trim();
    // Web đặt các dòng ghi chú điểm (phần không hết hạn, trần) ngay dưới ô; Mini để trong cùng khối chữ. Chữ khách đọc được thì giống nhau.
    const notesBelow = await pointsTitle.evaluate((el) => {
      const out: string[] = [];
      for (let n = el.closest('label')?.nextElementSibling ?? null; n && n.tagName === 'P'; n = n.nextElementSibling) if (n.checkVisibility()) out.push((n as HTMLElement).innerText);
      return out.join(' ');
    });
    // Mini để các dòng ghi chú trong cùng khối chữ cạnh ô tick: web ở 375 không còn dòng ghi chú riêng dưới ô.
    expect(notesBelow, 'ghi chú điểm Xanh phải nằm trong khối chữ cạnh ô tick, không có dòng riêng dưới ô').toBe('');
    const pointsSubtext = pointsBlockText.replace(/^Điểm Xanh\s*/, '').replace(/\s+/g, ' ').trim();

    const pointsCheckboxRight = await rightOfCheckbox(pointsTitle);

    const walletText = page.getByText(/^Ví Tubu \(/).first();
    await walletText.scrollIntoViewIfNeeded();
    const payTextLeft = Math.round(
      await walletText.evaluate((el) => {
        const r = document.createRange();
        const text = Array.from(el.childNodes).reverse().find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
        r.selectNodeContents(text ?? el);
        return r.getBoundingClientRect().left;
      }),
    );

    const consent = page.locator('[data-testid="order-consent"]:visible').first();
    await consent.scrollIntoViewIfNeeded();
    await consent.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const consentText = (await consent.innerText()).replace(/\s+/g, ' ').trim();
    const consentBox = (await consent.boundingBox())!;
    const button = page.getByRole('button', { name: /^Đặt hàng/ }).last();
    const buttonBox = (await button.boundingBox())!;
    const gap = buttonBox.y - (consentBox.y + consentBox.height);
    if (process.env.PARITY_SHOT_DIR) await page.screenshot({ path: `${process.env.PARITY_SHOT_DIR}/checkout-form-${side}375.png` });

    const got = {
      notePlaceholder: await note.getAttribute('placeholder'),
      noteCounterVisible,
      vatLabel: (await vat.innerText()).trim(),
      vatCheckboxOnRight,
      pointsTitle: (await pointsTitle.innerText()).trim(),
      pointsSubtext,
      consentText,
      consentAboveButton: gap >= 0,
      consentGapToButton: gap <= 120 ? 'gần' : `xa ${Math.round(gap)}px`,
      walletLabel: (await walletText.innerText()).trim(),
    };
    const positions = { vatCheckboxRight, pointsCheckboxRight, payTextLeft };
    const file = testInfo.outputPath(`checkout-form-${side}.json`);
    writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
    writeFileSync(testInfo.outputPath(`checkout-pos-${side}.json`), `${JSON.stringify(positions)}\n`);
    await testInfo.attach(`checkout-form-${side}`, { path: file, contentType: 'application/json' });
    expect(got).toEqual(CHECKOUT_FORM_EXPECTED);
    for (const k of Object.keys(MINI_POS) as (keyof typeof MINI_POS)[]) {
      expect(Math.abs(positions[k] - MINI_POS[k]), `${k}: ${positions[k]} so với Mini ${MINI_POS[k]}`).toBeLessThanOrEqual(POS_TOLERANCE);
    }
  });
});

// Đo trên Mini: đường chân chữ nhãn → đỉnh câu lý do (px).
const MINI_WALLET_GAP_Y = 2;

test.describe('ds-parity: thanh toán 375px, câu lý do ví không đủ tiền thẳng cột chữ nhãn (R-23)', () => {
  test('ví 50.000đ, đơn 149.000đ: câu lý do bắt đầu cùng x với chữ "Ví Tubu" và cùng x Mini (±2px)', async ({ page, api }, testInfo) => {
    const side = sideOf(testInfo.project.name);
    mockCheckout(api);
    if (side === 'web') {
      await mockWebCheckoutData(api);
      await page.addInitScript(() => {
        try {
          localStorage.setItem('tubu_web_session', '1');
        } catch {
          // không có localStorage: trang vẫn mở, chỉ không khôi phục phiên
        }
      });
      api.get('/me', { id: 'user-checkout', fullName: 'Nguyễn Văn A', email: null, avatarUrl: null, dob: null, onboarded: true, segments: [], walletBalance: 50000 });
    }
    api.get('/me/wallet', { ...CHECKOUT_WALLET, walletBalance: 50000 });
    await page.goto(side === 'web' ? '/thanh-toan' : '/checkout');
    await expect(page.locator('[data-ds="checkout-summary-total"]').first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);

    const walletText = page.getByText(/^Ví Tubu \(/).first();
    await walletText.scrollIntoViewIfNeeded();
    const hint = page.locator(side === 'web' ? '#pay-blocked-WALLET' : '#pay-hint-WALLET');
    await expect(hint).toBeVisible();
    const textLeft = (el: Element) => {
      const r = document.createRange();
      const text = Array.from(el.childNodes).reverse().find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
      r.selectNodeContents(text ?? el);
      return Math.round(r.getBoundingClientRect().left);
    };
    const labelLeft = await walletText.evaluate(textLeft);
    const hintLeft = await hint.evaluate(textLeft);
    if (process.env.PARITY_SHOT_DIR) await page.screenshot({ path: `${process.env.PARITY_SHOT_DIR}/checkout-wallet-blocked-${side}375.png` });
    expect(Math.abs(hintLeft - labelLeft), `câu lý do ${hintLeft} so với nhãn ${labelLeft}`).toBeLessThanOrEqual(2);
    expect(Math.abs(hintLeft - 70), `câu lý do ${hintLeft} so với Mini 70`).toBeLessThanOrEqual(2);
    const textRect = (el: Element, pick: 'first' | 'last') => {
      const nodes = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
      const r = document.createRange();
      r.selectNodeContents(pick === 'first' ? nodes[0] ?? el : nodes[nodes.length - 1] ?? el);
      const b = r.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom };
    };
    const labelBox = await walletText.evaluate(textRect, 'first' as const);
    const hintBox = await hint.evaluate(textRect, 'first' as const);
    const gapY = Math.round(hintBox.top - labelBox.bottom);
    await testInfo.attach(`wallet-gap-${side}`, { body: String(gapY), contentType: 'text/plain' });
    expect(Math.abs(gapY - MINI_WALLET_GAP_Y), `khoảng dọc nhãn → câu lý do ${gapY} so với Mini ${MINI_WALLET_GAP_Y}`).toBeLessThanOrEqual(2);
  });
});
