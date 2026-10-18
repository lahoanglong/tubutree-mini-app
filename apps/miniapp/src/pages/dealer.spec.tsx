import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
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
  claimDealerReward: vi.fn(),
  getTemplates: mocks.getTemplates,
  saveTemplate: mocks.saveTemplate,
  deleteTemplate: mocks.deleteTemplate,
}));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.config }));
vi.mock('../components/image-upload', () => ({ ImageUpload: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

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
  isDealer: true, status: 'APPROVED', tier: { id: 't1', name: 'Bạc', creditLimit: 50_000_000 }, currentDebt: 1_000_000,
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
    mocks.placeDealerOrder.mockResolvedValue({ code: 'TUBU3', items: [{ backorderedQty: 0, quantity: 1 }] });
    renderPage();
    await screen.findByText(/tồn 9/);
    fireEvent.click(plus());
    fireEvent.click(await screen.findByRole('button', { name: 'Trả trước' }));
    await waitFor(() => expect(mocks.placeDealerOrder).toHaveBeenCalledTimes(1));
    expect(mocks.placeDealerOrder.mock.calls[0]![1]).toBe('PREPAID');
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/bank-payment/TUBU3'));
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
    fireEvent.change(screen.getByPlaceholderText('Tìm theo tên / SKU / thương hiệu'), { target: { value: 'khong-co-san-pham-nay' } });
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

  it('công nợ: Báo đã CK gửi đúng số tiền + ghi chú, chặn số tiền vượt dư nợ, sổ rỗng có trạng thái rỗng', async () => {
    mocks.getCreditLedger.mockResolvedValue({ balance: 3_000_000, entries: [] });
    mocks.payCredit.mockResolvedValue({ ok: true });
    renderPage();
    await screen.findByText('Bạc');
    openTab('Công nợ');
    expect(await screen.findByText('3.000.000đ')).toBeInTheDocument();
    expect(screen.getByText(/Chưa có giao dịch công nợ/)).toBeInTheDocument();
    const amount = screen.getByPlaceholderText('Số tiền đã chuyển');
    const pay = screen.getByRole('button', { name: 'Báo đã CK' });
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
