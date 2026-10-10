import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { preorderQty, realDiscountPct, DEALER_MAX_QTY } from './dealer-pricing';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getDealerMe: vi.fn(),
  getPricelist: vi.fn(),
  placeDealerOrder: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div data-testid="sheet">{children}</div> : null,
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/dealer-api', () => ({
  getDealerMe: mocks.getDealerMe,
  applyDealer: vi.fn(),
  getPricelist: mocks.getPricelist,
  placeDealerOrder: mocks.placeDealerOrder,
  getDealerOrders: vi.fn().mockResolvedValue([]),
  getCreditLedger: vi.fn(),
  payCredit: vi.fn(),
  getQuarterlyReport: vi.fn(),
  getDealerRewards: vi.fn(),
  claimDealerReward: vi.fn(),
  rewardClaimView: vi.fn(),
  getTemplates: vi.fn().mockResolvedValue([]),
  saveTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
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

  it('thanh tổng nhắc phần thiếu giao khi hàng về và giữ giá hôm nay', async () => {
    mocks.getPricelist.mockResolvedValue([row({ stock: 0 })]);
    renderPage();
    await screen.findByText(/Hết hàng — được đặt trước/);
    fireEvent.click(plus());
    expect(await screen.findByText(/1 mặt hàng đặt vượt tồn/)).toBeInTheDocument();
    expect(screen.getByText(/giữ giá hôm nay/)).toBeInTheDocument();
  });

  it('đặt đơn có phần đặt trước: thông báo rõ phần đặt trước giao khi hàng về', async () => {
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
        expect.objectContaining({ text: 'Đã tạo đơn đại lý — phần đặt trước sẽ giao khi hàng về.' }),
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
