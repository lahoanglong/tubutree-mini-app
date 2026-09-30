import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrderDTO } from '@tubutree/shared-types';
import type * as ZmpUi from 'zmp-ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), fetchProduct: vi.fn(), getPublicConfig: vi.fn(), copyText: vi.fn(),
}));
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
const CONFIG = { freeshipThreshold: 200000, subscribeDiscountPct: 0.12, affiliateWalletMultiplier: 1.5, affiliateMinWithdrawBank: 50000, cashbackHoldDays: 30 };
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
});
