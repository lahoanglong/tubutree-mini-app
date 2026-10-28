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

const ORDER = {
  id: 'o1', code: 'TUBU-COD-12345', status: 'CONFIRMED', total: 149000, pointsEarned: 14, paymentMethod: 'COD',
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
    expect(screen.getByText('+14 điểm')).toBeInTheDocument();
    for (const s of ['Xác nhận đơn', 'Đóng gói', 'Giao hàng']) expect(screen.getByText(s)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(container.querySelector('.tubu-leaf')).toBeNull();
  });

  it('sao chép mã đơn', async () => {
    mocks.copyText.mockResolvedValue(true);
    renderSuccess();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã đơn' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã sao chép mã đơn' })));
    expect(mocks.copyText).toHaveBeenCalledWith('TUBU-COD-12345');
  });

  it('ngày giao dự kiến hiện đúng khoảng ngày khi đã cấu hình', async () => {
    renderSuccess();
    expect(await screen.findByText('Giao dự kiến')).toBeInTheDocument();
    expect(screen.getByText(/^\d{2}\/\d{2} – \d{2}\/\d{2}$/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã đơn' }));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Không sao chép được — mã đơn: TUBU-COD-12345', type: 'info' })),
    );
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã sao chép mã đơn' }));
  });

  it('gợi ý "Đặt định kỳ" khi variation còn hàng (cùng điều kiện PDP) → mở SubscribeSheet đúng variation', async () => {
    renderSuccess();
    fireEvent.click(await screen.findByRole('button', { name: 'Đặt định kỳ' }));
    expect(screen.getByText('subscribe-open:var-1')).toBeInTheDocument();
    expect(mocks.fetchProduct).toHaveBeenCalledWith('nrc');
  });

  it('variation hết hàng → không gợi ý định kỳ', async () => {
    mocks.fetchProduct.mockResolvedValue(PRODUCT(0));
    const { qc } = renderSuccess();
    // Chờ query sản phẩm THẬT SỰ có dữ liệu (không chỉ "đã gọi") — nếu bỏ kiểm tra stock thì nút
    // sẽ xuất hiện ngay sau bước này và assertion bên dưới fail.
    await waitFor(() => expect(qc.getQueryState(['product', 'nrc'])?.status).toBe('success'));
    expect(screen.queryByRole('button', { name: 'Đặt định kỳ' })).toBeNull();
  });

  it('tải sản phẩm lỗi (404/mạng) → ẩn gợi ý định kỳ, màn vẫn dùng được', async () => {
    mocks.fetchProduct.mockRejectedValue(new Error('404'));
    const { qc } = renderSuccess();
    await waitFor(() => expect(qc.getQueryState(['product', 'nrc'])?.status).toBe('error'));
    expect(screen.queryByRole('button', { name: 'Đặt định kỳ' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Theo dõi đơn' })).toBeInTheDocument();
  });

  it('đơn không có productSlug → không gọi fetchProduct và không gợi ý', async () => {
    const noSlug = { ...ORDER, items: [{ ...ORDER.items[0], productSlug: null }] } as unknown as OrderDTO;
    const { qc } = renderSuccess({ order: noSlug });
    await waitFor(() => expect(qc.getQueryState(['public-config'])?.status).toBe('success'));
    expect(mocks.fetchProduct).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Đặt định kỳ' })).toBeNull();
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
      expect(screen.queryByRole('button', { name: 'Đặt định kỳ' })).toBeNull();
      expect(screen.queryByText(/Mật ong ký gửi/)).toBeNull();
    });

    it('đơn trộn hàng ký gửi (dòng đầu) với hàng Tubu → gợi ý đúng món Tubu, mở SubscribeSheet đúng variation Tubu', async () => {
      mocks.fetchProduct.mockImplementation(byslug({ 'mat-ong-ky-gui': { partnerOwned: true } }));
      const order = { ...ORDER, items: [HONEY, ORDER.items[0]] } as unknown as OrderDTO;
      renderSuccess({ order });
      fireEvent.click(await screen.findByRole('button', { name: 'Đặt định kỳ' }));
      expect(screen.getByText('subscribe-open:var-1')).toBeInTheDocument();
      expect(screen.getByText(/Nước rửa chén/)).toBeInTheDocument();
      expect(screen.queryByText(/Mật ong ký gửi/)).toBeNull();
    });
  });

  it('gợi ý định kỳ nằm SAU hai CTA để không đẩy nút "Theo dõi đơn" khi sản phẩm tải xong', async () => {
    renderSuccess();
    const track = screen.getByRole('button', { name: 'Theo dõi đơn' });
    const keep = screen.getByRole('button', { name: 'Tiếp tục mua sắm' });
    const offer = await screen.findByRole('button', { name: 'Đặt định kỳ' });
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
    expect(screen.getByText('+26 điểm')).toBeInTheDocument();
    expect(screen.getByText('26 Điểm Xanh sẽ về tay khi đơn giao thành công')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã đơn' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('TB1, TB2, TB3'));
  });

  it('đơn không tách: không có danh sách đơn cùng lần đặt', () => {
    renderSuccess();
    expect(screen.queryByRole('region', { name: 'Đơn cùng lần đặt' })).toBeNull();
  });
});
