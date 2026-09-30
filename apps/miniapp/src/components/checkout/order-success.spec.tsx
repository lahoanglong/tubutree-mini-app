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
      <OrderSuccess order={ORDER} onTrack={props.onTrack ?? vi.fn()} onContinue={props.onContinue ?? vi.fn()} />
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

  it('ngày giao dự kiến chỉ hiện khi đã cấu hình', async () => {
    renderSuccess();
    expect(await screen.findByText('Giao dự kiến')).toBeInTheDocument();
  });

  it('chưa cấu hình ETA (null) → không có dòng giao dự kiến', async () => {
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, shippingEta: null });
    renderSuccess();
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Giao dự kiến')).toBeNull());
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
