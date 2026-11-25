import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrderDTO } from '@tubutree/shared-types';
import type * as ZmpUi from 'zmp-ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), fetchProduct: vi.fn(), getPublicConfig: vi.fn(), copyText: vi.fn(),
}));
vi.mock('../../utils/features', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), SUBSCRIPTIONS_IN_MINIAPP: true }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({ fetchProduct: mocks.fetchProduct, getPublicConfig: mocks.getPublicConfig }));
vi.mock('../../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../../store/storefront-context', () => ({
  useStorefrontContext: (sel: (s: { slug: null; kind: null }) => unknown) => sel({ slug: null, kind: null }),
}));
vi.mock('../subscribe-sheet', () => ({
  SubscribeSheet: ({ visible, variationId }: { visible: boolean; variationId: string }) => (visible ? <div>subscribe-open:{variationId}</div> : null),
}));

import { OrderSuccess } from './order-success';
import { ORDER_ZALO_KEY } from './order-zalo';

const ORDER = {
  id: 'o1', code: 'TUBU-COD-12345', status: 'CONFIRMED', total: 149000, pointsEarned: 14, paymentMethod: 'COD', fulfiller: 'TUBU',
  items: [{ id: 'i1', variationId: 'var-1', productName: 'Nước rửa chén', productSlug: 'nrc', variationName: 'Chanh', unitPrice: 65000, quantity: 2, total: 130000, backorderedQty: 0 }],
} as unknown as OrderDTO;
const CONFIG = { freeshipThreshold: 200000, subscribeDiscountPct: 0.12, affiliateWalletMultiplier: 1.5, cashbackHoldDays: 30 };
const PRODUCT = (stock: number) => ({ slug: 'nrc', variations: [{ id: 'var-1', stock }] });

function renderSuccess(props: Partial<Parameters<typeof OrderSuccess>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <OrderSuccess order={props.order ?? ORDER} onTrack={props.onTrack ?? vi.fn()} onContinue={props.onContinue ?? vi.fn()} />
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

describe('OrderSuccess (DS v2, spec 4a.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, shippingEta: { minDays: 2, maxDays: 4 } });
    mocks.fetchProduct.mockResolvedValue(PRODUCT(10));
  });

  it('tiêu đề không emoji, mã đơn, tổng tiền, nhắc tiền mặt COD, điểm sẽ nhận, 3 bước tiếp theo', () => {
    const { container } = renderSuccess();
    expect(screen.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' })).toBeInTheDocument();
    expect(screen.getByText('TUBU-COD-12345')).toBeInTheDocument();
    expect(screen.getByText('149.000đ')).toBeInTheDocument();
    expect(screen.getByText('Chuẩn bị tiền mặt khi nhận hàng')).toBeInTheDocument();
    expect(screen.getByText('+14 điểm, về khi đơn giao xong')).toBeInTheDocument();
    for (const s of ['Xác nhận đơn', 'Đóng gói', 'Giao hàng']) expect(screen.getByText(s)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(container.querySelector('.tubu-leaf')).toBeNull();
  });

  it('sao chép mã đơn', async () => {
    mocks.copyText.mockResolvedValue(true);
    renderSuccess();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã đơn TUBU-COD-12345' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã sao chép mã đơn' })));
    expect(mocks.copyText).toHaveBeenCalledWith('TUBU-COD-12345');
  });

  it('nút sao chép đọc rõ mã nào sẽ chép: nhãn kèm mã đơn, đơn tách thì kèm đủ danh sách (W52A)', () => {
    const { unmount } = renderSuccess();
    expect(screen.getByRole('button', { name: 'Sao chép mã đơn TUBU-COD-12345' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sao chép mã đơn' })).toBeNull();
    unmount();
    const order = {
      ...ORDER,
      code: 'TB1',
      splitOrders: [
        { id: 'o1', code: 'TB1', total: 130000, status: 'CONFIRMED', fulfiller: 'TUBU', fulfillerName: 'Tubu Tree' },
        { id: 'o2', code: 'TB2', total: 225000, status: 'CONFIRMED', fulfiller: 'MERCHANT', fulfillerName: 'Mật ong Linh' },
      ],
    } as unknown as OrderDTO;
    renderSuccess({ order });
    expect(screen.getByRole('button', { name: 'Sao chép mã đơn TB1, TB2' })).toBeInTheDocument();
  });

  it('số đều (tabular-nums) cho tổng thanh toán, điểm sẽ nhận và tiền từng đơn tách (W52A)', () => {
    const order = {
      ...ORDER,
      code: 'TB1',
      pointsEarned: 11,
      splitOrders: [
        { id: 'o1', code: 'TB1', total: 130000, pointsEarned: 11, status: 'CONFIRMED', fulfiller: 'TUBU', fulfillerName: 'Tubu Tree' },
        { id: 'o2', code: 'TB2', total: 225000, pointsEarned: 15, status: 'CONFIRMED', fulfiller: 'MERCHANT', fulfillerName: 'Mật ong Linh' },
      ],
    } as unknown as OrderDTO;
    renderSuccess({ order });
    for (const text of ['355.000đ', '+26 điểm, về khi đơn giao xong', '130.000đ', '225.000đ']) {
      expect(screen.getByText(text).style.fontVariantNumeric, text).toBe('tabular-nums');
    }
  });

  it('ngày giao dự kiến hiện đúng khoảng ngày khi đã cấu hình', async () => {
    renderSuccess();
    expect(await screen.findByText('Giao dự kiến')).toBeInTheDocument();
    expect(screen.getByText(/^\d{2}\/\d{2} – \d{2}\/\d{2}$/)).toBeInTheDocument();
  });

  describe('ngày giao dự kiến theo nơi giao (chỉ hứa cho hàng Tubu giao)', () => {
    const split = (...kinds: string[]) => ({
      ...ORDER,
      splitOrders: kinds.map((fulfiller, i) => ({ id: `s${i}`, code: `TUBU-S${i}`, total: 50000, status: 'CONFIRMED', fulfiller, fulfillerName: fulfiller })),
    }) as unknown as typeof ORDER;

    it('đơn của gian hàng tự giao → không có dòng giao dự kiến (sau khi config đã tải xong)', async () => {
      const { qc } = renderSuccess({ order: { ...ORDER, fulfiller: 'MERCHANT' } as unknown as typeof ORDER });
      await waitFor(() => expect(qc.getQueryState(['public-config'])?.status).toBe('success'));
      expect(screen.queryByText('Giao dự kiến')).toBeNull();
    });

    it('tách nhiều đơn toàn gian hàng tự giao → cũng không hứa ngày', async () => {
      const { qc } = renderSuccess({ order: split('MERCHANT', 'MERCHANT') });
      await waitFor(() => expect(qc.getQueryState(['public-config'])?.status).toBe('success'));
      expect(screen.queryByText('Giao dự kiến')).toBeNull();
    });

    it('tách đơn trộn Tubu + gian hàng tự giao → ngày kèm "(hàng Tubu Tree)"', async () => {
      renderSuccess({ order: split('TUBU', 'MERCHANT') });
      expect(await screen.findByText('Giao dự kiến')).toBeInTheDocument();
      expect(screen.getByText(/^\d{2}\/\d{2} – \d{2}\/\d{2} \(hàng Tubu Tree\)$/)).toBeInTheDocument();
    });
  });

  it('chưa cấu hình ETA (null) → không có dòng giao dự kiến (sau khi config đã tải xong)', async () => {
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, shippingEta: null });
    const { qc } = renderSuccess();
    // Phải chờ config THẬT SỰ về: trước đó "Giao dự kiến" vốn đã vắng mặt nên assertion sẽ đúng dù
    // guard `cfg.shippingEta` bị xoá. Sau khi settle, nếu guard sai thì ETA sẽ hiện (hoặc crash).
    await waitFor(() => expect(qc.getQueryState(['public-config'])?.status).toBe('success'));
    expect(screen.queryByText('Giao dự kiến')).toBeNull();
  });

  it('config tải xong mà máy chủ cũ không trả shippingEta (undefined) → cũng không có dòng giao dự kiến', async () => {
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG });
    const { qc } = renderSuccess();
    await waitFor(() => expect(qc.getQueryState(['public-config'])?.status).toBe('success'));
    expect(screen.queryByText('Giao dự kiến')).toBeNull();
  });

  it('sao chép thất bại → snackbar báo kèm mã đơn để khách tự chép', async () => {
    mocks.copyText.mockResolvedValue(false);
    renderSuccess();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã đơn TUBU-COD-12345' }));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Không sao chép được — mã đơn: TUBU-COD-12345', type: 'info' })),
    );
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã sao chép mã đơn' }));
  });

  it('gợi ý "Đặt định kỳ" khi variation còn hàng (cùng điều kiện PDP) → mở SubscribeSheet đúng variation', async () => {
    renderSuccess();
    fireEvent.click(await screen.findByRole('button', { name: /^Đặt định kỳ/ }));
    expect(screen.getByText('subscribe-open:var-1')).toBeInTheDocument();
    expect(mocks.fetchProduct).toHaveBeenCalledWith('nrc');
  });

  it('variation hết hàng → không gợi ý định kỳ', async () => {
    mocks.fetchProduct.mockResolvedValue(PRODUCT(0));
    const { qc } = renderSuccess();
    // Chờ query sản phẩm THẬT SỰ có dữ liệu (không chỉ "đã gọi") — nếu bỏ kiểm tra stock thì nút
    // sẽ xuất hiện ngay sau bước này và assertion bên dưới fail.
    await waitFor(() => expect(qc.getQueryState(['product', 'nrc'])?.status).toBe('success'));
    expect(screen.queryByRole('button', { name: /^Đặt định kỳ/ })).toBeNull();
  });

  it('tải sản phẩm lỗi (404/mạng) → ẩn gợi ý định kỳ, màn vẫn dùng được', async () => {
    mocks.fetchProduct.mockRejectedValue(new Error('404'));
    const { qc } = renderSuccess();
    await waitFor(() => expect(qc.getQueryState(['product', 'nrc'])?.status).toBe('error'));
    expect(screen.queryByRole('button', { name: /^Đặt định kỳ/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Theo dõi đơn' })).toBeInTheDocument();
  });

  it('đơn không có productSlug → không gọi fetchProduct và không gợi ý', async () => {
    const noSlug = { ...ORDER, items: [{ ...ORDER.items[0], productSlug: null }] } as unknown as OrderDTO;
    const { qc } = renderSuccess({ order: noSlug });
    await waitFor(() => expect(qc.getQueryState(['public-config'])?.status).toBe('success'));
    expect(mocks.fetchProduct).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Đặt định kỳ/ })).toBeNull();
  });

  it('chỉ kiểm tra tối đa 3 slug khác nhau đầu tiên của đơn', async () => {
    const item = (slug: string, i: number) => ({ ...ORDER.items[0], id: `i${i}`, productSlug: slug, variationId: `v-${slug}` });
    const many = { ...ORDER, items: ['a', 'a', 'b', 'c', 'd', 'e'].map(item) } as unknown as OrderDTO;
    mocks.fetchProduct.mockImplementation(async (slug: string) => ({ slug, variations: [{ id: `v-${slug}`, stock: 0 }] }));
    const { qc } = renderSuccess({ order: many });
    await waitFor(() => {
      for (const slug of ['a', 'b', 'c']) expect(qc.getQueryState(['product', slug])?.status).toBe('success');
    });
    expect(mocks.fetchProduct.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c']);
  });

  describe('hàng gian hàng đối tác không có đặt định kỳ (R5-CHECKOUT-8, D4)', () => {
    const HONEY = { id: 'i2', variationId: 'var-honey', productName: 'Mật ong ký gửi', productSlug: 'mat-ong-ky-gui', variationName: null, unitPrice: 180000, quantity: 1, total: 180000, backorderedQty: 0 };
    const byslug = (extra: Record<string, Record<string, unknown>>) => async (slug: string) =>
      slug === 'nrc' ? PRODUCT(10) : { slug, variations: [{ id: 'var-honey', stock: 10 }], ...extra[slug] };

    it.each([
      ['hàng ký gửi (Tubu giao hộ)', { partnerOwned: true }],
      ['gian hàng tự giao', { partnerOwned: true, fulfiller: { kind: 'MERCHANT', storefrontId: 'sf1', name: 'Mật ong Linh' } }],
      ['gian hàng tạm nghỉ', { fulfiller: { kind: 'UNAVAILABLE', storefrontId: 'sf1', name: 'Mật ong Linh' } }],
    ])('đơn chỉ có %s → không gợi ý định kỳ', async (_label, extra) => {
      mocks.fetchProduct.mockImplementation(byslug({ 'mat-ong-ky-gui': extra }));
      const order = { ...ORDER, items: [HONEY] } as unknown as OrderDTO;
      const { qc } = renderSuccess({ order });
      await waitFor(() => expect(qc.getQueryState(['product', 'mat-ong-ky-gui'])?.status).toBe('success'));
      expect(screen.queryByRole('button', { name: /^Đặt định kỳ/ })).toBeNull();
      expect(screen.queryByText(/Mật ong ký gửi/)).toBeNull();
    });

    it('đơn trộn hàng ký gửi (dòng đầu) với hàng Tubu → gợi ý đúng món Tubu, mở SubscribeSheet đúng variation Tubu', async () => {
      mocks.fetchProduct.mockImplementation(byslug({ 'mat-ong-ky-gui': { partnerOwned: true } }));
      const order = { ...ORDER, items: [HONEY, ORDER.items[0]] } as unknown as OrderDTO;
      renderSuccess({ order });
      fireEvent.click(await screen.findByRole('button', { name: /^Đặt định kỳ/ }));
      expect(screen.getByText('subscribe-open:var-1')).toBeInTheDocument();
      expect(screen.getByText(/Nước rửa chén/)).toBeInTheDocument();
      expect(screen.queryByText(/Mật ong ký gửi/)).toBeNull();
    });
  });

  it('gợi ý định kỳ nằm SAU hai CTA để không đẩy nút "Theo dõi đơn" khi sản phẩm tải xong', async () => {
    renderSuccess();
    const track = screen.getByRole('button', { name: 'Theo dõi đơn' });
    const keep = screen.getByRole('button', { name: 'Tiếp tục mua sắm' });
    const offer = await screen.findByRole('button', { name: /^Đặt định kỳ/ });
    for (const cta of [track, keep]) {
      expect(cta.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('CTA chính "Theo dõi đơn", phụ "Tiếp tục mua sắm"', () => {
    const onTrack = vi.fn();
    const onContinue = vi.fn();
    renderSuccess({ onTrack, onContinue });
    fireEvent.click(screen.getByRole('button', { name: 'Theo dõi đơn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục mua sắm' }));
    expect(onTrack).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('lần đặt bị tách theo nơi giao: tổng của mọi đơn, liệt kê từng đơn kèm nơi giao, chạm để xem chi tiết (D4)', () => {
    const order = {
      ...ORDER,
      code: 'TB1',
      total: 130000,
      splitOrders: [
        { id: 'o1', code: 'TB1', total: 130000, status: 'CONFIRMED', fulfiller: 'TUBU', fulfillerName: 'Tubu Tree' },
        { id: 'o2', code: 'TB2', total: 225000, status: 'CONFIRMED', fulfiller: 'MERCHANT', fulfillerName: 'Mật ong Linh' },
      ],
    } as unknown as OrderDTO;
    renderSuccess({ order });
    expect(screen.getByText('Tổng 2 đơn')).toBeInTheDocument();
    expect(screen.getByText('355.000đ')).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Đơn cùng lần đặt' });
    expect(list.textContent).toContain('Mật ong Linh giao');
    fireEvent.click(screen.getByRole('button', { name: /Xem đơn TB2, Mật ong Linh giao/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TB2', { replace: true });
  });

  it('lần đặt bị tách: Điểm Xanh sẽ nhận là tổng điểm mọi đơn, khớp số màn Thanh toán đã hứa (R2-BUYERMINI-2)', () => {
    const order = {
      ...ORDER,
      code: 'TB1',
      total: 134000,
      pointsEarned: 11,
      splitOrders: [
        { id: 'o1', code: 'TB1', total: 134000, pointsEarned: 11, status: 'CONFIRMED', fulfiller: 'TUBU', fulfillerName: 'Tubu Tree' },
        { id: 'o2', code: 'TB2', total: 172000, pointsEarned: 15, status: 'CONFIRMED', fulfiller: 'MERCHANT', fulfillerName: 'Cô Lan' },
      ],
    } as unknown as OrderDTO;
    renderSuccess({ order });
    expect(screen.getByText('+26 điểm, về khi đơn giao xong')).toBeInTheDocument();
  });

  it('lần đặt bị tách: khối Mã đơn hàng ở đầu liệt kê đủ mọi mã, nút sao chép chép cả danh sách, không chỉ mã đơn đầu (R5-BUYER-5)', async () => {
    mocks.copyText.mockResolvedValue(true);
    const order = {
      ...ORDER,
      code: 'TB1',
      total: 130000,
      splitOrders: [
        { id: 'o1', code: 'TB1', total: 130000, status: 'CONFIRMED', fulfiller: 'TUBU', fulfillerName: 'Tubu Tree' },
        { id: 'o2', code: 'TB2', total: 225000, status: 'CONFIRMED', fulfiller: 'MERCHANT', fulfillerName: 'Mật ong Linh' },
        { id: 'o3', code: 'TB3', total: 90000, status: 'CONFIRMED', fulfiller: 'MERCHANT', fulfillerName: 'Cô Lan' },
      ],
    } as unknown as OrderDTO;
    renderSuccess({ order });
    const block = screen.getByText('Mã đơn hàng').parentElement as HTMLElement;
    for (const code of ['TB1', 'TB2', 'TB3']) expect(block).toHaveTextContent(code);
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã đơn TB1, TB2, TB3' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('TB1, TB2, TB3'));
  });

  it('đơn không tách: không có danh sách đơn cùng lần đặt', () => {
    renderSuccess();
    expect(screen.queryByRole('region', { name: 'Đơn cùng lần đặt' })).toBeNull();
  });
});

describe('OrderSuccess: bố cục 375 giống MobileSuccess của web (tubu-w19-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, shippingEta: { minDays: 2, maxDays: 4 } });
    mocks.fetchProduct.mockResolvedValue(PRODUCT(10));
  });

  const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('thứ tự: tiêu đề, thẻ mã đơn + tiền, hai nút, đơn tách, Tiếp theo, rồi nhóm gợi ý phụ', async () => {
    const order = {
      ...ORDER,
      code: 'TB1',
      splitOrders: [
        { id: 'o1', code: 'TB1', total: 130000, status: 'CONFIRMED', fulfiller: 'TUBU', fulfillerName: 'Tubu Tree' },
        { id: 'o2', code: 'TB2', total: 225000, status: 'CONFIRMED', fulfiller: 'MERCHANT', fulfillerName: 'Mật ong Linh' },
      ],
    } as unknown as OrderDTO;
    renderSuccess({ order });
    const offer = await screen.findByRole('button', { name: /^Đặt định kỳ/ });
    const chain = [
      screen.getByRole('heading', { name: 'Cảm ơn bạn đã chọn Tubu' }),
      screen.getByText('Mã đơn hàng'),
      screen.getByText('Tổng 2 đơn'),
      screen.getByRole('button', { name: 'Theo dõi đơn' }),
      screen.getByRole('button', { name: 'Tiếp tục mua sắm' }),
      screen.getByRole('region', { name: 'Đơn cùng lần đặt' }),
      screen.getByRole('region', { name: 'Tiếp theo' }),
      screen.getByRole('region', { name: 'Thêm cho đơn này' }),
    ];
    for (let i = 1; i < chain.length; i += 1) expect(follows(chain[i - 1]!, chain[i]!), `khối ${i} phải nằm sau khối ${i - 1}`).toBe(true);
    expect(screen.getByRole('region', { name: 'Thêm cho đơn này' })).toContainElement(offer);
  });

  it('Tiếp theo: 3 bước trên một hàng, số thứ tự ẩn với trình đọc, câu giải thích từng bước vẫn đọc được', () => {
    renderSuccess();
    const steps = screen.getByRole('region', { name: 'Tiếp theo' });
    const list = steps.querySelector('ol')!;
    expect(list).toHaveClass('tubu-order-success-steps');
    const items = Array.from(list.querySelectorAll(':scope > li'));
    expect(items).toHaveLength(3);
    const bodies = ['Tubu kiểm tra và xác nhận đơn của bạn.', 'Sản phẩm được đóng gói cẩn thận.', 'Đơn vị vận chuyển giao tới địa chỉ của bạn.'];
    items.forEach((li, i) => {
      const num = li.querySelector('[aria-hidden]')!;
      expect(num.textContent).toBe(String(i + 1));
      expect(num.hasAttribute('data-current')).toBe(i === 0);
      const body = Array.from(li.querySelectorAll('span')).find((s) => s.textContent === `: ${bodies[i]}`)!;
      expect(body, `câu đọc ẩn của bước ${i + 1}`).toBeTruthy();
      expect(body.style.position).toBe('absolute');
      expect(body.style.width).toBe('1px');
    });
  });

  it('Đặt định kỳ là MỘT dòng mang lớp touch-target (không phải nút cỡ lớn thứ ba; cao 44px đo ở e2e buy-flow-4a), tên đọc gồm món và mức tiết kiệm', async () => {
    renderSuccess();
    const row = await screen.findByRole('button', { name: /^Đặt định kỳ Nước rửa chén/ });
    expect(row).toHaveClass('touch-target');
    expect(row).toHaveTextContent('Tự động giao lại theo chu kỳ, tiết kiệm 12% mỗi đơn.');
    expect(screen.getAllByRole('button', { name: /Đặt định kỳ/ })).toHaveLength(1);
  });

  it('không có gợi ý phụ nào (hết hàng, cờ Zalo và mời bạn tắt): nhóm phụ không có phần tử con và luật .tubu-order-success-extras:empty ẩn nó (không để lại khoảng 12px)', async () => {
    mocks.fetchProduct.mockResolvedValue(PRODUCT(0));
    const { qc, container } = renderSuccess();
    await waitFor(() => expect(qc.getQueryState(['product', 'nrc'])?.status).toBe('success'));
    const extras = container.querySelector('.tubu-order-success-extras')!;
    expect(extras.childNodes).toHaveLength(0);
    // jsdom không áp CSS nên đọc thẳng luật trong tệp: mất hay gõ sai lớp :empty thì nhóm rỗng vẫn chiếm một khoảng gap.
    const css = readFileSync(resolve(__dirname, '../../css/order-success.css'), 'utf8');
    expect(css).toMatch(/\.tubu-order-success-extras:empty\s*\{\s*display:\s*none;?\s*\}/);
  });

  it('sao chép mã: báo qua useNotify (snackbar + vùng đọc), không gọi thẳng openSnackbar riêng', async () => {
    mocks.copyText.mockResolvedValue(true);
    renderSuccess();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã đơn TUBU-COD-12345' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép mã đơn', type: 'success' }));
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
  });
});

describe('OrderSuccess — lời mời kết bạn Zalo (wave tubu-mss-consent-ui)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(PRODUCT(0));
  });

  it('cờ bật và đơn có đồng ý: câu mời kèm mã đơn, nút phụ nằm sau "Theo dõi đơn" (không tranh nút chính)', async () => {
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, orderZaloEnabled: true, tubuZaloPhone: '0899149229' });
    renderSuccess({ order: { ...ORDER, orderZaloConsent: true } as unknown as OrderDTO });
    const open = await screen.findByRole('button', { name: 'Mở Zalo Tubu Tree' });
    expect(screen.getByText('Nhận Bill & theo dõi đơn TUBU-COD-12345 miễn phí qua Zalo Tubu Tree')).toBeInTheDocument();
    const track = screen.getByRole('button', { name: 'Theo dõi đơn' });
    expect(track.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('cờ tắt, hoặc đơn không đồng ý: không có lời mời', async () => {
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, orderZaloEnabled: false });
    const a = renderSuccess({ order: { ...ORDER, orderZaloConsent: true } as unknown as OrderDTO });
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Mở Zalo Tubu Tree' })).toBeNull();
    a.unmount();
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, orderZaloEnabled: true });
    renderSuccess({ order: { ...ORDER, orderZaloConsent: false } as unknown as OrderDTO });
    await screen.findByText('TUBU-COD-12345');
    expect(screen.queryByRole('button', { name: 'Mở Zalo Tubu Tree' })).toBeNull();
  });

  it.each([
    [true, 0],
    [false, 1],
  ])('U2 ô Zalo ở thanh toán báo friendKnown=%s: số lời mời %i (đọc bản thanh toán, không hỏi máy chủ thêm)', async (friendKnown, invites) => {
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, orderZaloEnabled: true, tubuZaloPhone: '0899149229' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ORDER_ZALO_KEY, { enabled: true, prechecked: true, choice: true, phoneMasked: '090•••4567', tubuZaloPhone: '0899149229', friendKnown });
    render(
      <QueryClientProvider client={qc}>
        <OrderSuccess order={{ ...ORDER, orderZaloConsent: true } as unknown as OrderDTO} onTrack={vi.fn()} onContinue={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByText('TUBU-COD-12345');
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    if (invites) await screen.findByRole('button', { name: 'Mở Zalo Tubu Tree' });
    else await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryAllByRole('button', { name: 'Mở Zalo Tubu Tree' })).toHaveLength(invites);
  });
});
