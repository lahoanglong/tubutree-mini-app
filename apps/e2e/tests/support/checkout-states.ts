import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import type { AddressDTO, CartSummary, CheckoutQuote } from '../../../miniapp/src/services/shop-api';
import { installVisualMode, settle } from './visual';
import {
  CHECKOUT_ADDRESS,
  CHECKOUT_CART,
  CHECKOUT_LOYALTY,
  CHECKOUT_QUOTE,
  CHECKOUT_WALLET,
  mockCheckout,
  mockWebCheckoutExtras,
  placedOrderFor,
} from './checkout-mocks';
import { makeUser, mockSession, reply, type MockApi } from './mock-api';

/**
 * Các trạng thái của màn thanh toán ở 375px cho Mini App (/checkout) và web (/thanh-toan): mỗi trạng thái là một thế giới giả
 * (giỏ, địa chỉ, báo giá, lời đáp của đặt đơn) cộng một thao tác của khách. Dùng chung cho spec chụp và spec luồng của gói hk.
 */
export type Side = 'miniapp' | 'web';

export interface World {
  cart: CartSummary;
  addresses: AddressDTO[];
  quote: CheckoutQuote;
  loyalty: typeof CHECKOUT_LOYALTY;
  walletBalance: number;
}

export interface CheckoutState {
  key: string;
  name: string;
  /** Phần tử cho biết màn đã dựng xong ở trạng thái này. */
  ready: (page: Page, side: Side) => Promise<void> | void;
  world?: (w: World) => void;
  /** Đổi lời đáp của máy chủ (đăng ký sau thắng). */
  routes?: (api: MockApi, side: Side) => void;
  act?: (page: Page, side: Side, ctx: { release: () => void }) => Promise<void>;
  /** Cũng chụp ở 1280 (web). */
  wide?: boolean;
}

const LONG_NAME = 'Combo Nước Giặt Sinh Học Tubu Hương Oải Hương Dung Tích Lớn Tiết Kiệm Cho Cả Gia Đình 3 Lít';

export function lineOf(n: number, over: Partial<CartSummary['items'][number]> = {}): CartSummary['items'][number] {
  return {
    id: `cart-item-${n}`,
    variationId: `var-${n}`,
    slug: `san-pham-${n}`,
    productName: `Sản phẩm thử số ${n}`,
    variationName: 'Loại thường',
    thumbnail: null,
    unitPrice: 40000 + n * 1000,
    quantity: 1,
    stock: 20,
    weight: 300,
    total: 40000 + n * 1000,
    ...over,
  };
}

export function baseWorld(): World {
  return {
    cart: { ...CHECKOUT_CART, items: CHECKOUT_CART.items.map((i) => ({ ...i })) },
    addresses: [{ ...CHECKOUT_ADDRESS }],
    quote: { ...CHECKOUT_QUOTE },
    loyalty: { ...CHECKOUT_LOYALTY },
    walletBalance: CHECKOUT_WALLET.walletBalance,
  };
}

const textVisible = (text: string | RegExp) => async (page: Page) => {
  await page.getByText(text).first().waitFor({ state: 'visible', timeout: 15_000 });
};
const orderButton = (page: Page) => page.getByRole('button', { name: /Đặt hàng/ }).last();
const readyWithButton = async (page: Page) => {
  await orderButton(page).waitFor({ state: 'visible', timeout: 15_000 });
};
const placeAndWait = async (page: Page) => {
  const btn = page.getByRole('button', { name: /Đặt hàng · / }).last();
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const bs = [...document.querySelectorAll('button')].filter((b) => /Đặt hàng/.test(b.textContent ?? ''));
      return bs.length > 0 && bs.some((b) => !(b as HTMLButtonElement).disabled);
    },
    undefined,
    { timeout: 15_000 },
  );
  await btn.click();
};

const lines8 = (): CartSummary['items'] => [
  lineOf(1, { productName: LONG_NAME, variationName: 'Hương Oải Hương · Chai 3 lít', quantity: 2, unitPrice: 189000, total: 378000 }),
  ...[2, 3, 4, 5, 6, 7, 8].map((n) => lineOf(n)),
];

function totalsFor(w: World): void {
  const subtotal = w.cart.items.reduce((s, i) => s + i.total, 0);
  w.cart.subtotal = subtotal;
  w.cart.itemCount = w.cart.items.reduce((s, i) => s + i.quantity, 0);
  w.quote = { ...w.quote, subtotal, total: subtotal - w.quote.discount - w.quote.pointsDiscount + w.quote.shippingFee };
}

export const STATES: CheckoutState[] = [
  { key: 'normal', name: 'Bình thường', ready: readyWithButton, wide: true },
  {
    key: 'many-lines',
    name: 'Giỏ nhiều dòng, tên dài',
    ready: readyWithButton,
    wide: true,
    world: (w) => {
      w.cart.items = lines8();
      totalsFor(w);
    },
  },
  {
    key: 'long-address',
    name: 'Địa chỉ dài',
    ready: readyWithButton,
    world: (w) => {
      w.addresses = [
        {
          ...CHECKOUT_ADDRESS,
          recipient: 'Nguyễn Thị Phương Thảo Nguyên Hồng Ngọc',
          street: 'Số 123/45/6 Ngõ 78 Đường Nguyễn Thị Minh Khai, Khu phố 3, Chung cư Vinhomes Grand Park, Tòa S5.02, Tầng 12, Căn 1208',
        },
        { ...CHECKOUT_ADDRESS, id: 'addr-2', isDefault: false, recipient: 'Trần Văn B', phone: '0988777666', street: '9 Hoàng Hoa Thám' },
      ];
    },
  },
  {
    key: 'no-address',
    name: 'Chưa có địa chỉ',
    ready: textVisible(/Thêm địa chỉ mới/),
    world: (w) => {
      w.addresses = [];
    },
    routes: (api) => {
      api.post('/checkout/quote', reply(400, { statusCode: 400, message: 'Chưa có địa chỉ' }));
    },
    wide: true,
  },
  {
    key: 'address-errors',
    name: 'Nhập sai tên và số điện thoại',
    ready: textVisible(/Thêm địa chỉ mới/),
    world: (w) => {
      w.addresses = [];
    },
    act: async (page) => {
      await page.getByRole('button', { name: /Thêm địa chỉ mới/ }).click();
      const phone = page.getByLabel(/Số điện thoại/).first();
      await phone.waitFor({ state: 'visible' });
      await page.getByLabel(/Người nhận/).first().fill('');
      await phone.fill('123');
      await page.getByRole('button', { name: /^Lưu$/ }).click();
      await page.waitForTimeout(300);
    },
    wide: true,
  },
  {
    key: 'coupon-error',
    name: 'Mã giảm giá lỗi',
    ready: readyWithButton,
    world: (w) => {
      w.cart.couponCode = 'GIAM50K';
      w.cart.couponNotice = 'Mã GIAM50K đã hết hạn nên chưa được áp cho đơn này.';
      w.quote.couponNotice = 'Mã GIAM50K đã hết hạn nên chưa được áp cho đơn này.';
    },
  },
  {
    key: 'price-changed',
    name: 'Giá đổi (PRICE_CHANGED)',
    ready: readyWithButton,
    routes: (api) => {
      api.post('/checkout/place-order', reply(400, { statusCode: 400, message: 'PRICE_CHANGED' }));
    },
    act: async (page) => {
      await placeAndWait(page);
      await page.waitForTimeout(600);
    },
    wide: true,
  },
  {
    key: 'out-of-stock',
    name: 'Hết hàng một dòng',
    ready: readyWithButton,
    world: (w) => {
      w.cart.items = [lineOf(1, { productName: 'Nước rửa chén Tubu 500ml', quantity: 2, stock: 0, unitPrice: 65000, total: 130000 }), lineOf(2), lineOf(3)];
      totalsFor(w);
    },
    wide: true,
  },
  {
    key: 'offline',
    name: 'Mất mạng khi đặt',
    ready: readyWithButton,
    act: async (page) => {
      await page.route('**/api/checkout/place-order', (route) => route.abort('internetdisconnected'));
      await placeAndWait(page);
      await page.waitForTimeout(800);
    },
    wide: true,
  },
  {
    key: 'submitting',
    name: 'Đang gửi (nút bận)',
    ready: readyWithButton,
    act: async (page) => {
      await placeAndWait(page);
      await page.waitForTimeout(400);
    },
  },
  {
    key: 'wallet-points',
    name: 'Ví và điểm áp dụng',
    ready: readyWithButton,
    world: (w) => {
      w.cart.couponCode = 'TUBU20';
      w.quote = { ...w.quote, discount: 20000, comboDiscount: 5000, tierDiscount: 3000, pointsUsed: 100, pointsUsedConverted: 50, pointsDiscount: 100000, pointsEarned: 7, shippingFee: 0 };
      w.quote.total = w.quote.subtotal - 20000 - 5000 - 3000 - 100000;
      w.cart.discount = 20000;
    },
    act: async (page) => {
      await page.getByRole('radio', { name: /Ví Tubu/ }).click();
      await page.getByText(/^Điểm Xanh$/).first().click({ timeout: 4000 });
      await page.waitForTimeout(600);
    },
    wide: true,
  },
  {
    key: 'keyboard',
    name: 'Bàn phím mở (khung nhìn thấp)',
    ready: readyWithButton,
    act: async (page) => {
      await page.setViewportSize({ width: 375, height: 460 });
      const field = page.locator('[data-ds="checkout-note"] input, [data-ds="checkout-note"] textarea').first();
      await field.focus();
      await page.waitForTimeout(500);
    },
  },
  {
    key: 'bank-transfer',
    name: 'Chuyển khoản',
    ready: readyWithButton,
    act: async (page) => {
      await page.getByRole('radio', { name: /Chuyển khoản ngân hàng/ }).click();
      await page.waitForTimeout(300);
    },
  },
  // Ba trạng thái dưới đây chỉ có từ gói hk (trước đó nút khoá, không báo ô nào), nên không có ảnh "trước".
  {
    key: 'no-address-pressed',
    name: 'Chưa có địa chỉ, bấm Đặt hàng',
    ready: textVisible(/Thêm địa chỉ mới/),
    world: (w) => {
      w.addresses = [];
    },
    routes: (api) => {
      api.post('/checkout/quote', reply(400, { statusCode: 400, message: 'Chưa có địa chỉ' }));
    },
    act: async (page) => {
      await orderButton(page).click();
      await page.waitForTimeout(500);
    },
  },
  {
    key: 'invoice-errors',
    name: 'Hoá đơn VAT thiếu ô, bấm Đặt hàng',
    ready: readyWithButton,
    act: async (page) => {
      await page.getByText('Yêu cầu xuất hoá đơn VAT').click();
      await orderButton(page).click();
      await page.waitForTimeout(500);
    },
    wide: true,
  },
  {
    key: 'price-accepted',
    name: 'Giá đổi rồi nhận giá mới',
    ready: readyWithButton,
    routes: (api) => {
      let changed = false;
      api.post('/checkout/quote', () => (changed ? { ...CHECKOUT_QUOTE, total: CHECKOUT_QUOTE.total - 5000 } : CHECKOUT_QUOTE));
      api.post('/checkout/place-order', ({ call }) => {
        if (!changed) {
          changed = true;
          return reply(400, { statusCode: 400, message: 'PRICE_CHANGED' });
        }
        return placedOrderFor((call.body ?? {}) as Record<string, unknown>);
      });
    },
    act: async (page) => {
      await placeAndWait(page);
      await page.getByRole('button', { name: 'Cập nhật giá mới' }).click();
      await page.waitForTimeout(900);
    },
    wide: true,
  },
];

export function worldFor(state: CheckoutState): World {
  const w = baseWorld();
  state.world?.(w);
  return w;
}

/** Đăng ký mọi mock của màn thanh toán theo thế giới của trạng thái. */
export async function mockWorld(api: MockApi, page: Page, side: Side, state: CheckoutState, gate: Promise<void>): Promise<void> {
  const w = worldFor(state);
  const user = makeUser({ id: 'user-checkout', fullName: 'Nguyễn Văn A', pointsBalance: 50, pointsConvertedBalance: 50, walletBalance: w.walletBalance });
  mockCheckout(api);
  mockSession(api, user);
  api.get('/cart', w.cart);
  api.get('/me/addresses', w.addresses);
  api.get('/me/loyalty', w.loyalty);
  api.get('/me/wallet', { ...CHECKOUT_WALLET, walletBalance: w.walletBalance });
  api.post('/checkout/quote', w.quote);
  api.get('/geo/provinces', [
    { code: '84_VN79', name: 'TP. Hồ Chí Minh' },
    { code: '84_VN01', name: 'Hà Nội' },
  ]);
  api.get('/geo/communes', [{ code: '84_VN79_26734', name: 'Phường Sài Gòn' }]);
  if (side === 'web') {
    await mockWebCheckoutExtras(api);
    api.get('/me', { id: 'user-checkout', fullName: 'Nguyễn Văn A', email: null, avatarUrl: null, dob: null, onboarded: true, segments: [], walletBalance: w.walletBalance });
    api.post('/checkout/quote', { ...w.quote, pointsBalance: 50, pointsConvertedBalance: 50 });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: trang vẫn mở, chỉ không khôi phục phiên
      }
    });
  }
  api.post('/checkout/place-order', async ({ call }) => {
    if (state.key === 'submitting') await gate;
    return placedOrderFor((call.body ?? {}) as Record<string, unknown>);
  });
  state.routes?.(api, side);
}

export function shotDir(): string | null {
  return process.env.HK_SHOT_DIR ?? null;
}


export interface PageAudit {
  smallText: string[];
  smallTargets: string[];
  hScroll: boolean;
}

/** Đo trên màn đang mở: chữ dưới 13px, vùng chạm dưới 44px (bỏ ô chọn trang trí inert/ẩn và liên kết nằm giữa câu), cuộn ngang. */
export async function auditPage(page: Page): Promise<PageAudit> {
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
    };
    const smallText: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent ?? '').trim();
      const el = node.parentElement;
      if (!text || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || !shown(el)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 13) smallText.push(`${text.slice(0, 40)} (${size}px)`);
    }
    const smallTargets: string[] = [];
    const sel = 'button, a[href], [role="button"], [role="radio"], [role="checkbox"], input:not([type="hidden"]), select, textarea, summary';
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (!shown(el) || el.closest('[inert], [aria-hidden="true"]') || el.tabIndex === -1 || /tubu-hit|sr-only/.test(el.className)) continue;
      const r = el.getBoundingClientRect();
      // Ô chọn nằm trong nhãn bấm được: vùng chạm là cả nhãn, không phải riêng ô.
      const wrap = el.closest('label');
      if (el instanceof HTMLInputElement && wrap) {
        const w = wrap.getBoundingClientRect();
        if (w.height >= 43.5 && w.width >= 43.5) continue;
      }
      const inline = getComputedStyle(el).display === 'inline' && el.closest('p, span, div')?.textContent !== el.textContent;
      if (inline) continue;
      if (r.height < 43.5 || r.width < 43.5) {
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('placeholder') ?? el.tagName).trim().slice(0, 40);
        smallTargets.push(`${name} (${Math.round(r.width)}x${Math.round(r.height)})`);
      }
    }
    const scrollers = [document.documentElement, ...document.querySelectorAll<HTMLElement>('.zaui-page')];
    const hScroll = scrollers.some((el) => el.scrollWidth > el.clientWidth + 1);
    return { smallText: [...new Set(smallText)], smallTargets: [...new Set(smallTargets)], hScroll };
  });
}

/** Chụp khung nhìn (thấy thanh dính đáy) và cả trang; tên theo cạnh + khổ + trạng thái. Không có HK_SHOT_DIR thì bỏ qua. */
export async function shootState(page: Page, side: Side, size: 375 | 1280, key: string): Promise<void> {
  const dir = shotDir();
  if (!dir) return;
  const out = path.join(dir, `${side}-${size}`);
  mkdirSync(out, { recursive: true });
  await settle(page);
  await page.screenshot({ path: path.join(out, `${key}.jpg`), type: 'jpeg', quality: 70, scale: 'css' });
  appendFileSync(path.join(out, 'audit.jsonl'), `${JSON.stringify({ key, ...(await auditPage(page)) })}\n`);
  // Mini App cuộn trong .zaui-page nên chụp cả trang không đủ: kéo cao khung nhìn tới hết nội dung rồi trả lại.
  const height = await page.evaluate(() => {
    const inner = [...document.querySelectorAll<HTMLElement>('.zaui-page, [data-scroll-root]')].map((el) => el.scrollHeight);
    return Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, ...inner);
  });
  const view = page.viewportSize() ?? { width: size, height: 812 };
  const tall = Math.min(Math.max(height, view.height), 4200);
  await page.setViewportSize({ width: view.width, height: tall });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(out, `${key}.full.jpg`), type: 'jpeg', quality: 70, scale: 'css' });
  await page.setViewportSize(view);
}

export async function openState(page: Page, side: Side, size: 375 | 1280): Promise<void> {
  if (shotDir()) await installVisualMode(page);
  await page.setViewportSize(size === 375 ? { width: 375, height: 812 } : { width: 1280, height: 800 });
  await page.goto(side === 'miniapp' ? '/checkout' : '/thanh-toan');
}
