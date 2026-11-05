// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Gói hl: mỗi trạng thái đơn đúng một nút chính, nút cấm không bao giờ hiện, hành trình có aria-current và mốc hãng gộp dưới "Đang giao".

const NOW = '2026-11-05T05:00:00.000Z';
const hoursFromNow = (h: number) => new Date(Date.parse(NOW) + h * 3_600_000).toISOString();

const mocks = vi.hoisted(() => ({ order: null as unknown, returns: [] as unknown[], writeText: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => ({ hotline: '0984 606 774', email: 'tubutree@gmail.com' }),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({ code: 'TB-9' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchOrder: async () => mocks.order,
  fetchMyReturns: async () => mocks.returns,
  fetchMyRefunds: async () => [],
  getPublicConfig: async () => ({ returnWindowDays: 7, shippingEta: { minDays: 1, maxDays: 3 } }),
  getBankQr: async () => ({
    orderCode: 'TB-9', amount: 1, paymentStatus: 'UNPAID',
    bank: { bin: '1', name: 'B', accountNo: '1', accountName: 'A' }, memo: 'TB-9', qrString: 'x', qrImageUrl: 'https://img.vietqr.io/x.png',
  }),
}));

import OrderDetailPage from './page';

const BASE = {
  id: 'o1',
  code: 'TB-9',
  status: 'CONFIRMED',
  subtotal: 300000,
  discount: 0,
  shippingFee: 0,
  total: 300000,
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  createdAt: hoursFromNow(-48),
  updatedAt: hoursFromNow(-2),
  pointsUsed: 0,
  pointsEarned: 0,
  shippingAddress: { recipient: 'An', phone: '0912345678', street: '1 Xuân Thuỷ', ward: 'Cầu Giấy', province: 'Hà Nội' },
  items: [{ id: 'i1', productName: 'Dầu gội', variationName: '500ml', unitPrice: 150000, quantity: 2, total: 300000 }],
};
const REVIEWED = [{ ...BASE.items[0], productSlug: 'dau-goi', reviewId: 'r1' }];
const UNREVIEWED = [{ ...BASE.items[0], productSlug: 'dau-goi', reviewable: true }];
const HISTORY = [
  { at: hoursFromNow(-30), status: 'Chờ lấy hàng' },
  { at: hoursFromNow(-24), status: 'Đã lấy hàng' },
  { at: hoursFromNow(-6), status: 'Đang vận chuyển' },
  { at: hoursFromNow(-1), status: 'Đang giao hàng' },
];

interface Row {
  name: string;
  order: Record<string, unknown>;
  primary: string;
  menu: string[];
  absent: string[];
}
const ROWS: Row[] = [
  {
    name: 'chờ chuyển khoản còn hạn',
    order: { status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentDeadline: hoursFromNow(2), canCancel: true },
    primary: 'Thanh toán ngay',
    menu: ['Huỷ đơn', 'Liên hệ Tubu'],
    absent: ['Mua lại đơn này', 'Yêu cầu đổi/trả', 'Đánh giá sản phẩm'],
  },
  {
    name: 'chờ chuyển khoản, Tubu xử lý tay',
    order: { status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentDeadline: hoursFromNow(2), canCancel: false, manualHandling: true },
    primary: 'Liên hệ Tubu',
    menu: [],
    absent: ['Thanh toán ngay', 'Huỷ đơn', 'Mua lại đơn này'],
  },
  {
    name: 'đã xác nhận, huỷ được',
    order: { status: 'CONFIRMED', canCancel: true },
    primary: 'Huỷ đơn',
    menu: ['Liên hệ Tubu'],
    absent: ['Thanh toán ngay', 'Mua lại đơn này', 'Yêu cầu đổi/trả'],
  },
  {
    name: 'đóng gói, API báo không huỷ được',
    order: { status: 'PACKED', canCancel: false },
    primary: 'Liên hệ Tubu',
    menu: [],
    absent: ['Huỷ đơn', 'Thanh toán ngay', 'Mua lại đơn này'],
  },
  {
    name: 'hãng đã nhận hàng',
    order: { status: 'PACKED', shippingCode: 'GHN123', shippingPartner: 'Giao Hàng Nhanh' },
    primary: 'Liên hệ Tubu',
    menu: [],
    absent: ['Huỷ đơn', 'Thanh toán ngay', 'Mua lại đơn này'],
  },
  {
    name: 'đang giao',
    order: { status: 'SHIPPING', shippingCode: 'GHN6789012345', shippingPartner: 'Giao Hàng Nhanh', shippingHistory: HISTORY },
    primary: 'Liên hệ Tubu',
    menu: [],
    absent: ['Huỷ đơn', 'Thanh toán ngay', 'Mua lại đơn này', 'Yêu cầu đổi/trả'],
  },
  {
    name: 'đã giao, còn dòng chưa đánh giá',
    order: { status: 'DELIVERED', deliveredAt: hoursFromNow(-24), items: UNREVIEWED },
    primary: 'Đánh giá sản phẩm',
    menu: ['Mua lại đơn này', 'Yêu cầu đổi/trả', 'Liên hệ Tubu'],
    absent: ['Huỷ đơn', 'Thanh toán ngay'],
  },
  {
    name: 'đã giao, đã đánh giá hết',
    order: { status: 'DELIVERED', deliveredAt: hoursFromNow(-24), items: REVIEWED },
    primary: 'Mua lại đơn này',
    menu: ['Yêu cầu đổi/trả', 'Liên hệ Tubu'],
    absent: ['Huỷ đơn', 'Thanh toán ngay', 'Đánh giá sản phẩm'],
  },
  {
    name: 'đã giao quá hạn đổi/trả',
    order: { status: 'DELIVERED', deliveredAt: hoursFromNow(-24 * 10), items: REVIEWED },
    primary: 'Mua lại đơn này',
    menu: ['Liên hệ Tubu'],
    absent: ['Yêu cầu đổi/trả', 'Huỷ đơn'],
  },
  {
    name: 'đã huỷ',
    order: { status: 'CANCELLED', canCancel: false },
    primary: 'Mua lại đơn này',
    menu: ['Liên hệ Tubu'],
    absent: ['Huỷ đơn', 'Thanh toán ngay', 'Yêu cầu đổi/trả'],
  },
  {
    name: 'đã hoàn',
    order: { status: 'RETURNED', paymentStatus: 'PAID' },
    primary: 'Mua lại đơn này',
    menu: ['Liên hệ Tubu'],
    absent: ['Huỷ đơn', 'Thanh toán ngay'],
  },
];

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrderDetailPage />);
  mounted.push(r);
  await flush(10);
  return r;
};
const barLabels = (c: HTMLElement) =>
  Array.from(c.querySelector('[data-testid="order-action-bar"]')!.querySelectorAll('button'))
    .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())
    .filter((t) => t !== 'Thêm thao tác');
const menuRows = () => Array.from(document.body.querySelectorAll('[role="group"] [role="button"]')).map((n) => n.textContent?.trim());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  mocks.returns = [];
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: mocks.writeText.mockResolvedValue(undefined) } });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('chi tiết đơn web — nút theo trạng thái (gói hl)', () => {
  it.each(ROWS)('khối "Cần hỗ trợ?" ở cuối trang, hotline và email mang mã đơn: $name', async (row) => {
    mocks.order = { ...BASE, ...row.order };
    const { container } = await mount();
    const block = Array.from(container.querySelectorAll('div')).find((d) => d.firstElementChild?.textContent === 'Cần hỗ trợ?')!;
    expect(block).toBeTruthy();
    expect(block.querySelector('a[href="tel:0984606774"]')?.textContent).toBe('Gọi hotline 0984 606 774');
    expect(block.querySelector('a[href^="mailto:tubutree@gmail.com?subject="]')!.getAttribute('href')).toContain(encodeURIComponent('Hỗ trợ đơn TB-9'));
    const hero = container.querySelector('[data-testid="status-hero"]')!;
    expect(hero.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(ROWS)('$name', async (row) => {
    mocks.order = { ...BASE, ...row.order };
    const { container } = await mount();
    expect(barLabels(container)).toEqual([row.primary]);
    const more = container.querySelector('button[aria-label="Thêm thao tác"]');
    expect(!!more).toBe(row.menu.length > 0);
    const visibleButtons = Array.from(container.querySelectorAll('button, a, [role="button"]')).map((n) => n.textContent?.trim());
    for (const name of row.absent) expect(visibleButtons).not.toContain(name);
    if (more) {
      click(more);
      expect(menuRows()).toEqual(row.menu);
    }
  });

  it('đang giao: đủ h1/h2, không nhảy cấp, mọi điều khiển có tên và vùng chạm 44px', async () => {
    mocks.order = { ...BASE, ...ROWS[5]!.order };
    const { container } = await mount();
    expect(headingProblems(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });

  it('đang giao: hành trình có đúng một bước aria-current, mốc hãng mới nhất trên cùng, mã vận đơn chép được', async () => {
    mocks.order = { ...BASE, ...ROWS[5]!.order };
    const { container } = await mount();
    const list = container.querySelector('ol[aria-label="Hành trình đơn hàng"]')!;
    const current = list.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain('Đang giao');
    const events = Array.from(list.querySelectorAll('ul[aria-label="Mốc vận chuyển"] > li')).map((li) => li.querySelector('div')?.textContent);
    expect(events).toEqual(['Đang giao hàng', 'Đang vận chuyển', 'Đã lấy hàng', 'Chờ lấy hàng']);
    expect(container.textContent).toContain('Giao Hàng Nhanh');
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Chép mã') ?? null);
    await flush();
    expect(mocks.writeText).toHaveBeenCalledWith('GHN6789012345');
  });

  it('chờ chuyển khoản còn hạn: đầu trang ghi hạn trả kèm thời gian còn lại, nút chính nằm cạnh dòng còn bao lâu', async () => {
    mocks.order = { ...BASE, ...ROWS[0]!.order };
    const { container } = await mount();
    expect(container.querySelector('[data-testid="status-hero"]')?.textContent).toMatch(/Thanh toán trước 14:00 05\/11, còn 2 giờ/);
    expect(container.querySelector('[data-testid="order-action-note"]')?.textContent).toMatch(/Còn 2 giờ/);
  });

  it('đơn huỷ mà lịch sử vận chuyển toàn dòng rác: không dựng khung vận chuyển trống', async () => {
    mocks.order = {
      ...BASE,
      status: 'CANCELLED',
      statusTimes: { CANCELLED: hoursFromNow(-6) },
      shippingHistory: [{ at: hoursFromNow(-6) }, { at: hoursFromNow(-5), status: '', code: null }, null],
    };
    const { container } = await mount();
    expect(container.textContent).toContain('Đơn đã huỷ.');
    expect(container.querySelector('[data-testid="order-shipping"]')).toBeNull();
    const emptyFrames = Array.from(container.querySelectorAll('section')).filter((s) => !s.textContent?.trim());
    expect(emptyFrames).toHaveLength(0);
  });

  it('đơn chuyển khoản đã huỷ mà API chưa trả cancelReason: chỉ nói "Đơn đã huỷ.", không suy ra lý do quá hạn thanh toán', async () => {
    mocks.order = {
      ...BASE,
      status: 'CANCELLED',
      paymentMethod: 'BANK_TRANSFER',
      paymentDeadline: hoursFromNow(-6),
      statusTimes: { CANCELLED: hoursFromNow(-6) },
    };
    const { container } = await mount();
    expect(container.textContent).toContain('Đơn đã huỷ.');
    expect(container.textContent).not.toContain('quá hạn thanh toán');
    expect(container.querySelector('[data-testid="order-cancel-reason"]')).toBeNull();
  });

  it('đơn huỷ API trả cancelReason: khối đầu trang hiện đúng câu lý do (lời khách, tự huỷ quá hạn, Tubu huỷ)', async () => {
    for (const reason of ['Bạn đã huỷ: Đổi ý, không muốn mua nữa', 'Đơn tự huỷ vì quá hạn thanh toán', 'Tubu Tree đã huỷ đơn này. Cần biết thêm, bạn liên hệ CSKH.']) {
      mocks.order = { ...BASE, status: 'CANCELLED', statusTimes: { CANCELLED: hoursFromNow(-6) }, cancelReason: reason };
      const { container } = await mount();
      expect(container.querySelector('[data-testid="status-hero"] [data-testid="order-cancel-reason"]')?.textContent).toBe(reason);
    }
  });
});
