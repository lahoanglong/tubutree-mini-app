import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import type { OrderDTO, ShippingEvent } from '@tubutree/shared-types';
import { BANK_QR } from './checkout-mocks';
import { installVisualMode, settle } from './visual';
import { makeOrder, makeUser, mockSession, publicConfig, type MockApi } from './mock-api';

/**
 * Các trạng thái của màn chi tiết đơn ở 375px cho Mini App (/order/:code) và web (/tai-khoan/don-hang/:code): mỗi trạng thái là một
 * đơn giả cộng các yêu cầu đổi/trả và khoản hoàn đi kèm. Dùng chung cho spec chụp và spec luồng của gói hl.
 */
export type Side = 'miniapp' | 'web';

export const HL_USER_ID = 'user-hl';

const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

export interface OrderWorld {
  order: OrderDTO & Record<string, unknown>;
  returns: Record<string, unknown>[];
  refunds: Record<string, unknown>[];
}

export interface OrderState {
  key: string;
  name: string;
  world: (now: number) => OrderWorld;
  /** Phần tử cho biết màn đã dựng xong ở trạng thái này. */
  ready: (page: Page) => Promise<void>;
  /** Cũng chụp ở 1280 (web). */
  wide?: boolean;
}

const LONG_NAME = 'Combo Nước Giặt Sinh Học Tubu Hương Oải Hương Dung Tích Lớn Tiết Kiệm Cho Cả Gia Đình 3 Lít';

export function itemOf(n: number, over: Record<string, unknown> = {}): OrderDTO['items'][number] & Record<string, unknown> {
  return {
    id: `item-${n}`,
    variationId: `var-${n}`,
    productName: `Sản phẩm thử số ${n}`,
    productSlug: `san-pham-${n}`,
    variationName: 'Loại thường',
    unitPrice: 40_000 + n * 1000,
    quantity: 1,
    backorderedQty: 0,
    total: 40_000 + n * 1000,
    reviewId: null,
    reviewable: false,
    thumbnail: null,
    stock: 20,
    available: true,
    ...over,
  };
}

const TWO_LINES = (): OrderDTO['items'] => [
  itemOf(1, { productName: 'Nước Rửa Chén Sinh Học Tubu 500ml', variationName: 'Hương Chanh Gừng', unitPrice: 65_000, quantity: 2, total: 130_000 }),
  itemOf(2, { productName: 'Dầu Gội Bồ Kết Hữu Cơ', variationName: '500ml', unitPrice: 150_000, quantity: 1, total: 150_000 }),
];

function orderOf(now: number, over: Partial<OrderDTO> & Record<string, unknown>): OrderWorld['order'] {
  const items = (over.items as OrderDTO['items'] | undefined) ?? TWO_LINES();
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  return {
    ...makeOrder({
      code: 'TUBU20261105001',
      subtotal,
      shippingFee: 19_000,
      total: subtotal + 19_000,
      pointsEarned: 28,
      createdAt: iso(now - 26 * HOUR),
      updatedAt: iso(now - HOUR),
      ...over,
      items,
    }),
    ...over,
    items,
  } as OrderWorld['order'];
}

/** Lịch sử vận chuyển như Pancake ghi (cũ trước, mới sau): mã trạng thái tiếng Anh của hãng; mốc cuối rơi đúng `end`. */
function shippingHistory(end: number, last = 'delivering'): ShippingEvent[] {
  const steps: [number, string][] = [
    [18 * HOUR, 'ready_to_pick'],
    [15 * HOUR, 'picked'],
    [10 * HOUR, 'storing'],
    [3 * HOUR, 'transporting'],
    [0, last],
  ];
  return steps.map(([back, status]) => ({ at: iso(end - back), status, carrier: 'Giao Hàng Nhanh', code: 'GHN6789012345' }));
}

const empty = (order: OrderWorld['order']): OrderWorld => ({ order, returns: [], refunds: [] });

const textVisible = (text: string | RegExp) => async (page: Page) => {
  await page.getByText(text).locator('visible=true').first().waitFor({ state: 'visible', timeout: 15_000 });
};

export const STATES: OrderState[] = [
  {
    key: 'pending-payment',
    name: 'Chờ thanh toán (chuyển khoản)',
    wide: true,
    ready: textVisible(/Chờ thanh toán/),
    world: (now) =>
      empty(
        orderOf(now, {
          status: 'PENDING_PAYMENT',
          paymentMethod: 'BANK_TRANSFER',
          paymentStatus: 'UNPAID',
          paymentDeadline: iso(now + 2 * HOUR + 15 * 60_000),
          createdAt: iso(now - 45 * 60_000),
          statusTimes: {},
        }),
      ),
  },
  {
    key: 'manual-handling',
    name: 'Chờ thanh toán, Tubu xử lý tay',
    ready: textVisible(/Tubu đang xử lý đơn này/),
    world: (now) =>
      empty(
        orderOf(now, {
          status: 'PENDING_PAYMENT',
          paymentMethod: 'BANK_TRANSFER',
          paymentStatus: 'UNPAID',
          paymentDeadline: null,
          manualHandling: true,
          canCancel: false,
          shippingCode: 'GHN6789012345',
          shippingPartner: 'Giao Hàng Nhanh',
        }),
      ),
  },
  {
    key: 'confirmed',
    name: 'Đã xác nhận',
    wide: true,
    ready: textVisible(/Đã xác nhận/),
    world: (now) =>
      empty(
        orderOf(now, {
          status: 'CONFIRMED',
          paymentMethod: 'COD',
          createdAt: iso(now - 3 * HOUR),
          statusTimes: { CONFIRMED: iso(now - 3 * HOUR + 4 * 60_000) },
        }),
      ),
  },
  {
    key: 'packed',
    name: 'Đã đóng gói',
    wide: true,
    ready: textVisible(/Đang đóng gói/),
    world: (now) =>
      empty(
        orderOf(now, {
          status: 'PACKED',
          paymentMethod: 'COD',
          createdAt: iso(now - 8 * HOUR),
          statusTimes: { CONFIRMED: iso(now - 8 * HOUR + 4 * 60_000), PACKED: iso(now - 2 * HOUR) },
        }),
      ),
  },
  {
    key: 'carrier-booked',
    name: 'Đã đặt đơn vị vận chuyển, chưa nhận hàng',
    ready: textVisible(/Đã đặt đơn vị vận chuyển/),
    world: (now) =>
      empty(
        orderOf(now, {
          status: 'PACKED',
          paymentMethod: 'COD',
          canCancel: false,
          shippingPartner: 'Giao Hàng Nhanh',
          shippingCode: 'GHN6789012345',
          shippingStatus: 'ready_to_pick',
          shippingHistory: [{ at: iso(now - 2 * HOUR), status: 'ready_to_pick', carrier: 'Giao Hàng Nhanh', code: 'GHN6789012345' }],
          createdAt: iso(now - 9 * HOUR),
          statusTimes: { CONFIRMED: iso(now - 9 * HOUR + 4 * 60_000), PACKED: iso(now - 3 * HOUR) },
        }),
      ),
  },
  {
    key: 'shipping',
    name: 'Đang giao, có mã vận đơn và sự kiện vận chuyển',
    wide: true,
    ready: textVisible(/GHN6789012345/),
    world: (now) =>
      empty(
        orderOf(now, {
          status: 'SHIPPING',
          paymentMethod: 'COD',
          canCancel: false,
          shippingPartner: 'Giao Hàng Nhanh',
          shippingCode: 'GHN6789012345',
          shippingStatus: 'delivering',
          trackingLink: 'https://tracking.ghn.vn/?code=GHN6789012345',
          shippingHistory: shippingHistory(now - 2 * HOUR),
          createdAt: iso(now - 26 * HOUR),
          statusTimes: {
            CONFIRMED: iso(now - 26 * HOUR + 4 * 60_000),
            PACKED: iso(now - 22 * HOUR),
            SHIPPING: iso(now - 17 * HOUR),
          },
        }),
      ),
  },
  {
    key: 'delivered',
    name: 'Đã giao, còn hạn đổi/trả',
    wide: true,
    ready: textVisible(/Giao thành công/),
    world: (now) =>
      empty(
        orderOf(now, {
          status: 'DELIVERED',
          paymentMethod: 'COD',
          paymentStatus: 'UNPAID',
          items: [
            itemOf(1, { productName: 'Nước Rửa Chén Sinh Học Tubu 500ml', variationName: 'Hương Chanh Gừng', unitPrice: 65_000, quantity: 2, total: 130_000, reviewable: true }),
            itemOf(2, { productName: 'Dầu Gội Bồ Kết Hữu Cơ', variationName: '500ml', unitPrice: 150_000, total: 150_000, reviewable: true }),
          ],
          shippingPartner: 'Giao Hàng Nhanh',
          shippingCode: 'GHN6789012345',
          shippingStatus: 'delivered',
          shippingHistory: shippingHistory(now - 26 * HOUR, 'delivered'),
          deliveredAt: iso(now - 26 * HOUR),
          createdAt: iso(now - 5 * 24 * HOUR),
          statusTimes: {
            CONFIRMED: iso(now - 5 * 24 * HOUR + 4 * 60_000),
            PACKED: iso(now - 60 * HOUR),
            SHIPPING: iso(now - 44 * HOUR),
            DELIVERED: iso(now - 26 * HOUR),
          },
        }),
      ),
  },
  {
    key: 'delivered-reviewed',
    name: 'Đã giao, đã đánh giá hết',
    ready: textVisible(/Giao thành công/),
    world: (now) =>
      empty(
        orderOf(now, {
          status: 'DELIVERED',
          paymentMethod: 'COD',
          items: [
            itemOf(1, { productName: 'Nước Rửa Chén Sinh Học Tubu 500ml', variationName: 'Hương Chanh Gừng', unitPrice: 65_000, quantity: 2, total: 130_000, reviewId: 'rv-1' }),
          ],
          deliveredAt: iso(now - 9 * 24 * HOUR),
          createdAt: iso(now - 12 * 24 * HOUR),
          statusTimes: { CONFIRMED: iso(now - 12 * 24 * HOUR), DELIVERED: iso(now - 9 * 24 * HOUR) },
        }),
      ),
  },
  {
    key: 'cancelled',
    name: 'Đã huỷ (quá hạn thanh toán)',
    wide: true,
    ready: textVisible(/Đã huỷ/),
    world: (now) =>
      empty(
        orderOf(now, {
          status: 'CANCELLED',
          paymentMethod: 'BANK_TRANSFER',
          paymentStatus: 'UNPAID',
          paymentDeadline: iso(now - 20 * HOUR),
          createdAt: iso(now - 44 * HOUR),
          statusTimes: { PENDING_PAYMENT: iso(now - 44 * HOUR), CANCELLED: iso(now - 20 * HOUR + 60_000) },
        }),
      ),
  },
  {
    key: 'return-requested',
    name: 'Trả hàng đang chờ Tubu duyệt',
    wide: true,
    ready: textVisible(/đổi\/trả/i),
    world: (now) => {
      const order = orderOf(now, {
        status: 'DELIVERED',
        paymentMethod: 'COD',
        deliveredAt: iso(now - 2 * 24 * HOUR),
        createdAt: iso(now - 6 * 24 * HOUR),
        statusTimes: { CONFIRMED: iso(now - 6 * 24 * HOUR), DELIVERED: iso(now - 2 * 24 * HOUR) },
      });
      return {
        order,
        returns: [
          {
            id: 'ret-1',
            orderId: order.id,
            reason: 'Hộp bị móp khi nhận',
            reasonCode: 'DAMAGED',
            status: 'REQUESTED',
            adminNote: null,
            items: [{ orderItemId: 'item-1', quantity: 1, refundAmount: 65_000 }],
            createdAt: iso(now - 20 * HOUR),
          },
        ],
        refunds: [],
      };
    },
  },
  {
    key: 'refund-pending',
    name: 'Hoàn tiền về ngân hàng đang xử lý',
    ready: textVisible(/Đã huỷ/),
    world: (now) => {
      const order = orderOf(now, {
        status: 'CANCELLED',
        paymentMethod: 'BANK_TRANSFER',
        paymentStatus: 'REFUNDED',
        createdAt: iso(now - 30 * HOUR),
        statusTimes: { CONFIRMED: iso(now - 30 * HOUR), CANCELLED: iso(now - 6 * HOUR) },
      });
      return {
        order,
        returns: [],
        refunds: [
          {
            id: 'rf-1',
            orderId: order.id,
            orderCode: order.code,
            kind: 'CANCEL',
            amount: order.total,
            method: 'MANUAL_TRANSFER',
            status: 'PENDING',
            bankName: 'Vietcombank',
            bankAccountNo: '0123456789',
            bankAccountName: 'NGUYEN VAN A',
            bankRef: null,
            completedAt: null,
            createdAt: iso(now - 6 * HOUR),
            canChooseDestination: false,
          },
        ],
      };
    },
  },
  {
    key: 'subscription',
    name: 'Đơn định kỳ',
    ready: textVisible(/Đơn định kỳ/),
    world: (now) =>
      empty(
        orderOf(now, {
          status: 'CONFIRMED',
          paymentMethod: 'COD',
          source: 'subscription',
          note: 'Đơn đặt định kỳ (Subscribe & Save)',
          discount: 33_600,
          total: 265_400,
          createdAt: iso(now - 4 * HOUR),
          statusTimes: { CONFIRMED: iso(now - 4 * HOUR) },
        }),
      ),
  },
  {
    key: 'many-lines',
    name: 'Nhiều dòng, tên dài',
    wide: true,
    ready: textVisible(/Sản phẩm thử số 8/),
    world: (now) =>
      empty(
        orderOf(now, {
          status: 'SHIPPING',
          paymentMethod: 'COD',
          canCancel: false,
          shippingPartner: 'Giao Hàng Nhanh',
          shippingCode: 'GHN6789012345',
          shippingStatus: 'transporting',
          shippingHistory: shippingHistory(now - 3 * HOUR, 'transporting').slice(0, 4),
          items: [
            itemOf(1, { productName: LONG_NAME, variationName: 'Hương Oải Hương · Chai 3 lít', quantity: 2, unitPrice: 189_000, total: 378_000 }),
            ...[2, 3, 4, 5, 6, 7, 8].map((n) => itemOf(n)),
          ],
          statusTimes: { CONFIRMED: iso(now - 25 * HOUR), PACKED: iso(now - 20 * HOUR), SHIPPING: iso(now - 17 * HOUR) },
          createdAt: iso(now - 26 * HOUR),
        }),
      ),
  },
];

/** Đăng ký mọi mock của màn chi tiết đơn theo thế giới của trạng thái. */
export async function mockWorld(api: MockApi, page: Page, side: Side, state: OrderState, now: number): Promise<OrderWorld> {
  const w = state.world(now);
  mockSession(api, makeUser({ id: HL_USER_ID, fullName: 'Nguyễn Văn A', pointsBalance: 50, pointsConvertedBalance: 50 }));
  api.get('/config/public', publicConfig({ shippingEta: { minDays: 1, maxDays: 3 }, returnWindowDays: 7, support: { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: null } }));
  api.get('/orders/:code', ({ params }) => (params.code === w.order.code ? w.order : { message: 'Không tìm thấy đơn hàng', statusCode: 404 }));
  api.get('/orders/me/returns', w.returns);
  api.get('/orders/me/refunds', w.refunds);
  api.get('/payments/bank-qr/:code', { ...BANK_QR, orderCode: w.order.code, memo: w.order.code, amount: w.order.total });
  if (side === 'web') {
    api.get('/me', { id: HL_USER_ID, fullName: 'Nguyễn Văn A', email: null, avatarUrl: null, dob: null, onboarded: true, segments: [], walletBalance: 0 });
    api.get('/me/notifications', []);
    api.get('/orders', { data: [w.order], meta: { page: 1, limit: 20, total: 1 } });
    api.allowUnmocked('GET /auth/me');
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: trang vẫn mở, chỉ không khôi phục phiên
      }
    });
  } else {
    api.get('/orders', { data: [w.order], meta: { page: 1, limit: 20, total: 1 } });
  }
  return w;
}

export function shotDir(): string | null {
  return process.env.HL_SHOT_DIR ?? null;
}

export interface PageAudit {
  smallText: string[];
  smallTargets: string[];
  hScroll: boolean;
  currentSteps: number;
}

/** Đo trên màn đang mở: chữ dưới 13px, vùng chạm dưới 44px, cuộn ngang, số bước có aria-current. */
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
    const sel = 'button, a[href], [role="button"], [role="link"], input:not([type="hidden"]), select, textarea, summary';
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (!shown(el) || el.closest('[inert], [aria-hidden="true"]') || el.tabIndex === -1 || /tubu-hit|sr-only/.test(el.className)) continue;
      const r = el.getBoundingClientRect();
      const inline = getComputedStyle(el).display === 'inline' && el.closest('p, span, div')?.textContent !== el.textContent;
      if (inline) continue;
      if (r.height < 43.5 || r.width < 43.5) {
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40);
        smallTargets.push(`${name} (${Math.round(r.width)}x${Math.round(r.height)})`);
      }
    }
    const scrollers = [document.documentElement, ...document.querySelectorAll<HTMLElement>('.zaui-page')];
    const hScroll = scrollers.some((el) => el.scrollWidth > el.clientWidth + 1);
    const currentSteps = document.querySelectorAll('[aria-current="step"]').length;
    return { smallText: [...new Set(smallText)], smallTargets: [...new Set(smallTargets)], hScroll, currentSteps };
  });
}

/** Chụp khung nhìn (thấy thanh dính đáy) và cả trang; tên theo cạnh + khổ + trạng thái. Không có HL_SHOT_DIR thì bỏ qua. */
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

export async function openState(page: Page, side: Side, size: 375 | 1280, code: string): Promise<void> {
  if (shotDir()) await installVisualMode(page);
  await page.setViewportSize(size === 375 ? { width: 375, height: 812 } : { width: 1280, height: 800 });
  await page.goto(side === 'miniapp' ? `/order/${code}` : `/tai-khoan/don-hang/${code}`);
}
