import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  fetchOrder: vi.fn(),
  fetchMyReturns: vi.fn(),
  getPublicConfig: vi.fn(),
  cancelOrder: vi.fn(),
  fetchMyRefunds: vi.fn(),
  fetchRefundBank: vi.fn(),
  getWasteRequestByOrder: vi.fn(),
  copyText: vi.fn(),
  coreGet: vi.fn(),
  supportContact: vi.fn(),
  search: '',
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useParams: () => ({ code: 'TT001' }),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/orders/TT001', search: mocks.search, state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  fetchOrder: mocks.fetchOrder,
  fetchOrders: vi.fn(),
  getPublicConfig: mocks.getPublicConfig,
  fetchMyReturns: mocks.fetchMyReturns,
  cancelOrder: mocks.cancelOrder,
  fetchMyRefunds: mocks.fetchMyRefunds,
  fetchRefundBank: mocks.fetchRefundBank,
  chooseRefundDestination: vi.fn(),
  requestReturn: vi.fn(),
  addToCart: vi.fn(),
  repurchaseOrder: vi.fn(),
  getCart: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock('../services/waste-api', async (orig) => ({
  ...(await orig<object>()),
  getWasteRequestByOrder: mocks.getWasteRequestByOrder,
}));
vi.mock('../services/zmp-bridge', () => ({
  hasOA: false,
  openOAChat: vi.fn(),
  openExternal: vi.fn(),
  followOA: vi.fn(),
  requestNotifyPermission: vi.fn(),
  getOaPromptState: vi.fn().mockResolvedValue({ promptSeen: true }),
  setOaPromptState: vi.fn(),
  shouldShowFollowOaPrompt: () => false,
}));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', user: { id: 'u1' } };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../components/image-upload', () => ({ MultiImageUpload: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.coreGet, post: vi.fn().mockResolvedValue({ recorded: true }) } }));
vi.mock('./about-data', async (orig) => {
  const real = await orig<{ fetchSupportContact: () => Promise<unknown> }>();
  mocks.supportContact.mockImplementation(real.fetchSupportContact);
  return { ...real, fetchSupportContact: () => mocks.supportContact() };
});

import OrderDetailPage from './order-detail';
import { ORDER_CSAT_COPY } from '@tubutree/app-core/order-csat';
import { STATUS_COLOR } from '../utils/order-status';
import { makeRequestDetail } from '../services/waste-test-fixtures';

const ORDER = {
  id: 'o1',
  code: 'TT001',
  status: 'DELIVERED',
  paymentMethod: 'COD',
  paymentStatus: 'PAID',
  createdAt: '2026-10-01T03:00:00.000Z',
  subtotal: 100_000,
  discount: 0,
  pointsUsed: 0,
  pointsEarned: 0,
  shippingFee: 20_000,
  total: 120_000,
  hasRecyclingPickup: false,
  shippingAddress: { recipient: 'Ánh', phone: '0911111111', street: '1 Lê Lợi', ward: 'Phường Bến Nghé', province: 'TP. Hồ Chí Minh' },
  items: [
    { id: 'oi1', productName: 'Xà bông thảo mộc', variationName: 'Sả', productSlug: 'xa-bong', quantity: 2, total: 100_000, backorderedQty: 0 },
  ],
};

// Mốc giờ hiện theo giờ Việt Nam và bỏ năm khi cùng năm với giờ hiện tại: cố định "bây giờ" để test không trôi theo năm.
function fixNow(iso = '2026-11-05T05:00:00.000Z') {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderDetailPage />
    </QueryClientProvider>,
  );
}

describe('OrderDetailPage — vùng chạm >= 44px (C-021)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue(ORDER);
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it('đơn đã giao: lối vào "Viết đánh giá" có vùng chạm 44px và mở trang sản phẩm kèm đúng đơn để viết cho lần mua này', async () => {
    renderPage();
    const link = await screen.findByText(/Viết đánh giá/);
    expect(link.className).toContain('tubu-hit-44');
    fireEvent.click(link);
    expect(mocks.navigate).toHaveBeenCalledWith('/product/xa-bong', { state: { reviewOrderId: 'o1' } });
  });
});

describe('OrderDetailPage — giải thích vì sao không còn nút huỷ (R6-BUYER-10)', () => {
  const NOTE = /đơn không huỷ được\. Khi nhận hàng, bạn có thể đổi\/trả trong 7 ngày/;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it('đơn đang giao: có câu giải thích và không có nút huỷ', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING' });
    renderPage();
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
  });

  it('đơn đã xác nhận còn huỷ được: không có câu giải thích', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'CONFIRMED' });
    renderPage();
    await screen.findByText(/Chi tiết đơn hàng/);
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('đơn đã giao xong: không có câu giải thích', async () => {
    mocks.fetchOrder.mockResolvedValue(ORDER);
    renderPage();
    await screen.findByText(/Chi tiết đơn hàng/);
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

describe('OrderDetailPage — đơn không có (R6-BUYER-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it('404 → "Không tìm thấy" kèm "Về trang chủ", không có "Thử lại"', async () => {
    mocks.fetchOrder.mockRejectedValue(new HttpError('nf', '404', { status: 404, data: {} }));
    renderPage();
    expect(await screen.findByText('Không tìm thấy đơn hàng này.')).toBeInTheDocument();
    expect(screen.queryByText('Thử lại')).toBeNull();
    fireEvent.click(screen.getByText('Về trang chủ'));
    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });

  it('lỗi máy chủ 5xx → vẫn "Thử lại"', async () => {
    mocks.fetchOrder.mockRejectedValue(new HttpError('boom', '500', { status: 500, data: {} }));
    renderPage();
    expect(await screen.findByText('Thử lại')).toBeInTheDocument();
    expect(screen.queryByText('Về trang chủ')).toBeNull();
  });
});

// R8: mỗi lần mua một đánh giá; API trả trạng thái đánh giá của từng dòng ở chính đơn này.
describe('OrderDetailPage — đánh giá theo từng dòng của đơn (R8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  const withItem = (extra: Record<string, unknown>) => ({ ...ORDER, items: [{ ...ORDER.items[0], ...extra }] });

  it('dòng đã đánh giá ở đơn này → "Sửa đánh giá", mở trang sản phẩm kèm đơn để sửa đúng đánh giá đó', async () => {
    mocks.fetchOrder.mockResolvedValue(withItem({ reviewId: 'r1', reviewable: false }));
    renderPage();
    fireEvent.click(await screen.findByText('Sửa đánh giá'));
    expect(screen.queryByText('Viết đánh giá')).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith('/product/xa-bong', { state: { reviewOrderId: 'o1' } });
  });

  it('dòng còn viết được → "Viết đánh giá"', async () => {
    mocks.fetchOrder.mockResolvedValue(withItem({ reviewId: null, reviewable: true }));
    renderPage();
    expect(await screen.findByText('Viết đánh giá')).toBeInTheDocument();
    expect(screen.queryByText('Sửa đánh giá')).toBeNull();
  });

  it('đơn không tính để đánh giá (vd. CTV đặt hộ) → không có lối vào đánh giá', async () => {
    mocks.fetchOrder.mockResolvedValue(withItem({ reviewId: null, reviewable: false }));
    renderPage();
    expect((await screen.findAllByText(/Xà bông thảo mộc/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Viết đánh giá|Sửa đánh giá/)).toBeNull();
    expect(screen.queryByTestId('order-line-returned')).toBeNull();
  });
});

// tubu-w25-02 (PO A5): cùng luật với "Đánh giá (n SP)" ở thẻ đơn — món đã trả không còn lối "Viết đánh giá", chỉ một dòng trạng thái mờ.
describe('OrderDetailPage — món đã trả (tubu-w25-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = '';
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  const order = (items: Record<string, unknown>[]) => ({ ...ORDER, items: items.map((it, i) => ({ ...ORDER.items[0], id: `oi${i + 1}`, ...it })) });

  it('trả hết, tiền đã về → "Đã hoàn tiền" mờ, không có nút viết; món chưa trả cùng đơn vẫn "Viết đánh giá" (tên truy cập kèm tên món)', async () => {
    mocks.fetchOrder.mockResolvedValue(
      order([
        { productName: 'Xà bông thảo mộc', reviewId: null, reviewable: false, returnedQty: 2, refundDone: true },
        { productName: 'Nước giặt', productSlug: 'nuoc-giat', reviewId: null, reviewable: true },
      ]),
    );
    renderPage();
    const status = await screen.findByTestId('order-line-returned');
    expect(status).toHaveTextContent(/^Đã hoàn tiền$/);
    expect(status.tagName).not.toBe('BUTTON');
    expect(status.style.color).toBe('var(--color-text-tertiary)');
    expect(screen.getAllByText('Viết đánh giá')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Viết đánh giá Nước giặt' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-giat', { state: { reviewOrderId: 'o1' } });
  });

  it('trả một phần, tiền đã về → "Đã hoàn tiền 1/2"', async () => {
    mocks.fetchOrder.mockResolvedValue(order([{ reviewId: null, reviewable: false, returnedQty: 1, refundDone: true }]));
    renderPage();
    expect(await screen.findByTestId('order-line-returned')).toHaveTextContent('Đã hoàn tiền 1/2');
    expect(screen.queryByText(/Viết đánh giá/)).toBeNull();
  });

  it('tiền chưa về (chuyển khoản còn chờ, lần trả 0đ) → "Đã duyệt trả 2/2", không nói "hoàn tiền"', async () => {
    mocks.fetchOrder.mockResolvedValue(order([{ reviewId: null, reviewable: false, returnedQty: 2, refundDone: false }]));
    renderPage();
    expect(await screen.findByTestId('order-line-returned')).toHaveTextContent(/^Đã duyệt trả 2\/2$/);
    expect(screen.queryByText(/Đã hoàn tiền|Viết đánh giá/)).toBeNull();
  });

  it('đã đánh giá trước khi trả → vẫn "Sửa đánh giá", không thêm dòng trạng thái', async () => {
    mocks.fetchOrder.mockResolvedValue(order([{ reviewId: 'r1', reviewable: false, returnedQty: 2, refundDone: true }]));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Sửa đánh giá Xà bông thảo mộc' })).toHaveTextContent('Sửa đánh giá');
    expect(screen.queryByTestId('order-line-returned')).toBeNull();
  });
});

describe('OrderDetailPage — mở từ "Đánh giá (n SP)" (?review=1, tubu-w25-02)', () => {
  const matchMedia = window.matchMedia;
  const scrollIntoView = Element.prototype.scrollIntoView;
  let scrolled: { el: Element; opts: unknown }[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    scrolled = [];
    Element.prototype.scrollIntoView = function (this: Element, opts?: unknown) {
      scrolled.push({ el: this, opts });
    };
  });
  afterEach(() => {
    mocks.search = '';
    window.matchMedia = matchMedia;
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  const ITEMS = [
    { ...ORDER.items[0], id: 'oi1', productName: 'Xà bông đã trả', reviewId: null, reviewable: false, returnedQty: 2, refundDone: true },
    { ...ORDER.items[0], id: 'oi2', productName: 'Dầu gội đã viết', productSlug: 'dau-goi', reviewId: 'r2', reviewable: false },
    { ...ORDER.items[0], id: 'oi3', productName: 'Nước giặt', productSlug: 'nuoc-giat', reviewId: null, reviewable: true },
    { ...ORDER.items[0], id: 'oi4', productName: 'Nước rửa chén', productSlug: 'nuoc-rua-chen', reviewId: null, reviewable: true },
  ];
  const reduceMotion = (on: boolean) => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: on && q === '(prefers-reduced-motion: reduce)', media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never;
  };

  it('cuộn mượt tới món đầu tiên còn lối viết (bỏ món đã trả, món đã đánh giá) và đặt focus vào nút "Viết đánh giá" của món đó', async () => {
    mocks.search = '?review=1';
    reduceMotion(false);
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, items: ITEMS });
    renderPage();
    await waitFor(() => expect(scrolled).toHaveLength(1));
    const row = scrolled[0]!.el as HTMLElement;
    expect(row.textContent).toContain('Nước giặt');
    expect(row.textContent).not.toContain('Nước rửa chén');
    expect(scrolled[0]!.opts).toEqual({ behavior: 'smooth', block: 'center' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Viết đánh giá Nước giặt');
    expect(row.contains(document.activeElement)).toBe(true);
  });

  it('bật giảm chuyển động → nhảy thẳng (behavior auto)', async () => {
    mocks.search = '?review=1';
    reduceMotion(true);
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, items: ITEMS });
    renderPage();
    await waitFor(() => expect(scrolled).toHaveLength(1));
    expect(scrolled[0]!.opts).toEqual({ behavior: 'auto', block: 'center' });
  });

  it('quay lại sau khi viết: bản đệm cũ còn mời món vừa viết → chờ đơn mới rồi mới cuộn, tới món kế tiếp còn chờ', async () => {
    mocks.search = '?review=1';
    reduceMotion(false);
    const stale = { ...ORDER, items: ITEMS };
    const fresh = { ...ORDER, items: ITEMS.map((it) => (it.id === 'oi3' ? { ...it, reviewId: 'r3', reviewable: false } : it)) };
    let release: (v: unknown) => void = () => undefined;
    mocks.fetchOrder.mockReturnValue(new Promise((r) => (release = r)));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(['order', 'TT001'], stale);
    await qc.invalidateQueries({ queryKey: ['order'] });
    render(
      <QueryClientProvider client={qc}>
        <OrderDetailPage />
      </QueryClientProvider>,
    );
    expect(await screen.findAllByText('Viết đánh giá')).toHaveLength(2);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(scrolled).toEqual([]);
    await act(async () => {
      release(fresh);
    });
    await waitFor(() => expect(scrolled).toHaveLength(1));
    expect((scrolled[0]!.el as HTMLElement).textContent).toContain('Nước rửa chén');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Viết đánh giá Nước rửa chén');
  });

  it('không có ?review=1 → không cuộn, không cướp focus', async () => {
    reduceMotion(false);
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, items: ITEMS });
    renderPage();
    expect(await screen.findAllByText('Viết đánh giá')).toHaveLength(2);
    expect(scrolled).toHaveLength(0);
    expect(document.activeElement?.textContent).not.toBe('Viết đánh giá');
  });

  it('?review=1 mà mọi món đã đánh giá/đã trả → không cuộn', async () => {
    mocks.search = '?review=1';
    reduceMotion(false);
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, items: ITEMS.slice(0, 2) });
    renderPage();
    expect(await screen.findByText('Sửa đánh giá')).toBeInTheDocument();
    expect(scrolled).toHaveLength(0);
  });
});

describe('OrderDetailPage — sản phẩm đã gỡ không dẫn tới trang 404', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it('productPublic=false → không nút đánh giá, dòng món không là liên kết, tên món vẫn hiện', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, items: [{ ...ORDER.items[0], reviewId: null, reviewable: true, productPublic: false }] });
    renderPage();
    expect((await screen.findAllByText(/Xà bông thảo mộc/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Viết đánh giá|Sửa đánh giá/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Xem sản phẩm Xà bông thảo mộc' })).toBeNull();
  });

  it('productPublic=true → vẫn có nút đánh giá và liên kết món', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, items: [{ ...ORDER.items[0], reviewId: null, reviewable: true, productPublic: true }] });
    renderPage();
    expect(await screen.findByText('Viết đánh giá')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem sản phẩm Xà bông thảo mộc' })).toBeInTheDocument();
  });
});

describe('OrderDetailPage — đơn đặt định kỳ không hiện ghi chú tiếng Anh như lời khách', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
  });
  const subscription = (extra: Record<string, unknown> = {}) => ({
    ...ORDER,
    source: 'subscription',
    note: 'Đơn đặt định kỳ (Subscribe & Save)',
    discount: 12_000,
    ...extra,
  });

  it('thay khối "Ghi chú" bằng nhãn "Đơn định kỳ"; không còn chữ Subscribe & Save', async () => {
    mocks.fetchOrder.mockResolvedValue(subscription());
    renderPage();
    expect(await screen.findByText('Đơn định kỳ')).toBeInTheDocument();
    expect(screen.queryByText('Ghi chú')).toBeNull();
    expect(screen.queryByText(/Subscribe/)).toBeNull();
  });

  it('dòng giảm giá là "Ưu đãi đặt định kỳ"', async () => {
    mocks.fetchOrder.mockResolvedValue(subscription());
    renderPage();
    expect(await screen.findByText('Ưu đãi đặt định kỳ')).toBeInTheDocument();
  });

  it('ghi chú khác (CSKH sửa) của đơn định kỳ vẫn hiện như ghi chú', async () => {
    mocks.fetchOrder.mockResolvedValue(subscription({ note: 'Giao sau 17h' }));
    renderPage();
    expect(await screen.findByText('Giao sau 17h')).toBeInTheDocument();
    expect(screen.getByText('Ghi chú')).toBeInTheDocument();
  });
});

describe('OrderDetailPage — lịch sử vận chuyển bằng tiếng Việt (C-120)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  const withShipping = (shippingHistory: unknown[], extra: Record<string, unknown> = {}) => ({
    ...ORDER,
    status: 'SHIPPING',
    shippingPartner: 'GHN',
    shippingCode: 'GHN001',
    shippingHistory,
    ...extra,
  });

  it('mã hãng "delivering" hiện "Đang giao hàng", không lộ mã gốc', async () => {
    mocks.fetchOrder.mockResolvedValue(
      withShipping([{ at: '2026-10-02T03:00:00.000Z', status: 'delivering', carrier: 'GHN', code: 'GHN001' }], {
        shippingStatus: 'delivering',
      }),
    );
    const { container } = renderPage();
    await screen.findByRole('list', { name: 'Hành trình đơn hàng' });
    expect(screen.getAllByText('Đang giao hàng').length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).not.toContain('delivering');
  });

  it('mã lạ → "Đang cập nhật"; trạng thái rỗng mà có mã vận đơn → "Đã gán mã vận đơn" (B-26); chuỗi tiếng Việt giữ nguyên', async () => {
    mocks.fetchOrder.mockResolvedValue(
      withShipping([
        { at: '2026-10-02T03:00:00.000Z', status: 'Đã lấy hàng', carrier: 'GHN', code: 'GHN001' },
        { at: '2026-10-02T05:00:00.000Z', status: 'xyz_weird_code', carrier: 'GHN', code: 'GHN001' },
        { at: '2026-10-02T06:00:00.000Z', status: null, carrier: 'GHN', code: 'GHN001' },
      ]),
    );
    const { container } = renderPage();
    await screen.findByRole('list', { name: 'Hành trình đơn hàng' });
    expect(screen.getByText('Đã lấy hàng')).toBeInTheDocument();
    expect(screen.getByText('Đang cập nhật')).toBeInTheDocument();
    expect(screen.getByText('Đã gán mã vận đơn GHN001')).toBeInTheDocument();
    expect(container.textContent).not.toContain('—');
    expect(container.textContent).not.toContain('xyz_weird_code');
  });

  it('mốc thời gian hiện "HH:mm dd/MM" theo giờ Việt Nam, thêm năm khi khác năm hiện tại', async () => {
    fixNow();
    mocks.fetchOrder.mockResolvedValue(
      withShipping([
        { at: '2026-10-02T01:05:00.000Z', status: 'delivered', carrier: 'GHN', code: 'GHN001' },
        { at: '2025-12-31T16:30:00.000Z', status: 'Đã lấy hàng', carrier: 'GHN', code: 'GHN001' },
      ]),
    );
    renderPage();
    await screen.findByRole('list', { name: 'Hành trình đơn hàng' });
    expect(screen.getByText('08:05 02/10')).toBeInTheDocument();
    expect(screen.getByText('23:30 31/12/2025')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('R2-BUYERMINI-8: tóm tắt tiền tách mã giảm giá và Điểm Xanh bằng số tiền thật, không còn dòng "N điểm" trơ', async () => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      discount: 98_000,
      couponCode: 'XANH10',
      couponDiscount: 38_000,
      pointsDiscount: 60_000,
      pointsUsed: 60,
    });
    renderPage();
    expect(await screen.findByText('Mã giảm giá (XANH10)')).toBeInTheDocument();
    expect(screen.getByText('-38.000đ')).toBeInTheDocument();
    expect(screen.getByText('Điểm Xanh (60 điểm)')).toBeInTheDocument();
    expect(screen.getByText('-60.000đ')).toBeInTheDocument();
    expect(screen.queryByText('Điểm Xanh đã dùng')).toBeNull();
  });

  it('điểm đã dùng có dấu nghìn: "12.000 điểm"', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, pointsUsed: 12_000, discount: 12_000 });
    renderPage();
    expect(await screen.findByText('12.000 điểm')).toBeInTheDocument();
  });
});

describe('OrderDetailPage — điểm, mốc giờ, hành trình, đổi/trả, hỗ trợ (BUYERMINI-14/15/16/19)', () => {
  const NOW = Date.now();
  const daysAgo = (d: number) => new Date(NOW - d * 864e5).toISOString();
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('đơn đang giao: "Nhận +N khi giao thành công"; đơn đã hoàn: điểm đã thu hồi', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING', pointsEarned: 35 });
    const first = renderPage();
    expect(await screen.findByText('Nhận +35 Điểm Xanh khi giao thành công')).toBeInTheDocument();
    first.unmount();

    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'RETURNED', pointsEarned: 35 });
    renderPage();
    expect(await screen.findByText('Điểm Xanh của đơn này đã được thu hồi')).toBeInTheDocument();
    expect(screen.queryByText(/khi giao thành công/)).toBeNull();
  });

  it('đơn đã giao ghi "Giao lúc" theo mốc giao; đơn khác ghi "Đặt lúc" theo giờ tạo đơn', async () => {
    fixNow();
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'DELIVERED', deliveredAt: '2026-10-05T02:30:00.000Z' });
    const first = renderPage();
    // Giờ giao nằm ở đầu trang trạng thái và cả ở thanh tiến trình 4 bước: phép tra về đúng đầu trang.
    const hero = await screen.findByTestId('status-hero');
    expect(within(hero).getByText('09:30 05/10')).toBeInTheDocument();
    expect(within(hero).getByText(/Giao lúc/)).toBeInTheDocument();
    first.unmount();

    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING' });
    renderPage();
    expect(await screen.findByText(/Đặt lúc/)).toBeInTheDocument();
  });

  it('hành trình ghi giờ từng bước đã tới; bước chưa tới không có giờ; đơn huỷ ghi "Huỷ lúc"', async () => {
    fixNow();
    const at = (d: number, h: number, m: number) => new Date(Date.UTC(2026, 9, d, h - 7, m)).toISOString();
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      status: 'PACKED',
      paymentMethod: 'COD',
      createdAt: at(1, 8, 0),
      statusTimes: { CONFIRMED: at(1, 8, 5), PACKED: at(2, 9, 30) },
    });
    const first = renderPage();
    await screen.findByRole('list', { name: 'Hành trình đơn hàng' });
    // Thanh tiến trình 4 bước cũng ghi các mốc này: chỉ kiểm danh sách Hành trình đơn hàng.
    const track = within(screen.getByRole('list', { name: 'Hành trình đơn hàng' }));
    expect(track.getByText(/^08:05 01\/10/)).toBeInTheDocument();
    expect(track.getByText(/^09:30 02\/10/)).toBeInTheDocument();
    expect(track.getAllByText(/^\d\d:\d\d \d\d\/10/).length).toBeGreaterThanOrEqual(2);
    first.unmount();

    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'CANCELLED', createdAt: at(1, 8, 0), statusTimes: { CANCELLED: at(3, 14, 45) } });
    renderPage();
    expect(await screen.findByText(/Huỷ lúc/)).toBeInTheDocument();
    expect(within(screen.getByTestId('status-hero')).getByText('14:45 03/10')).toBeInTheDocument();
  });

  it('đơn đã giao không có mốc hãng: chỉ còn thanh 4 bước, không lặp thêm danh sách Hành trình đơn hàng', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'DELIVERED', paymentMethod: 'COD', shippingHistory: [] });
    renderPage();
    await screen.findByText('Đã tiếp nhận');
    expect(screen.queryByRole('list', { name: 'Hành trình đơn hàng' })).toBeNull();
  });

  it('đơn đã giao mà hãng còn để lại mốc vận chuyển: vẫn có danh sách Hành trình đơn hàng', async () => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      shippingHistory: [{ at: '2026-10-02T03:00:00.000Z', status: 'Đã lấy hàng', carrier: 'GHN', code: 'GHN001' }],
    });
    renderPage();
    expect(await screen.findByRole('list', { name: 'Hành trình đơn hàng' })).toBeInTheDocument();
  });

  it('đơn COD không có bước "Chờ thanh toán" trong hành trình; chuyển khoản thì có', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING', paymentMethod: 'COD' });
    const cod = renderPage();
    await screen.findByTestId('order-shipping');
    expect(screen.queryByText('Chờ thanh toán')).toBeNull();
    expect(screen.getByText('Đã xác nhận')).toBeInTheDocument();
    cod.unmount();

    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING', paymentMethod: 'BANK_TRANSFER' });
    renderPage();
    expect(await screen.findByText('Chờ thanh toán')).toBeInTheDocument();
  });

  it('trong hạn đổi/trả: có nút, icon nằm cùng hàng chữ và câu hướng dẫn theo số ngày cấu hình', async () => {
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 14 });
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'DELIVERED', deliveredAt: daysAgo(10) });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm thao tác' }));
    const btn = await screen.findByRole('button', { name: /Yêu cầu đổi\/trả/ });
    expect(btn.querySelector('svg')).not.toBeNull();
    fireEvent.click(btn);
    expect(await screen.findByText(/Trong 14 ngày từ khi nhận hàng/)).toBeInTheDocument();
  });

  it('quá hạn đổi/trả: đầu trang nói đã hết hạn, menu không có nút đổi/trả', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'DELIVERED', deliveredAt: daysAgo(10) });
    renderPage();
    expect(await screen.findByText('Đã hết hạn đổi/trả.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }));
    await screen.findByRole('group', { name: 'Thao tác với đơn' });
    expect(screen.queryByRole('button', { name: /Yêu cầu đổi\/trả/ })).toBeNull();
  });

  it('chưa gắn OA vẫn có đường liên hệ thật: gọi hotline', async () => {
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7, support: { hotline: '0984 606 774', email: null, zaloOaName: null } });
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING' });
    renderPage();
    expect(await screen.findByRole('button', { name: /Gọi hotline/ })).toBeInTheDocument();
  });
});

// Cùng dải với scripts/uiux/static-scan.mjs, thêm ⌛ ⏳ ⭐.
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿\u231A\u231B\u23E9-\u23FF\u2B50]/u;

describe('OrderDetailPage — tự huỷ tới trước khi bàn giao vận chuyển (D1, BUYERMINI-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7 });
  });

  it('đơn lẻ đang đóng gói vẫn có nút "Huỷ đơn"; đơn đại lý đang đóng gói / đơn đang giao thì không', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, type: 'RETAIL', status: 'PACKED', paymentStatus: 'UNPAID' });
    const packed = renderPage();
    expect(await screen.findByRole('button', { name: 'Huỷ đơn' })).toBeInTheDocument();
    packed.unmount();

    mocks.fetchOrder.mockResolvedValue({ ...ORDER, type: 'DEALER', status: 'PACKED', paymentStatus: 'UNPAID' });
    const dealer = renderPage();
    expect((await screen.findAllByText(/Xà bông/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
    dealer.unmount();

    mocks.fetchOrder.mockResolvedValue({ ...ORDER, type: 'RETAIL', status: 'SHIPPING', paymentStatus: 'UNPAID' });
    renderPage();
    expect((await screen.findAllByText(/Xà bông/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
  });

  it('R3-CANCEL-2: đang đóng gói mà kho đã đặt hãng (mã GHN) — chip "Đã đặt đơn vị vận chuyển", không có nút "Huỷ đơn"', async () => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER, type: 'RETAIL', status: 'PACKED', paymentStatus: 'UNPAID', shippingPartner: 'GHN', shippingCode: 'GHN1933', canCancel: false,
    });
    renderPage();
    expect(await screen.findByText('Đã đặt đơn vị vận chuyển')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
  });

  it('R5-SYNC-1: chờ chuyển khoản mà hàng đã bàn giao (Tubu xử lý tay) — câu trung tính, không hạn "tự huỷ", không nút huỷ hay trả tiền', async () => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      type: 'RETAIL',
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      paymentDeadline: '2026-10-02T03:00:00.000Z',
      canCancel: false,
      manualHandling: true,
    });
    renderPage();
    expect(await screen.findByText('Tubu đang xử lý đơn này, liên hệ CSKH nếu cần hỗ trợ.')).toBeInTheDocument();
    expect(screen.queryByText(/quá hạn đơn sẽ tự huỷ/)).toBeNull();
    expect(screen.queryByText(/Thanh toán trước/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thanh toán ngay' })).toBeNull();
    expect(within(screen.getByTestId('sticky-bar')).getByRole('button', { name: 'Liên hệ Tubu' })).toBeInTheDocument();
  });
});

describe('OrderDetailPage — không dùng emoji làm icon (C-113)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, pointsEarned: 120 });
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it('lối vào đánh giá và dòng điểm Xanh (đơn đã giao) có icon SVG, không có emoji; chữ giữ nguyên', async () => {
    const { container } = renderPage();
    const review = await screen.findByText(/Viết đánh giá/);
    expect(review.querySelector('svg')).not.toBeNull();
    expect(review.className).toContain('tubu-hit-44');
    const points = screen.getByText(/Đã cộng \+120 Điểm Xanh vào tài khoản/);
    expect(points.querySelector('svg')).not.toBeNull();
    expect(EMOJI.test(container.textContent ?? '')).toBe(false);
  });

  it.each([
    ['APPROVED', undefined, 'Đổi/trả đã duyệt — tiền hoàn vào Ví Tubu'],
    ['REJECTED', 'Hàng đã qua sử dụng', 'Đổi/trả bị từ chối: Hàng đã qua sử dụng'],
    ['REJECTED', undefined, 'Đổi/trả bị từ chối'],
    ['PENDING', undefined, 'Yêu cầu đổi/trả đang xử lý (trong 24h)'],
  ])('yêu cầu đổi/trả %s: hiện đúng chữ, icon SVG thay emoji', async (status, adminNote, label) => {
    mocks.fetchMyReturns.mockResolvedValue([{ orderId: 'o1', status, adminNote }]);
    const { container } = renderPage();
    const line = await screen.findByText(label);
    expect(line.querySelector('svg')).not.toBeNull();
    expect(EMOJI.test(container.textContent ?? '')).toBe(false);
  });
});

// axe color-contrast (serious) ở khung trạng thái: chữ ngày giờ dùng opacity 0.8 trên cặp màu trạng thái, riêng
// "chờ thanh toán" #8A5300 trên #FFF4E0 rơi từ 5,81 xuống 3,84 (ngưỡng 4,5). Opacity làm chữ nhạt hơn mức token
// đã cho; ý "phụ" được giữ bằng cỡ chữ xSmall không đậm dưới tiêu đề trạng thái.
const TOKENS = readFileSync(join(process.cwd(), '../../packages/design-tokens/src/tokens.css'), 'utf8');
function resolveToken(ref: string): string {
  const name = ref.match(/^var\((--[\w-]+)\)$/)![1]!;
  const value = TOKENS.match(new RegExp(`${name}:\\s*([^;]+);`))![1]!.trim();
  return value.startsWith('var(') ? resolveToken(value) : value;
}
function luminance(hex: string): number {
  const ch = (at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
}
function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('OrderDetailPage — tương phản chữ ngày giờ ở khung trạng thái (axe color-contrast)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(Object.keys(STATUS_COLOR))('%s: chữ ngày giờ không bị làm mờ bằng opacity', async (status) => {
    fixNow();
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status });
    renderPage();
    const stamps = await screen.findAllByText(/10:00 01\/10$/);
    for (const el of stamps) {
      const opacity = el.style.opacity;
      expect(opacity === '' || Number(opacity) === 1, `opacity=${opacity}`).toBe(true);
    }
  });

  it.each(Object.entries(STATUS_COLOR))('%s: cặp màu token đầy đủ (không opacity) đạt 4,5:1', (_status, { bg, fg }) => {
    expect(contrast(resolveToken(fg), resolveToken(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('OrderDetailPage — huỷ đơn chọn nơi nhận tiền hoàn, hạn thanh toán (D2, BUYERMINI-8/9, MONEY-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.fetchMyRefunds.mockResolvedValue([]);
    mocks.fetchRefundBank.mockResolvedValue({ bankName: 'VCB', accountNumber: '0071000123456', accountName: 'TRAN THI B' });
    mocks.cancelOrder.mockResolvedValue({ ...ORDER, status: 'CANCELLED' });
  });

  const paidTransfer = { ...ORDER, status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', total: 114_000 };

  it('đơn chuyển khoản đã trả: chọn tài khoản ngân hàng → gửi nơi nhận kèm tài khoản điền sẵn', async () => {
    mocks.fetchOrder.mockResolvedValue(paidTransfer);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    expect(screen.getByText('Nhận lại 114.000đ về')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Tài khoản ngân hàng/ }));
    await waitFor(() => expect(screen.getByLabelText('Số tài khoản')).toHaveValue('0071000123456'));
    fireEvent.click(screen.getByRole('button', { name: /Đổi ý/ }));
    const buttons = screen.getAllByRole('button', { name: 'Huỷ đơn' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() =>
      expect(mocks.cancelOrder).toHaveBeenCalledWith('TT001', {
        refundMethod: 'BANK',
        bankName: 'VCB',
        accountNumber: '0071000123456',
        accountName: 'TRAN THI B',
      }, { cancelReasonCode: 'CHANGED_MIND' }),
    );
  });

  it('đơn chuyển khoản đã trả: giữ mặc định Ví Tubu → gửi refundMethod WALLET', async () => {
    mocks.fetchOrder.mockResolvedValue(paidTransfer);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    fireEvent.click(screen.getByRole('button', { name: /Đổi ý/ }));
    const buttons = screen.getAllByRole('button', { name: 'Huỷ đơn' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(mocks.cancelOrder).toHaveBeenCalledWith('TT001', { refundMethod: 'WALLET' }, { cancelReasonCode: 'CHANGED_MIND' }));
  });

  it('chưa chọn lý do: báo chọn lý do và không gọi API; "Lý do khác" có ô viết thêm và gửi kèm', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'CONFIRMED' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    expect(screen.queryByLabelText('Mô tả lý do huỷ')).toBeNull();
    const buttons = screen.getAllByRole('button', { name: 'Huỷ đơn' });
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(await screen.findByText('Bạn chọn lý do huỷ giúp Tubu nhé')).toBeInTheDocument();
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Lý do khác/ }));
    fireEvent.change(screen.getByLabelText('Mô tả lý do huỷ'), { target: { value: ' Con ốm ' } });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() =>
      expect(mocks.cancelOrder).toHaveBeenCalledWith('TT001', { refundMethod: 'WALLET' }, { cancelReasonCode: 'OTHER', cancelReasonText: 'Con ốm' }),
    );
  });

  it('R3-MONEY-1: đơn đang xử lý đã nhận tiền mà khách trả dư → khối Hoàn tiền hiện khoản trả dư', async () => {
    mocks.fetchOrder.mockResolvedValue(paidTransfer);
    mocks.fetchMyRefunds.mockResolvedValue([
      {
        id: 'r9', orderId: 'o1', orderCode: 'TT001', kind: 'OVERPAYMENT', amount: 114_000, method: 'MANUAL_TRANSFER', status: 'PENDING',
        bankName: null, bankAccountNo: null, bankAccountName: null, bankRef: null, completedAt: null,
        createdAt: '2026-10-14T00:00:00Z', canChooseDestination: true,
      },
    ]);
    renderPage();
    expect(await screen.findByText('Tiền bạn trả dư: chờ bạn chọn nơi nhận · 114.000đ')).toBeInTheDocument();
    expect(mocks.fetchMyRefunds).toHaveBeenCalledWith('o1');
  });

  it('đơn chuyển khoản chưa ghi nhận tiền: hiện hạn thanh toán và cảnh báo trước khi huỷ', async () => {
    fixNow();
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      paymentDeadline: '2026-11-05T07:00:00.000Z',
    });
    renderPage();
    expect(await screen.findByText(/Thanh toán trước 14:00 05\/11/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    expect(screen.getByRole('note')).toHaveTextContent('Nếu bạn vừa chuyển khoản');
    fireEvent.click(screen.getByRole('button', { name: /Đổi ý/ }));
    const buttons = screen.getAllByRole('button', { name: 'Huỷ đơn' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(mocks.cancelOrder).toHaveBeenCalledWith('TT001', undefined, { cancelReasonCode: 'CHANGED_MIND' }));
  });

  it.each([
    ['còn hạn', 3_600_000, true],
    ['quá hạn (cron sắp huỷ)', -60_000, false],
  ])('đơn chuyển khoản chờ tiền %s: nút "Thanh toán ngay" theo hạn', async (_label, offsetMs, shown) => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      paymentDeadline: new Date(Date.now() + offsetMs).toISOString(),
      manualHandling: false,
    });
    renderPage();
    const bar = await screen.findByTestId('sticky-bar');
    expect(within(bar).queryByRole('button', { name: 'Thanh toán ngay' }) !== null).toBe(shown);
  });

  it('đã duyệt trả một phần: hiện số tiền, dòng trả, trạng thái nhận hàng và cho trả thêm', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, deliveredAt: new Date().toISOString() });
    mocks.fetchMyReturns.mockResolvedValue([
      {
        id: 'r1',
        orderId: 'o1',
        status: 'APPROVED',
        refundMethod: 'WALLET',
        refundAmount: 50_000,
        shippingRefund: 0,
        receivedAt: null,
        items: [{ orderItemId: 'oi1', quantity: 1, refundAmount: 50_000 }],
      },
    ]);
    renderPage();
    expect(await screen.findByText('Đổi/trả đã duyệt — đã hoàn 50.000đ vào Ví Tubu')).toBeInTheDocument();
    expect(screen.getByText('Trả: Xà bông thảo mộc ×1')).toBeInTheDocument();
    expect(screen.getByText('Tubu sẽ liên hệ để nhận lại hàng.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }));
    expect(await screen.findByRole('button', { name: 'Trả thêm sản phẩm' })).toBeInTheDocument();
  });
});

describe('OrderDetailPage — đơn gian hàng tự giao và đơn cùng lần đặt (D4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7 });
  });

  it('đơn gian hàng tự giao: nói rõ ai giao và hotline gian hàng; đơn cùng lần đặt chạm được để mở', async () => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      code: 'TB2',
      status: 'CONFIRMED',
      fulfilment: { kind: 'MERCHANT', name: 'Mật ong Linh', phone: '0912000111' },
      siblings: [{ code: 'TB1', status: 'SHIPPING', total: 130_000, fulfillerName: 'Tubu Tree' }],
    });
    renderPage();
    expect(await screen.findByText('Giao bởi Mật ong Linh')).toBeInTheDocument();
    expect(screen.getByText(/Liên hệ gian hàng: 0912000111/)).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Đơn cùng lần đặt' });
    expect(region.textContent).toContain('Tubu Tree giao · Đang giao');
    expect(region.textContent).toContain('130.000đ');
    fireEvent.click(screen.getByRole('link', { name: 'Xem đơn TB1, Tubu Tree giao' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TB1');
  });

  it('đơn Tubu giao không tách: không có khối nơi giao', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, fulfilment: { kind: 'TUBU', name: 'Tubu Tree', phone: null }, siblings: [] });
    renderPage();
    await screen.findByText(/Xà bông thảo mộc/);
    expect(screen.queryByText(/Giao bởi/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Đơn cùng lần đặt' })).toBeNull();
  });
});

describe('OrderDetailPage — dòng yêu cầu thu rác (§12.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue(ORDER);
    mocks.fetchMyReturns.mockResolvedValue([]);
  });
  it('đơn không thu kèm → không gọi /waste/requests/by-order, không có dòng', async () => {
    renderPage();
    await screen.findByText('TT001');
    expect(mocks.getWasteRequestByOrder).not.toHaveBeenCalled();
    expect(screen.queryByText(/Yêu cầu thu rác/)).toBeNull();
  });
  it('đơn thu kèm → dòng "Yêu cầu thu rác TR-…" dẫn tới trang theo dõi', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, hasRecyclingPickup: true, recyclingNote: 'TR-PICK1: 12 thùng' });
    mocks.getWasteRequestByOrder.mockResolvedValue(makeRequestDetail({ id: 'req-p', code: 'TR-PICK1', method: 'PICKUP', orderCode: 'TT001', orderId: 'o1' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Yêu cầu thu rác TR-PICK1/ }));
    expect(mocks.getWasteRequestByOrder).toHaveBeenCalledWith('o1');
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/req-p');
  });
  it('404 (đơn cũ trước đổi rác) → không có dòng, không báo lỗi', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, hasRecyclingPickup: true });
    mocks.getWasteRequestByOrder.mockRejectedValue(new HttpError('nf', 'ERR_BAD_REQUEST', { status: 404 }));
    renderPage();
    await screen.findByText('TT001');
    await waitFor(() => expect(mocks.getWasteRequestByOrder).toHaveBeenCalled());
    expect(screen.queryByText(/Yêu cầu thu rác/)).toBeNull();
  });
  it('không còn khối thu gom cũ; mã vận đơn Gomdon vẫn hiện như mọi đơn', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, hasRecyclingPickup: true, gomdonStatus: '3', recyclingNote: 'x', shippingCode: 'BE123456', shippingPartner: 'BestExpress' });
    mocks.getWasteRequestByOrder.mockResolvedValue(makeRequestDetail());
    const { container } = renderPage();
    await screen.findByText('TT001');
    expect(container.querySelector('#order-recycling')).toBeNull();
    expect(container.textContent).not.toMatch(/tài trợ 100% phí thu gom|Vật dụng gửi|tái chế/);
    expect(within(screen.getByTestId('order-shipping')).getByText('BE123456')).toBeInTheDocument();
  });
});

describe('OrderDetailPage — không mở trang ngoài (Zalo 4.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.copyText.mockResolvedValue(true);
  });

  const shipped = (extra: Record<string, unknown> = {}) => ({
    ...ORDER,
    status: 'SHIPPING',
    shippingPartner: 'GHN',
    shippingCode: 'GHN001',
    trackingLink: 'https://ghn.vn/tra-cuu?code=GHN001',
    shippingHistory: [{ at: '2026-10-02T03:00:00.000Z', status: 'delivering', carrier: 'GHN', code: 'GHN001' }],
    ...extra,
  });

  it('vận đơn: thẻ Vận chuyển gộp có hành trình, viên mã kèm hãng (nút "Chép mã" DUY NHẤT của trang) và địa chỉ; không có nút/link tra cứu trang hãng', async () => {
    mocks.fetchOrder.mockResolvedValue(shipped());
    renderPage();
    const shipping = await screen.findByTestId('order-shipping');
    const pill = within(shipping).getByTestId('order-tracking-pill');
    expect(pill).toHaveTextContent('GHN001 · GHN');
    expect(screen.getAllByText('Đang giao hàng').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: 'Tra cứu hành trình' })).toBeNull();
    expect(screen.queryAllByRole('link').filter((l) => !/^Xem sản phẩm/.test(l.getAttribute('aria-label') ?? ''))).toHaveLength(0);
    // W47: thẻ Vận chuyển đứng ngay sau thẻ trạng thái, chứa cả địa chỉ nhận.
    expect(screen.getByTestId('status-hero').nextElementSibling?.contains(shipping)).toBe(true);
    expect(within(shipping).getByTestId('order-shipping-address')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Sao chép mã vận đơn/ })).toHaveLength(1);
    fireEvent.click(within(pill).getByRole('button', { name: 'Sao chép mã vận đơn GHN001 (GHN)' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('GHN001'));
    await waitFor(() => expect(screen.getByTestId('order-tracking-pill')).toHaveTextContent('Đã sao chép mã vận đơn'));
  });

  it.each(['CANCELLED', 'RETURNED'])('đơn %s có mã vận đơn: viên chép mã vẫn ở thẻ Vận chuyển (đối chiếu, khiếu nại), là nút "Chép mã" duy nhất của trang', async (status) => {
    mocks.fetchOrder.mockResolvedValue(shipped({ status }));
    renderPage();
    const shipping = await screen.findByTestId('order-shipping');
    const pill = within(shipping).getByTestId('order-tracking-pill');
    expect(pill).toHaveTextContent('GHN001 · GHN');
    expect(screen.getAllByRole('button', { name: /^Sao chép mã vận đơn/ })).toHaveLength(1);
    const copy = within(pill).getByRole('button', { name: 'Sao chép mã vận đơn GHN001 (GHN)' });
    expect(copy).toHaveTextContent('Chép mã');
    fireEvent.click(copy);
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('GHN001'));
  });

  it('hoá đơn điện tử: chỉ chép đường dẫn, không mở ngoài', async () => {
    mocks.fetchOrder.mockResolvedValue(shipped({ invoiceStatus: 'ISSUED', invoiceUrl: 'https://hoadon.test/abc.pdf' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chép đường dẫn' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('https://hoadon.test/abc.pdf'));
    expect(screen.queryByRole('button', { name: 'Tải PDF' })).toBeNull();
  });
});

describe('OrderDetailPage: huỷ đơn và chép hoá đơn khoá chạm đúp, báo bận (W69A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.fetchMyRefunds.mockResolvedValue([]);
    mocks.fetchRefundBank.mockResolvedValue(null);
    mocks.copyText.mockResolvedValue(true);
  });

  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const openCancelSheet = async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'CONFIRMED' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    fireEvent.click(screen.getByRole('button', { name: /Đổi ý/ }));
  };
  const confirmButton = () => {
    const buttons = screen.getAllByRole('button', { name: 'Huỷ đơn' });
    return buttons[buttons.length - 1]!;
  };

  it('chạm đúp nút xác nhận "Huỷ đơn" trong cùng một khung hình chỉ gọi huỷ một lần', async () => {
    const d = deferred();
    mocks.cancelOrder.mockReturnValueOnce(d.promise);
    await openCancelSheet();
    await act(async () => {
      fireEvent.click(confirmButton());
      fireEvent.click(confirmButton());
    });
    expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ ...ORDER, status: 'CANCELLED' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã huỷ đơn cho bạn', type: 'success' }));
    expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
  });

  it('đang huỷ: nút xác nhận báo aria-busy và aria-disabled', async () => {
    const d = deferred();
    mocks.cancelOrder.mockReturnValueOnce(d.promise);
    await openCancelSheet();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmButton()).toHaveAttribute('aria-busy', 'true'));
    expect(confirmButton()).toHaveAttribute('aria-disabled', 'true');
    await act(async () => d.resolve({ ...ORDER, status: 'CANCELLED' }));
  });

  it('huỷ lỗi: báo lỗi và đóng tấm, khoá nhả nên mở lại huỷ được lần nữa', async () => {
    mocks.cancelOrder.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ ...ORDER, status: 'CANCELLED' });
    await openCancelSheet();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(mocks.cancelOrder).toHaveBeenCalledTimes(2));
  });

  describe('máy chủ từ chối huỷ thì tải lại ngay và giữ khoá tới khi đơn mới về (W104A)', () => {
    const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);
    const SHIPPED = 'Đơn đã bàn giao cho đơn vị vận chuyển nên không huỷ được.';

    it.each([400, 404, 409])('bị từ chối %i: tải lại đơn, danh sách đơn và khoản hoàn', async (status) => {
      const inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
      try {
        mocks.cancelOrder.mockRejectedValueOnce(serverError(SHIPPED, status));
        await openCancelSheet();
        fireEvent.click(confirmButton());
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: SHIPPED, type: 'error' }));
        const keys = () => inv.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
        await waitFor(() => expect(keys()).toEqual(expect.arrayContaining(['["order","TT001"]', '["orders"]', '["my-refunds"]'])));
      } finally {
        inv.mockRestore();
      }
    });

    it('nút Huỷ đơn ở thanh thao tác khoá tới khi đơn tải lại xong, rồi biến mất vì đơn đã giao đi', async () => {
      mocks.cancelOrder.mockRejectedValueOnce(serverError(SHIPPED, 400));
      await openCancelSheet();
      const refetch = deferred();
      mocks.fetchOrder.mockReturnValue(refetch.promise);
      fireEvent.click(confirmButton());
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
      // Đơn chưa về: tấm xác nhận còn mở (nút xác nhận bận) nên có hai nút "Huỷ đơn", nút ở thanh thao tác bị khoá.
      await waitFor(() => expect(screen.getAllByRole('button', { name: 'Huỷ đơn' })).toHaveLength(2));
      expect(screen.getAllByRole('button', { name: 'Huỷ đơn' })[0]).toBeDisabled();
      await act(async () => refetch.resolve({ ...ORDER, status: 'SHIPPING' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull());
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ])('%s: vẫn tải lại đơn như trước nhưng không tải danh sách đơn và hoàn tiền, khoá nhả ngay', async (_label, error) => {
      const inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
      try {
        mocks.cancelOrder.mockRejectedValueOnce(error);
        await openCancelSheet();
        fireEvent.click(confirmButton());
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
        const keys = inv.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
        expect(keys).toContain('["order","TT001"]');
        expect(keys).not.toContain('["orders"]');
        expect(keys).not.toContain('["my-refunds"]');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Huỷ đơn' })).toBeEnabled());
      } finally {
        inv.mockRestore();
      }
    });

    describe('tấm xác nhận huỷ đóng SAU khi đơn mới về (W115A)', () => {
      // Tấm đang mở = có hai nút "Huỷ đơn" (nút xác nhận trong tấm và nút ở thanh thao tác).
      const sheetOpen = () => screen.queryAllByRole('button', { name: 'Huỷ đơn' }).length > 1;
      const settle = () =>
        act(async () => {
          await new Promise((r) => setTimeout(r, 30));
        });
      // Đơn chuyển khoản chờ tiền chỉ có một nút "Huỷ đơn" (trong menu Thêm), nên dò tấm qua cảnh báo role=note chỉ có trong tấm.
      const bankSheetOpen = () => screen.queryByRole('note') !== null;

      it.each([400, 404, 409])('bị từ chối %i: lỗi hiện trước, tấm còn mở và nút xác nhận bận lúc đơn chưa về, đơn về thì tấm đóng đúng một lần rồi khoá nhả', async (status) => {
        mocks.cancelOrder.mockRejectedValueOnce(serverError(SHIPPED, status)).mockResolvedValue({ ...ORDER, status: 'CANCELLED' });
        await openCancelSheet();
        const refetch = deferred();
        mocks.fetchOrder.mockReturnValue(refetch.promise);
        fireEvent.click(confirmButton());
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: SHIPPED, type: 'error' }));
        await settle();
        expect(sheetOpen()).toBe(true);
        expect(confirmButton()).toHaveAttribute('aria-busy', 'true');
        await act(async () => {
          fireEvent.click(confirmButton());
          fireEvent.click(confirmButton());
        });
        expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
        await act(async () => refetch.resolve({ ...ORDER, status: 'CONFIRMED' }));
        await waitFor(() => expect(sheetOpen()).toBe(false));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Huỷ đơn' })).toBeEnabled());
        expect(mocks.openSnackbar.mock.calls.filter(([o]) => (o as { type: string }).type === 'error')).toHaveLength(1);
      });

      it('đơn chuyển khoản chờ tiền (Huỷ đơn nằm trong menu Thêm): giữ đơn trong lúc chờ rồi chọn lại Huỷ đơn ở menu không mở lại tấm; hết giữ khoá thì mở được', async () => {
        mocks.cancelOrder.mockRejectedValueOnce(serverError(SHIPPED, 409));
        mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
        renderPage();
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm thao tác' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
        fireEvent.click(screen.getByRole('button', { name: /Đổi ý/ }));
        const refetch = deferred();
        mocks.fetchOrder.mockReturnValue(refetch.promise);
        fireEvent.click(confirmButton());
        await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: SHIPPED, type: 'error' }));
        await settle();
        expect(bankSheetOpen()).toBe(true);
        // Khách tự đóng tấm bằng "Giữ đơn" lúc đơn mới chưa về, rồi thử mở lại từ menu Thêm.
        fireEvent.click(screen.getByRole('button', { name: 'Giữ đơn' }));
        await waitFor(() => expect(bankSheetOpen()).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
        await settle();
        expect(bankSheetOpen()).toBe(false);
        // Đơn mới về, khoá nhả: mục Huỷ đơn trong menu mở lại tấm như thường.
        await act(async () => refetch.resolve({ ...ORDER, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
        await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('Nếu bạn vừa chuyển khoản'));
        expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
      });

      it('đơn tải lại treo mãi: tấm còn mở ở LOCK_REFRESH_WAIT_MS - 500, đã đóng ở LOCK_REFRESH_WAIT_MS + 100', async () => {
        mocks.cancelOrder.mockRejectedValueOnce(serverError(SHIPPED, 409));
        await openCancelSheet();
        mocks.fetchOrder.mockReturnValue(new Promise(() => undefined));
        // Một test cũ trong file dựng đồng hồ giả (chỉ Date) mà không trả lại: `useFakeTimers` không làm gì khi đồng hồ giả đã có nên phải trả về thật trước.
        vi.useRealTimers();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
        try {
          fireEvent.click(confirmButton());
          await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: SHIPPED, type: 'error' }));
          await act(async () => {
            await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
          });
          expect(sheetOpen()).toBe(true);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
          });
          // Tấm của zmp-ui chỉ gỡ khỏi DOM sau hoạt ảnh đóng (hẹn giờ giả đang chạy): chờ thêm cho hoạt ảnh.
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
          });
          await waitFor(() => expect(sheetOpen()).toBe(false));
        } finally {
          vi.useRealTimers();
        }
      });

      it('máy chủ lỗi 503: không có gì để chờ nên tấm đóng ngay, không tải danh sách đơn, nhả khoá ngay (không đổi so với trước)', async () => {
        const inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
        try {
          mocks.cancelOrder.mockRejectedValueOnce(serverError('Service Unavailable', 503));
          await openCancelSheet();
          mocks.fetchOrder.mockReturnValue(new Promise(() => undefined));
          fireEvent.click(confirmButton());
          await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
          await waitFor(() => expect(sheetOpen()).toBe(false));
          await waitFor(() => expect(screen.getByRole('button', { name: 'Huỷ đơn' })).toBeEnabled());
          const keys = inv.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
          expect(keys).not.toContain('["orders"]');
        } finally {
          inv.mockRestore();
        }
      });
    });
  });

  it('chạm đúp "Chép đường dẫn" hoá đơn chỉ chép một lần và báo một lần', async () => {
    const d = deferred();
    mocks.copyText.mockReturnValueOnce(d.promise);
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING', invoiceStatus: 'ISSUED', invoiceUrl: 'https://hoadon.test/abc.pdf' });
    renderPage();
    const button = await screen.findByRole('button', { name: 'Chép đường dẫn' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(true));
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
  });
});

describe('OrderDetailPage — ngày giao dự kiến, ảnh món, ghi chú (R-9, R-107, R-108)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T03:00:00Z'));
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.getPublicConfig.mockResolvedValue({ shippingEta: { minDays: 2, maxDays: 4 }, waste: {} });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const processing = (extra: Record<string, unknown> = {}) => ({
    ...ORDER,
    status: 'SHIPPING',
    createdAt: '2026-10-28T01:39:00.000Z',
    statusTimes: { CONFIRMED: '2026-10-28T02:00:00.000Z' },
    ...extra,
  });

  it('đơn đang xử lý và đã cấu hình: dải đầu và mốc giao thành công ghi "Dự kiến giao 30/10 – 01/11"', async () => {
    mocks.fetchOrder.mockResolvedValue(processing());
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Dự kiến giao 30/10 – 01/11')).toHaveLength(2));
  });

  it('chưa cấu hình ngày giao: ẩn dòng, không bịa ngày', async () => {
    mocks.getPublicConfig.mockResolvedValue({ shippingEta: null, waste: {} });
    mocks.fetchOrder.mockResolvedValue(processing());
    renderPage();
    await screen.findByText('TT001');
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    expect(screen.queryByText(/Dự kiến giao/)).toBeNull();
  });

  it('đơn đã giao: không hiện dự kiến giao', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'DELIVERED' });
    renderPage();
    await screen.findByText('TT001');
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    expect(screen.queryByText(/Dự kiến giao/)).toBeNull();
  });

  it('chạm vào dòng món mở trang sản phẩm', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, items: [{ ...ORDER.items[0], thumbnail: 'https://img.test/a.jpg' }] });
    renderPage();
    fireEvent.click(await screen.findByRole('link', { name: 'Xem sản phẩm Xà bông thảo mộc' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/xa-bong');
  });

  it('ghi chú của khách hiện thành khối riêng; không có ghi chú thì không có khối', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, note: 'Gọi trước khi giao' });
    const first = renderPage();
    expect(await screen.findByText('Gọi trước khi giao')).toBeInTheDocument();
    first.unmount();
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, note: null });
    renderPage();
    await screen.findByText('TT001');
    expect(screen.queryByText('Ghi chú')).toBeNull();
  });
});

describe('OrderDetailPage: tài khoản hoàn tiền mặc định của tấm huỷ nạp mỗi lần mở một lần, không ghi đè chữ đã gõ (W118A)', () => {
  const SAVED = { bankName: 'VCB', accountNumber: '0071000123456', accountName: 'TRAN THI B' };
  const LABELS = ['Tên ngân hàng', 'Số tài khoản', 'Chủ tài khoản'] as const;
  const paidTransfer = { ...ORDER, status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', total: 114_000 };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue(paidTransfer);
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.fetchMyRefunds.mockResolvedValue([]);
    mocks.fetchRefundBank.mockReset().mockResolvedValue(null);
  });

  const deferred = () => {
    let resolve!: (v: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const openBankPicker = async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    fireEvent.click(screen.getByRole('radio', { name: /Tài khoản ngân hàng/ }));
  };
  const typeField = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const fieldValue = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

  it('khách gõ chủ tài khoản và số rồi xoá số: không nạp lần hai, tên chủ còn nguyên', async () => {
    mocks.fetchRefundBank.mockResolvedValueOnce(null).mockResolvedValue(SAVED);
    await openBankPicker();
    await waitFor(() => expect(mocks.fetchRefundBank).toHaveBeenCalledTimes(1));
    await settle();
    typeField('Chủ tài khoản', 'TRAN BINH');
    typeField('Số tài khoản', '555666777');
    typeField('Số tài khoản', '');
    await settle();
    expect(mocks.fetchRefundBank).toHaveBeenCalledTimes(1);
    expect(fieldValue('Chủ tài khoản')).toBe('TRAN BINH');
    expect(fieldValue('Tên ngân hàng')).toBe('');
    expect(fieldValue('Số tài khoản')).toBe('');
  });

  it.each(LABELS)('phản hồi nạp tài khoản về trễ sau khi khách đã gõ ô "%s": không ghi đè', async (label) => {
    const d = deferred();
    mocks.fetchRefundBank.mockReturnValue(d.promise);
    await openBankPicker();
    typeField(label, 'GO TAY');
    await act(async () => d.resolve(SAVED));
    await settle();
    expect(fieldValue(label)).toBe('GO TAY');
    for (const other of LABELS.filter((l) => l !== label)) expect(fieldValue(other)).toBe('');
  });

  it('đóng tấm rồi mở lại: nạp lại một lần mới, điền sẵn khi ba ô còn trống', async () => {
    mocks.fetchRefundBank.mockResolvedValueOnce(null).mockResolvedValue(SAVED);
    await openBankPicker();
    await waitFor(() => expect(mocks.fetchRefundBank).toHaveBeenCalledTimes(1));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Giữ đơn' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    await waitFor(() => expect(mocks.fetchRefundBank).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fieldValue('Số tài khoản')).toBe('0071000123456'));
    expect(fieldValue('Tên ngân hàng')).toBe('VCB');
    expect(fieldValue('Chủ tài khoản')).toBe('TRAN THI B');
  });

  it('đóng tấm rồi mở lại khi đã gõ dở một ô: lần nạp mới không ghi đè chữ đã gõ', async () => {
    mocks.fetchRefundBank.mockResolvedValueOnce(null).mockResolvedValue(SAVED);
    await openBankPicker();
    await waitFor(() => expect(mocks.fetchRefundBank).toHaveBeenCalledTimes(1));
    await settle();
    typeField('Chủ tài khoản', 'TRAN BINH');
    fireEvent.click(screen.getByRole('button', { name: 'Giữ đơn' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    await waitFor(() => expect(mocks.fetchRefundBank).toHaveBeenCalledTimes(2));
    await settle();
    expect(fieldValue('Chủ tài khoản')).toBe('TRAN BINH');
    expect(fieldValue('Tên ngân hàng')).toBe('');
    expect(fieldValue('Số tài khoản')).toBe('');
  });
});

describe('OrderDetailPage — Mua lại một chạm (đơn đã giao)', () => {
  const TWO = {
    ...ORDER,
    items: [
      ...ORDER.items,
      { id: 'oi2', productName: 'Nước rửa chén', variationName: '1L', productSlug: 'nuoc-rua-chen', quantity: 1, total: 60_000, backorderedQty: 0 },
    ],
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue(TWO);
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it('chạm một lần: thêm món còn hàng, mở giỏ, nêu tên món hết; bấm đúp không gửi hai lần', async () => {
    const { repurchaseOrder } = await import('../services/shop-api');
    let release!: (v: Awaited<ReturnType<typeof repurchaseOrder>>) => void;
    vi.mocked(repurchaseOrder).mockReturnValue(new Promise((r) => (release = r)));
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Mua lại đơn này' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      release({
        cart: { items: [] } as never,
        legacy: false,
        results: [
          { orderItemId: 'oi1', status: 'added', addedQuantity: 2 },
          { orderItemId: 'oi2', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 },
        ],
      });
    });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
    expect(repurchaseOrder).toHaveBeenCalledTimes(1);
    expect(repurchaseOrder).toHaveBeenCalledWith('TT001', {
      items: [
        { orderItemId: 'oi1', quantity: 2 },
        { orderItemId: 'oi2', quantity: 1 },
      ],
      addSource: 'repurchase',
    });
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Nước rửa chén (hết hàng)') }));
  });
});

describe('OrderDetailPage — viên vận đơn và thẻ Refill như web (tubu-w18-02)', () => {
  const landing = {
    enabled: true,
    pairs: [
      {
        bottle: { productId: 'b1', slug: 'xa-bong', name: 'Xà bông thảo mộc 500ml', thumbnail: null, price: 68_000, compareAt: null, sizeLabel: '500ml', inStock: true },
        refill: { productId: 'r1', slug: 'xa-bong-refill', name: 'Túi Refill xà bông 2L', thumbnail: null, variationId: 'v-r1', price: 200_000, compareAt: null, sizeLabel: '2L', inStock: true, tubu: true },
        savingPct: 26,
      },
    ],
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.coreGet.mockImplementation(async (path: string) => {
      if (path === '/catalog/refill-pairs/landing') return landing;
      throw new Error(`đường dẫn lạ ${path}`);
    });
  });

  it('đơn đã giao, cờ Refill bật: thẻ "Lần sau rót lại bằng Refill" là phần phụ, nằm DƯỚI thẻ Vận chuyển, Sản phẩm và Thanh toán (W47); đơn không có mã vận đơn thì không có viên', async () => {
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7, refillFirstEnabled: true });
    mocks.fetchOrder.mockResolvedValue(ORDER);
    renderPage();
    const card = await screen.findByTestId('order-refill');
    expect(card).toHaveTextContent('Lần sau rót lại bằng Refill');
    expect(card).toHaveTextContent('Chọn túi Refill 2L tiết kiệm');
    fireEvent.click(within(card).getByTestId('pdp-refill-open'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/xa-bong-refill');
    const following = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(following(screen.getByTestId('status-hero'), screen.getByTestId('order-shipping'))).toBe(true);
    expect(following(screen.getByTestId('order-shipping'), screen.getByText('Sản phẩm'))).toBe(true);
    expect(following(screen.getByText('Sản phẩm'), card)).toBe(true);
    expect(following(screen.getAllByText('Tổng cộng')[0]!, card)).toBe(true);
    expect(screen.queryByTestId('order-tracking-pill')).toBeNull();
  });

  it('cờ Refill tắt: không hỏi trang Refill, không có thẻ', async () => {
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7 });
    mocks.fetchOrder.mockResolvedValue(ORDER);
    renderPage();
    await screen.findByText('Sản phẩm');
    expect(screen.queryByTestId('order-refill')).toBeNull();
    expect(mocks.coreGet).not.toHaveBeenCalledWith('/catalog/refill-pairs/landing', expect.anything());
  });

  it('đơn đang giao: viên vận đơn trong thẻ Vận chuyển ngay sau thẻ trạng thái, chưa có thẻ Refill (khách chưa có chai)', async () => {
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7, refillFirstEnabled: true });
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING', shippingPartner: 'GHN', shippingCode: 'GHN001' });
    renderPage();
    const pill = await screen.findByTestId('order-tracking-pill');
    expect(screen.getByTestId('status-hero').nextElementSibling?.contains(pill)).toBe(true);
    expect(within(pill).getByRole('button', { name: 'Sao chép mã vận đơn GHN001 (GHN)' })).toHaveTextContent('GHN001 · GHN');
    expect(screen.queryByTestId('order-refill')).toBeNull();
    expect(mocks.coreGet).not.toHaveBeenCalledWith('/catalog/refill-pairs/landing', expect.anything());
  });
});

describe('OrderDetailPage — 👎 ở thẻ "Đơn này thế nào?" khi chat chưa mở (tubu-w33-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, csatAsk: true });
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it('khối liên hệ có kênh: đưa focus tới khối đó, lời xin lỗi chỉ chỗ nhắn', async () => {
    mocks.supportContact.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    renderPage();
    const down = await screen.findByRole('button', { name: ORDER_CSAT_COPY.down });
    await waitFor(() => expect(document.getElementById('order-support')?.firstElementChild).not.toBeNull());
    await act(async () => fireEvent.click(down));
    expect(within(screen.getByTestId('order-csat')).getByRole('status').textContent).toBe(ORDER_CSAT_COPY.thanksDown);
    expect(document.activeElement?.id).toBe('order-support');
  });

  it('khối liên hệ còn rỗng (số liên hệ đang tải): không nhắc "mục Liên hệ", focus ở dòng xin lỗi', async () => {
    mocks.supportContact.mockReturnValue(new Promise(() => undefined));
    renderPage();
    const down = await screen.findByRole('button', { name: ORDER_CSAT_COPY.down });
    expect(document.getElementById('order-support')?.firstElementChild).toBeNull();
    await act(async () => fireEvent.click(down));
    const status = within(screen.getByTestId('order-csat')).getByRole('status');
    expect(status.textContent).toBe(ORDER_CSAT_COPY.thanksDownNoContact);
    expect(document.activeElement).toBe(status);
  });
});
