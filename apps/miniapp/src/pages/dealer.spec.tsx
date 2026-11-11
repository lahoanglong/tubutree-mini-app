import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterAll, type MockInstance } from 'vitest';
import { preorderQty, realDiscountPct, DEALER_MAX_QTY } from './dealer-pricing';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getDealerMe: vi.fn(),
  getPricelist: vi.fn(),
  placeDealerOrder: vi.fn(),
  getDealerOrders: vi.fn(),
  getCreditLedger: vi.fn(),
  payCredit: vi.fn(),
  getQuarterlyReport: vi.fn(),
  getDealerRewards: vi.fn(),
  getTemplates: vi.fn(),
  saveTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  claimDealerReward: vi.fn(),
  config: { isLoaded: true, dealer: { maxDiscountPct: 0.45, reviewHours: 24 } } as Record<string, unknown>,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div data-testid="sheet">{children}</div> : null,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/dealer', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/dealer-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDealerMe: mocks.getDealerMe,
  applyDealer: vi.fn(),
  getPricelist: mocks.getPricelist,
  placeDealerOrder: mocks.placeDealerOrder,
  getDealerOrders: mocks.getDealerOrders,
  getCreditLedger: mocks.getCreditLedger,
  payCredit: mocks.payCredit,
  getQuarterlyReport: mocks.getQuarterlyReport,
  getDealerRewards: mocks.getDealerRewards,
  claimDealerReward: mocks.claimDealerReward,
  getTemplates: mocks.getTemplates,
  saveTemplate: mocks.saveTemplate,
  deleteTemplate: mocks.deleteTemplate,
}));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.config }));
vi.mock('../components/image-upload', () => ({ ImageUpload: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { useAuthStore } from '../store/auth';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';
import DealerPage from './dealer';

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  variationId: 'v1', sku: 'POLANG-500', product: 'Nước rửa chén', brand: 'Pơ Lang', variation: '500ml',
  retailPrice: 100_000, dealerPrice: 80_000, discountPct: 20, stock: 5, ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DealerPage /></QueryClientProvider>);
}
const plus = () => screen.getByRole('button', { name: 'Tăng số lượng' });

describe('dealer-pricing (C-081)', () => {
  it('preorderQty: chỉ tính phần vượt tồn, tồn âm coi như 0', () => {
    expect(preorderQty(3, 5)).toBe(0);
    expect(preorderQty(5, 5)).toBe(0);
    expect(preorderQty(8, 5)).toBe(3);
    expect(preorderQty(2, 0)).toBe(2);
    expect(preorderQty(2, -4)).toBe(2);
  });
  it('realDiscountPct: tính từ giá thật, không âm', () => {
    expect(realDiscountPct(100_000, 70_000)).toBe(30);
    expect(realDiscountPct(100_000, 80_000)).toBe(20);
    expect(realDiscountPct(100_000, 100_000)).toBe(0);
    expect(realDiscountPct(100_000, 120_000)).toBe(0);
    expect(realDiscountPct(0, 0)).toBe(0);
  });
  it('trần số lượng là số hợp lý, không phải tồn kho', () => {
    expect(DEALER_MAX_QTY).toBeGreaterThan(1000);
  });
});

describe('DealerPage bảng giá — đặt trước hàng chưa về (C-081)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTemplates.mockResolvedValue([]);
    mocks.getDealerOrders.mockResolvedValue([]);
    mocks.getDealerMe.mockResolvedValue({
      isDealer: true, status: 'APPROVED', tier: { id: 't1', name: 'Bạc', creditLimit: 50_000_000 }, currentDebt: 0,
    });
  });

  it('SP hết hàng: ghi rõ được đặt trước và nút + vẫn bấm được', async () => {
    mocks.getPricelist.mockResolvedValue([row({ stock: 0 })]);
    renderPage();
    expect(await screen.findByText(/Hết hàng — được đặt trước/)).toBeInTheDocument();
    expect(plus()).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(plus());
    expect(await screen.findByText('Đặt trước 1, giao khi hàng về')).toBeInTheDocument();
  });

  it('vượt tồn thì hiện số lượng đặt trước, trong tồn thì không hiện', async () => {
    mocks.getPricelist.mockResolvedValue([row({ stock: 2 })]);
    renderPage();
    await screen.findByText(/tồn 2/);
    fireEvent.click(plus());
    fireEvent.click(plus());
    expect(screen.queryByText(/Đặt trước/)).toBeNull();
    fireEvent.click(plus());
    expect(screen.getByText('Đặt trước 1, giao khi hàng về')).toBeInTheDocument();
    fireEvent.click(plus());
    expect(screen.getByText('Đặt trước 2, giao khi hàng về')).toBeInTheDocument();
  });

  it('thanh tổng nói thật: cả đơn giao khi đủ hàng, giữ giá hôm nay, trả trước vẫn thanh toán đủ', async () => {
    mocks.getPricelist.mockResolvedValue([row({ stock: 0 })]);
    renderPage();
    await screen.findByText(/Hết hàng — được đặt trước/);
    fireEvent.click(plus());
    expect(await screen.findByText(/1 mặt hàng đặt vượt tồn/)).toBeInTheDocument();
    expect(screen.getByText(/cả đơn sẽ giao khi đủ hàng/)).toBeInTheDocument();
    expect(screen.getByText(/giữ giá hôm nay/)).toBeInTheDocument();
    expect(screen.getByText(/Đơn trả trước vẫn thanh toán đủ/)).toBeInTheDocument();
  });

  it('đặt đơn có phần đặt trước: thông báo rõ cả đơn giao khi đủ hàng', async () => {
    mocks.getPricelist.mockResolvedValue([row({ stock: 0 })]);
    mocks.placeDealerOrder.mockResolvedValue({ code: 'TUBU1', items: [{ backorderedQty: 1, quantity: 1 }] });
    renderPage();
    await screen.findByText(/Hết hàng — được đặt trước/);
    fireEvent.click(plus());
    fireEvent.click(await screen.findByRole('button', { name: 'Ghi công nợ' }));
    await waitFor(() => expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(1));
    expect(mocks.placeDealerOrder.mock.calls[0]![0]).toEqual([{ variationId: 'v1', quantity: 1 }]);
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Đã tạo đơn đại lý — đơn sẽ giao khi đủ hàng, giữ giá hôm nay.' }),
      ),
    );
  });

  it('đặt đơn đủ hàng: thông báo thường', async () => {
    mocks.getPricelist.mockResolvedValue([row({ stock: 9 })]);
    mocks.placeDealerOrder.mockResolvedValue({ code: 'TUBU2', items: [{ backorderedQty: 0, quantity: 1 }] });
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    fireEvent.click(await screen.findByRole('button', { name: 'Ghi công nợ' }));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã tạo đơn đại lý!' })),
    );
  });

  it('nhãn -X% tính từ giá thật của dòng, không lấy mặc định của bậc', async () => {
    mocks.getPricelist.mockResolvedValue([
      row({ variationId: 'v1', sku: 'A', dealerPrice: 70_000, discountPct: 20 }),
      row({ variationId: 'v2', sku: 'B', dealerPrice: 100_000, discountPct: 20 }),
    ]);
    renderPage();
    await screen.findByText(/A · tồn 5/);
    expect(screen.getAllByText(/^-\d+%$/).map((n) => n.textContent)).toEqual(['-30%']);
  });
});

const APPROVED_ME = {
  isDealer: true, status: 'APPROVED', tier: { id: 't1', name: 'Bạc', creditLimit: 50_000_000 }, currentDebt: 1_000_000, hasPartnerStorefront: true,
};
const h1Count = () => screen.queryAllByRole('heading', { level: 1 }).length;
const openTab = (label: string) => fireEvent.click(screen.getByText(label, { exact: true }));

describe('DealerPage — đúng một h1 ở mọi trạng thái (C-114)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTemplates.mockResolvedValue([]);
    mocks.getPricelist.mockResolvedValue([]);
  });

  it('đang tải hồ sơ đại lý', () => {
    mocks.getDealerMe.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(h1Count()).toBe(1);
  });

  it('lỗi tải hồ sơ đại lý', async () => {
    mocks.getDealerMe.mockRejectedValue(new Error('boom'));
    renderPage();
    await screen.findByRole('button', { name: 'Thử lại' });
    expect(h1Count()).toBe(1);
  });

  it.each([
    ['chưa đăng ký', { isDealer: false, status: 'NONE' }],
    ['hồ sơ bị từ chối', { isDealer: false, status: 'REJECTED' }],
  ])('form đăng ký (%s)', async (_name, me) => {
    mocks.getDealerMe.mockResolvedValue(me);
    renderPage();
    await screen.findByText('Trở thành đại lý Tubu');
    expect(h1Count()).toBe(1);
  });

  it('hồ sơ bị từ chối: hiện lý do admin ghi để người đăng ký sửa đúng chỗ (SELLER-12)', async () => {
    mocks.getDealerMe.mockResolvedValue({ isDealer: false, status: 'REJECTED', rejectionReason: 'Ảnh CCCD mờ' });
    renderPage();
    expect(await screen.findByText('Lý do: Ảnh CCCD mờ')).toBeInTheDocument();
  });

  it('hồ sơ đang chờ duyệt', async () => {
    mocks.getDealerMe.mockResolvedValue({ isDealer: false, status: 'PENDING' });
    renderPage();
    await screen.findByText('Hồ sơ đang được duyệt');
    expect(h1Count()).toBe(1);
  });

  it('kênh đại lý đã duyệt', async () => {
    mocks.getDealerMe.mockResolvedValue(APPROVED_ME);
    renderPage();
    await screen.findByText('Bạc');
    expect(h1Count()).toBe(1);
  });
});

describe('DealerPage — icon giữ màu ink B2B của kênh đại lý', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTemplates.mockResolvedValue([]);
    mocks.getPricelist.mockResolvedValue([row({ stock: 9 })]);
    mocks.getDealerOrders.mockResolvedValue([]);
  });

  it('hồ sơ đang chờ duyệt: đồng hồ cát màu ink, không phải xanh thương hiệu', async () => {
    mocks.getDealerMe.mockResolvedValue({ isDealer: false, status: 'PENDING' });
    renderPage();
    await screen.findByText('Hồ sơ đang được duyệt');
    const icon = document.querySelector<SVGElement>('svg.lucide-hourglass')!;
    expect(icon.style.stroke).toBe('var(--color-dealer-ink)');
  });

  it('mẫu đơn: icon bảng ghi chú màu ink như chữ cạnh nó', async () => {
    mocks.getDealerMe.mockResolvedValue(APPROVED_ME);
    mocks.getTemplates.mockResolvedValue([{ id: 'tp1', name: 'Đơn tháng', items: [{ variationId: 'v1', quantity: 2 }] }]);
    renderPage();
    await screen.findByRole('button', { name: /Đơn tháng/ });
    const icon = document.querySelector<SVGElement>('svg.lucide-clipboard-list')!;
    expect(icon.style.stroke).toBe('var(--color-dealer-ink)');
  });
});

describe('DealerPage — tab, mẫu đơn, đặt nhanh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDealerMe.mockResolvedValue(APPROVED_ME);
    mocks.getPricelist.mockResolvedValue([row({ stock: 9 })]);
    mocks.getTemplates.mockResolvedValue([]);
    mocks.getDealerOrders.mockResolvedValue([]);
  });

  it('bốn tab là tablist có aria-selected, mặc định là Bảng giá', async () => {
    renderPage();
    await screen.findByText(/tồn 9/);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Bảng giá', 'Đơn hàng', 'Công nợ', 'Báo cáo']);
    expect(screen.getByRole('tab', { name: 'Bảng giá' })).toHaveAttribute('aria-selected', 'true');
    mocks.getCreditLedger.mockResolvedValue({ balance: 0, entries: [] });
    fireEvent.click(screen.getByRole('tab', { name: 'Công nợ' }));
    expect(screen.getByRole('tab', { name: 'Công nợ' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Bảng giá' })).toHaveAttribute('aria-selected', 'false');
    expect(await screen.findByText('Dư nợ hiện tại')).toBeInTheDocument();
  });

  it('dòng bảng giá: phân loại ở dòng riêng, đậm, tách khỏi tên sản phẩm', async () => {
    renderPage();
    const variation = await screen.findByText('500ml');
    expect(variation.textContent).toBe('500ml');
    expect(variation.style.fontWeight).toBe('700');
    expect(screen.getByText('Nước rửa chén').style.webkitLineClamp).toBe('2');
  });

  it('bảng giá rỗng khi chưa tìm gì: nói chưa có hàng giá sỉ cho bậc, không nói "không tìm thấy"', async () => {
    mocks.getPricelist.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Chưa có hàng giá sỉ cho bậc của bạn')).toBeInTheDocument();
    expect(screen.queryByText('Không tìm thấy sản phẩm')).toBeNull();
  });

  it('tab Đơn hàng rỗng có nút "Đặt đơn sỉ" đưa về Bảng giá; đổi tab ghi ?tab= lên URL', async () => {
    renderPage();
    await screen.findByText(/tồn 9/);
    openTab('Đơn hàng');
    expect(mocks.navigate).toHaveBeenCalledWith('/dealer?tab=orders', { replace: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Đặt đơn sỉ' }));
    expect(screen.getByRole('tab', { name: 'Bảng giá' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.navigate).toHaveBeenLastCalledWith('/dealer', { replace: true });
  });

  it('mẫu đơn: chạm tên nạp lại số lượng, nút xoá gọi deleteTemplate đúng id', async () => {
    mocks.getTemplates.mockResolvedValue([{ id: 'tp1', name: 'Đơn tháng', items: [{ variationId: 'v1', quantity: 2 }] }]);
    mocks.deleteTemplate.mockResolvedValue({ ok: true });
    renderPage();
    fireEvent.click(await screen.findByText(/Đơn tháng/));
    expect(await screen.findByText('160.000đ')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Xoá mẫu đơn'));
    await waitFor(() => expect(mocks.deleteTemplate).toHaveBeenCalledWith('tp1'));
  });

  it('mẫu đơn: tên mẫu và nút xoá đều là button thật (Tab + Enter/Space)', async () => {
    mocks.getTemplates.mockResolvedValue([{ id: 'tp1', name: 'Đơn tháng', items: [{ variationId: 'v1', quantity: 2 }] }]);
    renderPage();
    const load = await screen.findByRole('button', { name: /Đơn tháng/ });
    expect(load.tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: 'Xoá mẫu đơn' }).tagName).toBe('BUTTON');
  });

  it('Trả trước đặt đơn PREPAID rồi chuyển tới màn thanh toán QR', async () => {
    mocks.placeDealerOrder.mockResolvedValue({ code: 'TUBU3', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', items: [{ backorderedQty: 0, quantity: 1 }] });
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    fireEvent.click(await screen.findByRole('button', { name: 'Trả trước' }));
    await waitFor(() => expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(1));
    expect(mocks.placeDealerOrder.mock.calls[0]![1]).toBe('PREPAID');
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/bank-payment/TUBU3'));
  });

  it('đơn trả về đã CONFIRMED (đơn công nợ của lần thử trước) thì không mở màn QR dù bấm Trả trước', async () => {
    mocks.placeDealerOrder.mockResolvedValue({ code: 'TUBU4', status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', items: [{ backorderedQty: 0, quantity: 1 }] });
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    fireEvent.click(await screen.findByRole('button', { name: 'Trả trước' }));
    await waitFor(() => expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(mocks.navigate).not.toHaveBeenCalledWith('/bank-payment/TUBU4');
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'error', text: expect.stringMatching(/TUBU4.*lần trước.*Ghi công nợ.*không cần chuyển khoản/) });
  });

  it('bấm Ghi công nợ mà máy chủ trả đơn Trả trước còn chờ chuyển khoản (lần trước): báo đúng hình thức và mở màn QR', async () => {
    mocks.placeDealerOrder.mockResolvedValue({ code: 'TUBU6', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', items: [{ backorderedQty: 0, quantity: 1 }] });
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    fireEvent.click(await screen.findByRole('button', { name: 'Ghi công nợ' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'error', text: expect.stringMatching(/TUBU6.*lần trước.*Trả trước.*chuyển khoản/) });
    expect(mocks.navigate).toHaveBeenCalledWith('/bank-payment/TUBU6');
  });

  it('lỗi mạng rồi đổi giỏ hoặc đổi phương thức thì vẫn giữ Idempotency-Key (máy chủ có thể đã tạo đơn)', async () => {
    mocks.placeDealerOrder.mockRejectedValue(new Error('network'));
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    fireEvent.click(await screen.findByRole('button', { name: 'Ghi công nợ' }));
    await waitFor(() => expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Trả trước' }));
    await waitFor(() => expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(2));
    fireEvent.click(plus());
    fireEvent.click(screen.getByRole('button', { name: 'Ghi công nợ' }));
    await waitFor(() => expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(3));
    const keys = mocks.placeDealerOrder.mock.calls.map((c) => c[3]);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
  });

  it('máy chủ trả đơn của lần đặt trước (giỏ khác giỏ hiện tại): giữ giỏ, đổi khoá, báo giỏ chưa đặt, không mở QR', async () => {
    mocks.placeDealerOrder.mockResolvedValue({
      code: 'TUBU5', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER',
      items: [{ variationId: 'v1', quantity: 5, backorderedQty: 0 }],
    });
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    fireEvent.click(await screen.findByRole('button', { name: 'Trả trước' }));
    await waitFor(() => expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'error', text: expect.stringContaining('TUBU5') });
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Trả trước' }));
    await waitFor(() => expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(2));
    expect(mocks.placeDealerOrder.mock.calls[1]![0]).toEqual([{ variationId: 'v1', quantity: 1 }]);
    expect(mocks.placeDealerOrder.mock.calls[1]![3]).not.toBe(mocks.placeDealerOrder.mock.calls[0]![3]);
  });

  it('vượt hạn mức: chặn Ghi công nợ, vẫn cho Trả trước, cảnh báo bằng chữ', async () => {
    mocks.getDealerMe.mockResolvedValue({ ...APPROVED_ME, tier: { id: 't1', name: 'Bạc', creditLimit: 1_000_000 }, currentDebt: 950_000 });
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    expect(await screen.findByText(/Vượt hạn mức công nợ/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi công nợ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trả trước' })).not.toBeDisabled();
  });

  it('dán đơn: khớp SKU thì cộng vào đơn, báo kết quả bằng chữ không kèm ký tự ✓', async () => {
    const { container } = renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(screen.getByRole('button', { name: 'Dán đơn' }));
    const textarea = container.ownerDocument.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'POLANG-500 3\nSAI-SKU 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm vào đơn' }));
    const result = await screen.findByText(/Khớp 1 dòng/);
    expect(result.textContent).toContain('Không khớp: SAI-SKU');
    expect(result.textContent).not.toContain('✓');
    expect(await screen.findByText('240.000đ')).toBeInTheDocument();
  });

  it('ô tìm kiếm lọc theo SKU và báo trống khi không có kết quả', async () => {
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.change(screen.getByPlaceholderText('Tìm tên, SKU'), { target: { value: 'khong-co-san-pham-nay' } });
    expect(await screen.findByText(/Không tìm thấy sản phẩm/)).toBeInTheDocument();
  });
});

describe('DealerPage — đơn hàng, công nợ, báo cáo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDealerMe.mockResolvedValue(APPROVED_ME);
    mocks.getPricelist.mockResolvedValue([]);
    mocks.getTemplates.mockResolvedValue([]);
  });

  it('thẻ đơn bấm được bằng chuột lẫn bàn phím, giữ nhãn chờ hàng và Thanh toán ngay', async () => {
    mocks.getDealerOrders.mockResolvedValue([
      {
        code: 'TUBU9', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', total: 500_000,
        createdAt: '2026-09-01T00:00:00.000Z', items: [{ backorderedQty: 2 }, { backorderedQty: 0 }],
      },
    ]);
    renderPage();
    await screen.findByText('Bạc');
    openTab('Đơn hàng');
    const card = await screen.findByRole('button', { name: 'Xem đơn TUBU9' });
    expect(screen.getByText('Đặt trước 2 — chờ hàng về')).toBeInTheDocument();
    expect(screen.getByText('Thanh toán ngay →')).toBeInTheDocument();
    expect(screen.getByText('500.000đ')).toBeInTheDocument();
    fireEvent.click(card);
    expect(mocks.navigate).toHaveBeenLastCalledWith('/order/TUBU9');
  });

  it('thẻ đơn là điểm dừng Tab, Enter mở chi tiết đơn', async () => {
    mocks.getDealerOrders.mockResolvedValue([
      { code: 'TUBU9', status: 'PACKED', paymentMethod: 'COD', total: 500_000, createdAt: '2026-09-01T00:00:00.000Z', items: [] },
    ]);
    renderPage();
    await screen.findByText('Bạc');
    openTab('Đơn hàng');
    const card = await screen.findByRole('button', { name: 'Xem đơn TUBU9' });
    expect(card).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TUBU9');
  });

  it('công nợ: Báo đã chuyển khoản gửi đúng số tiền + ghi chú, chặn số tiền vượt dư nợ, sổ rỗng có trạng thái rỗng', async () => {
    mocks.getCreditLedger.mockResolvedValue({ balance: 3_000_000, entries: [] });
    mocks.payCredit.mockResolvedValue({ ok: true });
    renderPage();
    await screen.findByText('Bạc');
    openTab('Công nợ');
    expect(await screen.findByText('3.000.000đ')).toBeInTheDocument();
    expect(screen.getByText(/Chưa có giao dịch công nợ/)).toBeInTheDocument();
    const amount = screen.getByLabelText('Số tiền đã chuyển');
    const pay = screen.getByRole('button', { name: 'Báo đã chuyển khoản' });
    fireEvent.change(amount, { target: { value: '4000000' } });
    expect(pay).toBeDisabled();
    expect(screen.getByText('Số tiền vượt dư nợ hiện tại (3.000.000đ).')).toBeInTheDocument();
    fireEvent.change(amount, { target: { value: '1000000' } });
    expect(pay).not.toBeDisabled();
    fireEvent.click(pay);
    await waitFor(() => expect(mocks.payCredit).toHaveBeenCalledTimes(1));
    expect(mocks.payCredit).toHaveBeenCalledWith(1_000_000, expect.any(String), 'Báo đã chuyển khoản');
  });

  it('sổ công nợ giữ dấu +/- của từng dòng', async () => {
    mocks.getCreditLedger.mockResolvedValue({
      balance: 200_000,
      entries: [
        { id: 'e1', delta: 500_000, note: 'Đơn TUBU1', refType: 'ORDER', createdAt: '2026-09-01T00:00:00.000Z' },
        { id: 'e2', delta: -300_000, note: null, refType: 'PAYMENT', createdAt: '2026-09-02T00:00:00.000Z' },
      ],
    });
    renderPage();
    await screen.findByText('Bạc');
    openTab('Công nợ');
    expect(await screen.findByText('+500.000đ')).toBeInTheDocument();
    expect(screen.getByText('-300.000đ')).toBeInTheDocument();
    expect(screen.getByText('PAYMENT')).toBeInTheDocument();
  });

  function mockReport() {
    mocks.getQuarterlyReport.mockResolvedValue({
      quarter: 'Q3/2026', periodStart: '', periodEnd: '', revenue: 120_000_000, orderCount: 14,
      pendingRevenue: 5_000_000, pendingOrderCount: 1, bonusPct: 2, bonusAmount: 2_400_000,
      nextTier: { min: 200_000_000, pct: 3, toNext: 80_000_000 },
      tiers: [{ min: 100_000_000, pct: 2 }, { min: 200_000_000, pct: 3 }],
    });
    mocks.getDealerRewards.mockResolvedValue({
      claimGraceDays: 30,
      rewards: [
        {
          id: 'rw1', type: 'TOUR', title: 'Tour Đà Nẵng', description: null, threshold: 100_000_000, period: 'QUARTER',
          periodKey: 'Q3/2026', periodLabel: 'Quý 3/2026', isCurrentPeriod: true, volume: 120_000_000, pendingVolume: 0,
          achieved: true, toGo: 0, claimStatus: null, claimId: null, rejectionReason: null, claimDeadline: '2026-10-30T17:00:00.000Z',
          canClaim: true,
        },
      ],
    });
  }

  it('báo cáo quý: giữ số liệu doanh số/thưởng/bậc/phần thưởng', async () => {
    mockReport();
    renderPage();
    await screen.findByText('Bạc');
    openTab('Báo cáo');
    expect(await screen.findByText('Doanh số Q3/2026')).toBeInTheDocument();
    expect(screen.getByText('120.000.000đ')).toBeInTheDocument();
    expect(screen.getByText(/14 đơn đã chốt/)).toBeInTheDocument();
    expect(screen.getByText('2.400.000đ')).toBeInTheDocument();
    expect(screen.getByText('Còn 80.000.000đ để đạt thưởng 3%')).toBeInTheDocument();
    expect(screen.getByText(/Từ 100\.000\.000đ/)).toBeInTheDocument();
    expect(screen.getByText('thưởng 2%')).toBeInTheDocument();
    expect(await screen.findByText('Phần thưởng đại lý')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yêu cầu nhận thưởng' })).toBeInTheDocument();
  });

  it('báo cáo quý: % bậc thưởng ghi kiểu Việt, 4,5% và 4% (không "4.5%")', async () => {
    mockReport();
    mocks.getQuarterlyReport.mockResolvedValue({
      quarter: 'Q3/2026', periodStart: '', periodEnd: '', revenue: 120_000_000, orderCount: 14,
      pendingRevenue: 0, pendingOrderCount: 0, bonusPct: 2.5, bonusAmount: 3_000_000,
      nextTier: { min: 200_000_000, pct: 4.5, toNext: 80_000_000 },
      tiers: [{ min: 100_000_000, pct: 2.5 }, { min: 200_000_000, pct: 4.5 }, { min: 300_000_000, pct: 4 + 0 }],
    });
    renderPage();
    await screen.findByText('Bạc');
    openTab('Báo cáo');
    expect(await screen.findByText('Còn 80.000.000đ để đạt thưởng 4,5%')).toBeInTheDocument();
    expect(screen.getByText(/Thưởng hiện tại 2,5% =/)).toBeInTheDocument();
    expect(screen.getByText('thưởng 2,5%')).toBeInTheDocument();
    expect(screen.getByText('thưởng 4,5%')).toBeInTheDocument();
    expect(screen.getByText('thưởng 4%')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d\.\d%/);
  });

  it('báo cáo quý: mốc đã đạt báo bằng icon, không dùng ký tự ✓ trong chữ', async () => {
    mockReport();
    renderPage();
    await screen.findByText('Bạc');
    openTab('Báo cáo');
    await screen.findByText('Phần thưởng đại lý');
    expect(document.body.textContent).not.toContain('✓');
  });
});

// D5-10: lời chào trang đăng ký đại lý và lời hẹn duyệt hồ sơ lấy số từ config công khai, không viết cứng 45% / 24 giờ.
describe('DealerPage — số trong chữ theo cấu hình (D5-10)', () => {
  const DEFAULT_CONFIG = { isLoaded: true, dealer: { maxDiscountPct: 0.45, reviewHours: 24 } };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config = DEFAULT_CONFIG;
  });
  afterAll(() => {
    mocks.config = DEFAULT_CONFIG;
  });

  it('trang đăng ký: "Giá sỉ đến X%" theo chiết khấu tối đa admin đặt', async () => {
    mocks.getDealerMe.mockResolvedValue({ isDealer: false, status: 'NONE' });
    mocks.config = { isLoaded: true, dealer: { maxDiscountPct: 0.4, reviewHours: 24 } };
    renderPage();
    expect(await screen.findByText('Giá sỉ đến 40% · công nợ · đặt hàng nhanh số lượng lớn.')).toBeInTheDocument();
  });

  it('chưa có số (API cũ, cấu hình hỏng, chưa tải xong): bỏ con số, không hiện số mặc định', async () => {
    mocks.getDealerMe.mockResolvedValue({ isDealer: false, status: 'NONE' });
    for (const config of [{ isLoaded: false }, { isLoaded: true }, { isLoaded: true, dealer: { maxDiscountPct: null, reviewHours: null } }]) {
      mocks.config = config;
      const view = renderPage();
      expect(await screen.findByText('Giá sỉ ưu đãi · công nợ · đặt hàng nhanh số lượng lớn.')).toBeInTheDocument();
      expect(screen.queryByText(/\d+%/)).toBeNull();
      view.unmount();
    }
  });

  it('hồ sơ chờ duyệt: số giờ theo cấu hình; không có số thì không hẹn giờ', async () => {
    mocks.getDealerMe.mockResolvedValue({ isDealer: false, status: 'PENDING' });
    mocks.config = { isLoaded: true, dealer: { maxDiscountPct: 0.45, reviewHours: 48 } };
    const withHours = renderPage();
    expect(await screen.findByText('Đội ngũ Tubu sẽ xét duyệt trong vòng 48 giờ và liên hệ lại với bạn qua Zalo.')).toBeInTheDocument();
    withHours.unmount();

    mocks.config = { isLoaded: true, dealer: { maxDiscountPct: 0.45, reviewHours: null } };
    renderPage();
    expect(await screen.findByText('Đội ngũ Tubu sẽ xét duyệt và liên hệ lại với bạn qua Zalo.')).toBeInTheDocument();
  });
});

describe('DealerPage — báo trước phí giao và mức tối thiểu của đơn sỉ', () => {
  const RULES = { minOrderValue: 3_000_000, freeShipThreshold: 5_000_000, shippingFee: 19_000 };
  const meWith = (over: Record<string, unknown> = {}) => ({ ...APPROVED_ME, currentDebt: 0, orderRules: RULES, ...over });
  const priced = (dealerPrice: number) => mocks.getPricelist.mockResolvedValue([row({ dealerPrice, stock: 9 })]);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTemplates.mockResolvedValue([]);
    mocks.getDealerOrders.mockResolvedValue([]);
    mocks.getDealerMe.mockResolvedValue(meWith());
  });

  it('giỏ 4.000.000đ: hiện phí giao 19.000đ, tổng 4.019.000đ và nút đặt bật', async () => {
    priced(4_000_000);
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    expect(await screen.findByText('4.019.000đ')).toBeInTheDocument();
    expect(screen.getByText(/Phí giao 19\.000đ/)).toBeInTheDocument();
    expect(screen.getByText(/miễn phí từ 5\.000\.000đ/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi công nợ' })).not.toBeDisabled();
  });

  it('giỏ 5.000.000đ: miễn phí giao, tổng bằng tiền hàng', async () => {
    priced(5_000_000);
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    expect(await screen.findByText(/Miễn phí giao/)).toBeInTheDocument();
    // Một lần ở đơn giá dòng hàng, một lần ở thanh tổng.
    expect(screen.getAllByText('5.000.000đ')).toHaveLength(2);
    expect(screen.queryByText(/Phí giao 19\.000đ/)).toBeNull();
  });

  it('giỏ 2.999.999đ: tắt cả hai nút đặt và ghi mức tối thiểu', async () => {
    priced(2_999_999);
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    expect(await screen.findByText(/Đơn tối thiểu 3\.000\.000đ/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi công nợ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trả trước' })).toBeDisabled();
  });

  it('hạn mức tính cả phí giao: nợ + tiền hàng vừa trong hạn mức nhưng cộng phí thì vượt', async () => {
    mocks.getDealerMe.mockResolvedValue(
      meWith({ tier: { id: 't1', name: 'Bạc', creditLimit: 10_000_000 }, currentDebt: 6_000_000 }),
    );
    priced(4_000_000);
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    expect(await screen.findByText(/Vượt hạn mức công nợ/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi công nợ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trả trước' })).not.toBeDisabled();
  });
});

describe('DealerPage — điều kiện, nhãn, gian hàng đối tác (B-86, B-41)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTemplates.mockResolvedValue([]);
    mocks.getPricelist.mockResolvedValue([]);
    mocks.getDealerOrders.mockResolvedValue([]);
  });

  it('form đăng ký có điều kiện, quyền lợi, số giờ duyệt và mọi ô nhập có nhãn', async () => {
    mocks.getDealerMe.mockResolvedValue({ isDealer: false, status: 'NONE' });
    renderPage();
    const box = await screen.findByTestId('dealer-conditions');
    expect(box).toHaveTextContent('Điều kiện đăng ký');
    expect(box).toHaveTextContent('Quyền lợi');
    expect(box).toHaveTextContent('24 giờ');
    for (const name of ['Tên doanh nghiệp / cửa hàng *', 'Mã số thuế', 'Người đại diện *', 'Số điện thoại *', 'Địa chỉ kinh doanh *']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
  });

  it('form đăng ký điền sẵn Người đại diện và Số điện thoại từ tài khoản, ô khác để trống', async () => {
    useAuthStore.setState({ user: { id: 'u1', role: 'CUSTOMER', fullName: 'Lan Nguyễn', phone: '0901234567' } as never });
    mocks.getDealerMe.mockResolvedValue({ isDealer: false, status: 'NONE' });
    renderPage();
    await screen.findByTestId('dealer-conditions');
    expect(screen.getByLabelText('Người đại diện *')).toHaveValue('Lan Nguyễn');
    expect(screen.getByLabelText('Số điện thoại *')).toHaveValue('0901234567');
    expect(screen.getByLabelText('Tên doanh nghiệp / cửa hàng *')).toHaveValue('');
    useAuthStore.setState({ user: null });
  });

  it('hub đại lý có ghi chú quản lý gian hàng đối tác trên web, không có đường dẫn', async () => {
    mocks.getDealerMe.mockResolvedValue(APPROVED_ME);
    renderPage();
    const note = await screen.findByTestId('partner-storefront-note');
    expect(note).toHaveTextContent('Gian hàng đối tác');
    expect(note.querySelector('a')).toBeNull();
  });

  it('đại lý chưa có gian hàng đối tác: không hiện thẻ', async () => {
    mocks.getDealerMe.mockResolvedValue({ ...APPROVED_ME, hasPartnerStorefront: false });
    renderPage();
    await screen.findByText('Bạc');
    expect(screen.queryByTestId('partner-storefront-note')).toBeNull();
  });
});

// W76A: hai cú chạm trong CÙNG một khung hình (trước khi React vẽ lại `isPending`) từng gửi hai yêu cầu; khoá ref chặn ngay.
describe('DealerPage — khoá chạm đúp trong cùng một khung hình (W76A)', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const snackbarWith = (text: string) => mocks.openSnackbar.mock.calls.filter((c) => c[0].text === text).length;
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  const ORDER_OK = { code: 'TUBU7', status: 'CONFIRMED', paymentMethod: 'COD', items: [{ backorderedQty: 0, quantity: 1 }] };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [mocks.placeDealerOrder, mocks.payCredit, mocks.saveTemplate, mocks.deleteTemplate, mocks.claimDealerReward]) fn.mockReset();
    mocks.getDealerMe.mockResolvedValue(APPROVED_ME);
    mocks.getPricelist.mockResolvedValue([row({ stock: 9 })]);
    mocks.getTemplates.mockResolvedValue([]);
    mocks.getDealerOrders.mockResolvedValue([]);
    mocks.getCreditLedger.mockResolvedValue({ balance: 3_000_000, entries: [] });
  });

  describe('đặt đơn sỉ (place)', () => {
    const addOneAndFind = async (name: string) => {
      renderPage();
      await screen.findByText(/tồn 9/);
      fireEvent.click(plus());
      return screen.findByRole('button', { name });
    };

    it('chạm đúp "Ghi công nợ" chỉ đặt một đơn; đang đặt cả hai nút aria-busy và không bị disabled', async () => {
      const d = deferred();
      mocks.placeDealerOrder.mockReturnValueOnce(d.promise);
      const credit = await addOneAndFind('Ghi công nợ');
      await act(async () => {
        fireEvent.click(credit);
        fireEvent.click(credit);
      });
      expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(credit).toHaveAttribute('aria-busy', 'true'));
      expect(credit).not.toBeDisabled();
      const prepaid = screen.getByRole('button', { name: 'Trả trước' });
      expect(prepaid).toHaveAttribute('aria-busy', 'true');
      expect(prepaid).not.toBeDisabled();
      await act(async () => d.resolve(ORDER_OK));
      await waitFor(() => expect(snackbarWith('Đã tạo đơn đại lý!')).toBe(1));
      expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(1);
      expect(mocks.navigate).not.toHaveBeenCalled();
    });

    it.each([
      ['Trả trước', 'Ghi công nợ', 'PREPAID'],
      ['Ghi công nợ', 'Trả trước', 'CREDIT'],
    ])('bấm "%s" rồi "%s" trong một khung hình: cùng một khoá, chỉ gửi lệnh đầu (%s)', async (first, second, method) => {
      const d = deferred();
      mocks.placeDealerOrder.mockReturnValueOnce(d.promise);
      const firstBtn = await addOneAndFind(first);
      const secondBtn = screen.getByRole('button', { name: second });
      await act(async () => {
        fireEvent.click(firstBtn);
        fireEvent.click(secondBtn);
      });
      expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(1);
      expect(mocks.placeDealerOrder.mock.calls[0]![1]).toBe(method);
      await act(async () => d.resolve(ORDER_OK));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
      expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(1);
    });

    it('lỗi thì nhả khoá, bấm lại gọi lần hai với CÙNG Idempotency-Key; thành công mới đổi khoá', async () => {
      mocks.placeDealerOrder.mockRejectedValueOnce(new Error('network')).mockResolvedValue(ORDER_OK);
      const credit = await addOneAndFind('Ghi công nợ');
      await act(async () => {
        fireEvent.click(credit);
        fireEvent.click(credit);
      });
      expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await waitFor(() => expect(credit).not.toHaveAttribute('aria-busy'));
      fireEvent.click(credit);
      await waitFor(() => expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(snackbarWith('Đã tạo đơn đại lý!')).toBe(1));
      const keys = mocks.placeDealerOrder.mock.calls.map((c) => c[3]);
      expect(typeof keys[0]).toBe('string');
      expect(keys[1]).toBe(keys[0]);
      fireEvent.click(plus());
      fireEvent.click(await screen.findByRole('button', { name: 'Ghi công nợ' }));
      await waitFor(() => expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(3));
      expect(mocks.placeDealerOrder.mock.calls[2]![3]).not.toBe(keys[0]);
    });
  });

  describe('báo đã chuyển khoản (pay)', () => {
    const openCredit = async () => {
      renderPage();
      await screen.findByText('Bạc');
      openTab('Công nợ');
      const amount = (await screen.findByLabelText('Số tiền đã chuyển')) as HTMLInputElement;
      fireEvent.change(amount, { target: { value: '1000000' } });
      return { amount, pay: screen.getByRole('button', { name: 'Báo đã chuyển khoản' }) };
    };

    it('chạm đúp "Báo đã chuyển khoản" chỉ gửi một báo; đang gửi nút aria-busy, không disabled', async () => {
      const d = deferred();
      mocks.payCredit.mockReturnValueOnce(d.promise);
      const { amount, pay } = await openCredit();
      await act(async () => {
        fireEvent.click(pay);
        fireEvent.click(pay);
      });
      expect(mocks.payCredit).toHaveBeenCalledTimes(1);
      expect(mocks.payCredit).toHaveBeenCalledWith(1_000_000, expect.any(String), 'Báo đã chuyển khoản');
      await waitFor(() => expect(pay).toHaveAttribute('aria-busy', 'true'));
      expect(pay).not.toBeDisabled();
      await act(async () => d.resolve({ message: 'Đã báo cho Tubu.' }));
      await waitFor(() => expect(snackbarWith('Đã báo cho Tubu.')).toBe(1));
      expect(mocks.payCredit).toHaveBeenCalledTimes(1);
      expect(amount.value).toBe('');
    });

    it('lỗi thì nhả khoá, bấm lại gọi lần hai với CÙNG khoá; thành công mới đổi khoá', async () => {
      mocks.payCredit.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ ok: true });
      const { amount, pay } = await openCredit();
      await act(async () => {
        fireEvent.click(pay);
        fireEvent.click(pay);
      });
      expect(mocks.payCredit).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await waitFor(() => expect(pay).not.toHaveAttribute('aria-busy'));
      fireEvent.click(pay);
      await waitFor(() => expect(mocks.payCredit).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(amount.value).toBe(''));
      expect(mocks.payCredit.mock.calls[1]![1]).toBe(mocks.payCredit.mock.calls[0]![1]);
      fireEvent.change(amount, { target: { value: '500000' } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Báo đã chuyển khoản' })).not.toHaveAttribute('aria-busy'));
      fireEvent.click(screen.getByRole('button', { name: 'Báo đã chuyển khoản' }));
      await waitFor(() => expect(mocks.payCredit).toHaveBeenCalledTimes(3));
      expect(mocks.payCredit.mock.calls[2]![1]).not.toBe(mocks.payCredit.mock.calls[0]![1]);
    });
  });

  describe('lưu mẫu đơn (saveTpl)', () => {
    const openSaveSheet = async () => {
      renderPage();
      await screen.findByText(/tồn 9/);
      fireEvent.click(plus());
      fireEvent.click(await screen.findByRole('button', { name: 'Lưu mẫu' }));
      fireEvent.change(await screen.findByPlaceholderText('Tên mẫu (vd Đơn tháng)'), { target: { value: 'Đơn tháng' } });
      return within(screen.getByTestId('sheet')).getByRole('button', { name: 'Lưu mẫu' });
    };

    it('chạm đúp "Lưu mẫu" chỉ lưu một mẫu; đang lưu nút aria-busy, không disabled; xong thì đóng khung', async () => {
      const d = deferred();
      mocks.saveTemplate.mockReturnValueOnce(d.promise);
      const save = await openSaveSheet();
      await act(async () => {
        fireEvent.click(save);
        fireEvent.click(save);
      });
      expect(mocks.saveTemplate).toHaveBeenCalledTimes(1);
      expect(mocks.saveTemplate).toHaveBeenCalledWith('Đơn tháng', [{ variationId: 'v1', quantity: 1 }]);
      await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'));
      expect(save).not.toBeDisabled();
      await act(async () => d.resolve({ id: 'tp1' }));
      await waitFor(() => expect(snackbarWith('Đã lưu mẫu đơn.')).toBe(1));
      await waitFor(() => expect(screen.queryByTestId('sheet')).toBeNull());
      expect(mocks.saveTemplate).toHaveBeenCalledTimes(1);
    });

    it('lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
      mocks.saveTemplate.mockRejectedValueOnce(new Error('Trùng tên')).mockResolvedValue({ id: 'tp1' });
      const save = await openSaveSheet();
      await act(async () => {
        fireEvent.click(save);
        fireEvent.click(save);
      });
      expect(mocks.saveTemplate).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await waitFor(() => expect(save).not.toHaveAttribute('aria-busy'));
      fireEvent.click(save);
      await waitFor(() => expect(mocks.saveTemplate).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(snackbarWith('Đã lưu mẫu đơn.')).toBe(1));
    });
  });

  describe('xoá mẫu đơn (delTpl, khoá theo id)', () => {
    const TEMPLATES = [
      { id: 'tp1', name: 'Đơn tháng', items: [{ variationId: 'v1', quantity: 2 }] },
      { id: 'tp2', name: 'Đơn tuần', items: [{ variationId: 'v1', quantity: 1 }] },
    ];
    const xoa = async (count = 1) => {
      renderPage();
      await screen.findByRole('button', { name: /Đơn tháng/ });
      const all = screen.getAllByRole('button', { name: 'Xoá mẫu đơn' });
      expect(all).toHaveLength(count);
      return all;
    };

    it('chạm đúp "Xoá mẫu đơn" chỉ xoá một lần; nút đang xoá aria-busy, và tải lại danh sách một lần', async () => {
      const d = deferred();
      mocks.getTemplates.mockResolvedValue([TEMPLATES[0]]);
      mocks.deleteTemplate.mockReturnValueOnce(d.promise);
      const [del] = await xoa();
      await act(async () => {
        fireEvent.click(del!);
        fireEvent.click(del!);
      });
      expect(mocks.deleteTemplate).toHaveBeenCalledTimes(1);
      expect(mocks.deleteTemplate).toHaveBeenCalledWith('tp1');
      await waitFor(() => expect(del).toHaveAttribute('aria-busy', 'true'));
      expect(del).toHaveAttribute('aria-disabled', 'true');
      await act(async () => d.resolve({ ok: true }));
      await waitFor(() => expect(mocks.getTemplates).toHaveBeenCalledTimes(2));
      expect(mocks.deleteTemplate).toHaveBeenCalledTimes(1);
    });

    it('hai mẫu khác nhau trong một khung hình: cả hai cùng được xoá', async () => {
      const a = deferred();
      const b = deferred();
      mocks.getTemplates.mockResolvedValue(TEMPLATES);
      mocks.deleteTemplate.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
      const [delA, delB] = await xoa(2);
      await act(async () => {
        fireEvent.click(delA!);
        fireEvent.click(delB!);
        fireEvent.click(delA!);
      });
      expect(mocks.deleteTemplate.mock.calls.map((c) => c[0])).toEqual(['tp1', 'tp2']);
      await act(async () => {
        a.resolve({ ok: true });
        b.resolve({ ok: true });
      });
      await waitFor(() => expect(mocks.getTemplates).toHaveBeenCalledTimes(3));
    });

    it('lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
      mocks.getTemplates.mockResolvedValue([TEMPLATES[0]]);
      mocks.deleteTemplate.mockRejectedValueOnce(new Error('Mẫu đã bị xoá')).mockResolvedValue({ ok: true });
      const [del] = await xoa();
      await act(async () => {
        fireEvent.click(del!);
        fireEvent.click(del!);
      });
      expect(mocks.deleteTemplate).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await waitFor(() => expect(del).not.toHaveAttribute('aria-busy'));
      fireEvent.click(del!);
      await waitFor(() => expect(mocks.deleteTemplate).toHaveBeenCalledTimes(2));
    });
  });

  describe('yêu cầu nhận thưởng (claimMut, khoá theo phần thưởng + kỳ)', () => {
    const reward = (id: string, title: string) => ({
      id, type: 'TOUR', title, description: null, threshold: 100_000_000, period: 'QUARTER',
      periodKey: 'Q3/2026', periodLabel: 'Quý 3/2026', isCurrentPeriod: true, volume: 120_000_000, pendingVolume: 0,
      achieved: true, toGo: 0, claimStatus: null, claimId: null, rejectionReason: null, claimDeadline: '2026-10-30T17:00:00.000Z',
      canClaim: true,
    });
    const CLAIMED = { message: 'Đã ghi nhận yêu cầu.', alreadyClaimed: false, claimStatus: 'PENDING', claim: { id: 'c1' } };
    const openRewards = async (titles: string[]) => {
      mocks.getQuarterlyReport.mockResolvedValue({
        quarter: 'Q3/2026', periodStart: '', periodEnd: '', revenue: 120_000_000, orderCount: 14,
        pendingRevenue: 0, pendingOrderCount: 0, bonusPct: 2, bonusAmount: 2_400_000, nextTier: null,
        tiers: [{ min: 100_000_000, pct: 2 }],
      });
      mocks.getDealerRewards.mockResolvedValue({ claimGraceDays: 30, rewards: titles.map((t, i) => reward(`rw${i + 1}`, t)) });
      renderPage();
      await screen.findByText('Bạc');
      openTab('Báo cáo');
      await screen.findByText('Phần thưởng đại lý');
      await waitFor(() => expect(screen.getAllByRole('button', { name: 'Yêu cầu nhận thưởng' })).toHaveLength(titles.length));
      return screen.getAllByRole('button', { name: 'Yêu cầu nhận thưởng' });
    };

    it('chạm đúp "Yêu cầu nhận thưởng" chỉ gửi một yêu cầu; nút dòng đó aria-busy không disabled, dòng kia disabled', async () => {
      const d = deferred();
      mocks.claimDealerReward.mockReturnValueOnce(d.promise);
      const [a, b] = await openRewards(['Tour Đà Nẵng', 'Quà quý']);
      await act(async () => {
        fireEvent.click(a!);
        fireEvent.click(a!);
      });
      expect(mocks.claimDealerReward).toHaveBeenCalledTimes(1);
      expect(mocks.claimDealerReward).toHaveBeenCalledWith('rw1', 'Q3/2026');
      await waitFor(() => expect(a).toHaveAttribute('aria-busy', 'true'));
      expect(a).not.toBeDisabled();
      await waitFor(() => expect(b).toBeDisabled());
      await act(async () => d.resolve(CLAIMED));
      await waitFor(() => expect(snackbarWith('Đã ghi nhận yêu cầu.')).toBe(1));
      expect(mocks.claimDealerReward).toHaveBeenCalledTimes(1);
    });

    it('hai phần thưởng khác nhau trong một khung hình: cả hai yêu cầu cùng được gửi', async () => {
      const x = deferred();
      const y = deferred();
      mocks.claimDealerReward.mockReturnValueOnce(x.promise).mockReturnValueOnce(y.promise);
      const [a, b] = await openRewards(['Tour Đà Nẵng', 'Quà quý']);
      await act(async () => {
        fireEvent.click(a!);
        fireEvent.click(b!);
        fireEvent.click(b!);
      });
      expect(mocks.claimDealerReward.mock.calls).toEqual([['rw1', 'Q3/2026'], ['rw2', 'Q3/2026']]);
      await act(async () => {
        x.resolve(CLAIMED);
        y.resolve(CLAIMED);
      });
      await waitFor(() => expect(snackbarWith('Đã ghi nhận yêu cầu.')).toBe(2));
    });

    it('lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
      mocks.claimDealerReward.mockRejectedValueOnce(new Error('Hết hạn nhận')).mockResolvedValue(CLAIMED);
      const [a] = await openRewards(['Tour Đà Nẵng']);
      await act(async () => {
        fireEvent.click(a!);
        fireEvent.click(a!);
      });
      expect(mocks.claimDealerReward).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await waitFor(() => expect(a).not.toHaveAttribute('aria-busy'));
      fireEvent.click(a!);
      await waitFor(() => expect(mocks.claimDealerReward).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(snackbarWith('Đã ghi nhận yêu cầu.')).toBe(1));
    });
  });
});

// W111A: lệnh ghi bị máy chủ từ chối vì màn đã cũ (400/404/409) thì nút giữ khoá tới khi dữ liệu làm mới về (tối đa LOCK_REFRESH_WAIT_MS), kẻo bấm lại trên số cũ nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: không tải lại, nhả ngay.
describe('DealerPage — máy chủ từ chối thì giữ khoá tới khi dữ liệu làm mới về (W111A)', () => {
  type Refresh = () => Promise<unknown>;
  type Opened = { invalidate: MockInstance<QueryClient['invalidateQueries']>; button: () => HTMLElement };
  type Case = {
    name: string;
    /** Lệnh ghi bị giả lập. */
    write: ReturnType<typeof vi.fn>;
    /** Khoá tải lại kỳ vọng khi máy chủ từ chối, đúng thứ tự gọi. */
    keys: string[][];
    /** Giá trị lệnh ghi trả ở lần bấm lại sau khi nhả khoá. */
    succeed: unknown;
    /** Vị trí đối số Idempotency-Key của lệnh ghi (nếu có): bấm lại sau lỗi từ chối phải giữ nguyên. */
    keyArg?: number;
    open: (refresh: Refresh) => Promise<Opened>;
  };

  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  // TanStack báo cache qua setTimeout(0): đợi một nhịp để `isPending` kịp về false sau khi lệnh xong.
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  /** Dựng trang và thay `invalidateQueries` để soi khoá tải lại và giữ lời hứa tải lại trong tay. */
  const renderLive = (refresh: Refresh) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(<QueryClientProvider client={qc}><DealerPage /></QueryClientProvider>);
    return invalidate;
  };
  const ORDER_OK = { code: 'TUBU7', status: 'CONFIRMED', paymentMethod: 'COD', items: [{ backorderedQty: 0, quantity: 1 }] };
  const TEMPLATE = { id: 'tp1', name: 'Đơn tháng', items: [{ variationId: 'v1', quantity: 2 }] };
  const reward = {
    id: 'rw1', type: 'TOUR', title: 'Tour Đà Nẵng', description: null, threshold: 100_000_000, period: 'QUARTER',
    periodKey: 'Q3/2026', periodLabel: 'Quý 3/2026', isCurrentPeriod: true, volume: 120_000_000, pendingVolume: 0,
    achieved: true, toGo: 0, claimStatus: null, claimId: null, rejectionReason: null, claimDeadline: '2026-10-30T17:00:00.000Z',
    canClaim: true,
  };

  const CASES: Case[] = [
    {
      name: 'đặt đơn sỉ (place)',
      write: mocks.placeDealerOrder,
      keys: [['dealer-orders'], ['dealer-me'], ['dealer-credit'], ['dealer-rewards'], ['dealer-report'], ['dealer-pricelist']],
      succeed: ORDER_OK,
      keyArg: 3,
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        await screen.findByText(/tồn 9/);
        fireEvent.click(plus());
        await screen.findByRole('button', { name: 'Ghi công nợ' });
        return { invalidate, button: () => screen.getByRole('button', { name: 'Ghi công nợ' }) };
      },
    },
    {
      name: 'báo đã chuyển khoản (pay)',
      write: mocks.payCredit,
      keys: [['dealer-credit'], ['dealer-me']],
      succeed: { message: 'Đã báo cho Tubu.' },
      keyArg: 1,
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        await screen.findByText('Bạc');
        openTab('Công nợ');
        fireEvent.change(await screen.findByLabelText('Số tiền đã chuyển'), { target: { value: '1000000' } });
        return { invalidate, button: () => screen.getByRole('button', { name: 'Báo đã chuyển khoản' }) };
      },
    },
    {
      name: 'lưu mẫu đơn (saveTpl)',
      write: mocks.saveTemplate,
      keys: [['dealer-templates']],
      succeed: { id: 'tp1' },
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        await screen.findByText(/tồn 9/);
        fireEvent.click(plus());
        fireEvent.click(await screen.findByRole('button', { name: 'Lưu mẫu' }));
        fireEvent.change(await screen.findByPlaceholderText('Tên mẫu (vd Đơn tháng)'), { target: { value: 'Đơn tháng' } });
        return { invalidate, button: () => within(screen.getByTestId('sheet')).getByRole('button', { name: 'Lưu mẫu' }) };
      },
    },
    {
      name: 'xoá mẫu đơn (delTpl)',
      write: mocks.deleteTemplate,
      keys: [['dealer-templates']],
      succeed: { ok: true },
      open: async (refresh) => {
        mocks.getTemplates.mockResolvedValue([TEMPLATE]);
        const invalidate = renderLive(refresh);
        await screen.findByRole('button', { name: /Đơn tháng/ });
        return { invalidate, button: () => screen.getByRole('button', { name: 'Xoá mẫu đơn' }) };
      },
    },
    {
      name: 'yêu cầu nhận thưởng (claimMut)',
      write: mocks.claimDealerReward,
      keys: [['dealer-rewards']],
      succeed: { message: 'Đã ghi nhận yêu cầu.', alreadyClaimed: false, claimStatus: 'PENDING', claim: { id: 'c1' } },
      open: async (refresh) => {
        mocks.getQuarterlyReport.mockResolvedValue({
          quarter: 'Q3/2026', periodStart: '', periodEnd: '', revenue: 120_000_000, orderCount: 14,
          pendingRevenue: 0, pendingOrderCount: 0, bonusPct: 2, bonusAmount: 2_400_000, nextTier: null,
          tiers: [{ min: 100_000_000, pct: 2 }],
        });
        mocks.getDealerRewards.mockResolvedValue({ claimGraceDays: 30, rewards: [reward] });
        const invalidate = renderLive(refresh);
        await screen.findByText('Bạc');
        openTab('Báo cáo');
        await screen.findByText('Phần thưởng đại lý');
        await screen.findByRole('button', { name: 'Yêu cầu nhận thưởng' });
        return { invalidate, button: () => screen.getByRole('button', { name: 'Yêu cầu nhận thưởng' }) };
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [mocks.placeDealerOrder, mocks.payCredit, mocks.saveTemplate, mocks.deleteTemplate, mocks.claimDealerReward]) fn.mockReset();
    mocks.getDealerMe.mockResolvedValue(APPROVED_ME);
    mocks.getPricelist.mockResolvedValue([row({ stock: 9 })]);
    mocks.getTemplates.mockResolvedValue([]);
    mocks.getDealerOrders.mockResolvedValue([]);
    mocks.getCreditLedger.mockResolvedValue({ balance: 3_000_000, entries: [] });
  });

  describe.each(CASES)('$name', (c) => {
    it.each([
      [400, 'Việc này đã được xử lý rồi'],
      [404, 'Không tìm thấy nữa'],
      [409, 'Vừa có thay đổi, bạn thử lại nhé'],
    ])('bị từ chối %i: báo lỗi một lần, tải lại đúng khoá, nút giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
      c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(c.succeed);
      const refresh = deferred();
      const { invalidate, button } = await c.open(() => refresh.promise);
      fireEvent.click(button());
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
      expect(errorSnackbars()).toBe(1);
      expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual(c.keys.map((queryKey) => ({ queryKey })));
      // Đã có lời báo lỗi mà dữ liệu chưa về: nút vẫn bận, chạm thêm không gửi lần hai.
      expect(button()).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        fireEvent.click(button());
        fireEvent.click(button());
      });
      expect(c.write).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      expect(errorSnackbars()).toBe(1);
      fireEvent.click(button());
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      if (c.keyArg !== undefined) expect(c.write.mock.calls[1]![c.keyArg]).toBe(c.write.mock.calls[0]![c.keyArg]);
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK'), true],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED'), true],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503), true],
      ['hết phiên 401', serverError('Unauthorized', 401), false],
    ])('%s: không giữ khoá chờ tải lại, khoá nhả ngay', async (_label, error, outcomeUnknown) => {
      c.write.mockRejectedValueOnce(error).mockResolvedValue(c.succeed);
      const { invalidate, button } = await c.open(() => new Promise(() => undefined));
      fireEvent.click(button());
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      // Nhận thưởng: quá hạn/5xx máy chủ có thể đã ghi nhận, nên làm mới nền đúng một lần (không giữ khoá). Các lệnh khác không tải lại.
      if (c.name.includes('claimMut') && outcomeUnknown) {
        expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['dealer-rewards'] }]);
      } else {
        expect(invalidate).not.toHaveBeenCalled();
      }
      fireEvent.click(button());
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      if (c.keyArg !== undefined) expect(c.write.mock.calls[1]![c.keyArg]).toBe(c.write.mock.calls[0]![c.keyArg]);
    });

    it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      c.write.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue(c.succeed);
      const { button } = await c.open(() => new Promise(() => undefined));
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        fireEvent.click(button());
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
        });
        expect(button()).toHaveAttribute('aria-busy', 'true');
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
        await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      } finally {
        vi.useRealTimers();
      }
      fireEvent.click(button());
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });
  });
});

// W116A: lệnh lưu mẫu báo xong muộn không đóng tấm "Lưu mẫu đơn" mà khách đã đóng rồi MỞ LẠI (tên mẫu nằm ở trang, sống qua lần đóng) và đang gõ tên khác, cũng không xoá tên đó; toast, tải lại danh sách mẫu, nhả khoá vẫn chạy.
describe('DealerPage — tấm Lưu mẫu đơn mở lại lúc lệnh cũ còn bay (W116A)', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const snackbarWith = (text: string) => mocks.openSnackbar.mock.calls.filter((c) => c[0].text === text).length;
  const nameInput = () => within(screen.getByTestId('sheet')).getByPlaceholderText('Tên mẫu (vd Đơn tháng)') as HTMLInputElement;
  const saveButton = () => within(screen.getByTestId('sheet')).getByRole('button', { name: 'Lưu mẫu' });
  const openSheet = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu mẫu' }));
    await screen.findByTestId('sheet');
  };
  const closeSheet = async () => {
    fireEvent.click(within(screen.getByTestId('sheet')).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByTestId('sheet')).toBeNull());
  };
  /** Lưu mẫu "Đơn tháng", đóng tấm khi lệnh còn bay. */
  const sendAndClose = async () => {
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    await openSheet();
    fireEvent.change(nameInput(), { target: { value: 'Đơn tháng' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await closeSheet();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [mocks.placeDealerOrder, mocks.payCredit, mocks.saveTemplate, mocks.deleteTemplate, mocks.claimDealerReward]) fn.mockReset();
    mocks.getDealerMe.mockResolvedValue(APPROVED_ME);
    mocks.getPricelist.mockResolvedValue([row({ stock: 9 })]);
    mocks.getTemplates.mockResolvedValue([]);
    mocks.getDealerOrders.mockResolvedValue([]);
    mocks.getCreditLedger.mockResolvedValue({ balance: 3_000_000, entries: [] });
  });

  it('báo xong sau khi khách đóng rồi mở lại tấm và gõ tên khác: tấm mới vẫn mở, tên đang gõ còn nguyên, toast + tải lại danh sách mẫu vẫn chạy, khoá nhả', async () => {
    const d = deferred();
    mocks.saveTemplate.mockReturnValueOnce(d.promise);
    await sendAndClose();
    await openSheet();
    fireEvent.change(nameInput(), { target: { value: 'Mẫu mới đang gõ' } });
    expect(mocks.getTemplates).toHaveBeenCalledTimes(1);

    await act(async () => d.resolve({ id: 'tp1' }));
    await waitFor(() => expect(snackbarWith('Đã lưu mẫu đơn.')).toBe(1));
    await waitFor(() => expect(mocks.getTemplates).toHaveBeenCalledTimes(2));
    await settle();
    expect(screen.getByTestId('sheet')).toBeInTheDocument();
    expect(nameInput().value).toBe('Mẫu mới đang gõ');
    await waitFor(() => expect(saveButton()).not.toHaveAttribute('aria-busy'));
    expect(mocks.saveTemplate).toHaveBeenCalledTimes(1);
  });

  it('đối chứng: khách đóng tấm mà không mở lại, lệnh báo xong thì tên mẫu được xoá như cũ', async () => {
    const d = deferred();
    mocks.saveTemplate.mockReturnValueOnce(d.promise);
    await sendAndClose();
    await act(async () => d.resolve({ id: 'tp1' }));
    await waitFor(() => expect(snackbarWith('Đã lưu mẫu đơn.')).toBe(1));
    await openSheet();
    expect(nameInput().value).toBe('');
  });

  it('đối chứng: khách để tấm mở, lệnh báo xong thì tấm đóng và tên mẫu được xoá như cũ', async () => {
    const d = deferred();
    mocks.saveTemplate.mockReturnValueOnce(d.promise);
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    await openSheet();
    fireEvent.change(nameInput(), { target: { value: 'Đơn tháng' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await act(async () => d.resolve({ id: 'tp1' }));
    await waitFor(() => expect(screen.queryByTestId('sheet')).toBeNull());
    await openSheet();
    expect(nameInput().value).toBe('');
  });
});
