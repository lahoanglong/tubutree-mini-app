import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), getSubscriptions: vi.fn(), setSubscriptionStatus: vi.fn(), skipSubscriptionCycle: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/subscriptions-api', () => ({
  getSubscriptions: mocks.getSubscriptions,
  setSubscriptionStatus: mocks.setSubscriptionStatus,
  skipSubscriptionCycle: mocks.skipSubscriptionCycle,
}));
vi.mock('../services/shop-api', () => ({ getPublicConfig: vi.fn().mockResolvedValue({ subscribeDiscountPct: 0.12 }) }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { SubscriptionsPanel } from './subscriptions-panel';

const SUB = {
  id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE' as const, nextRunAt: '2026-10-15T00:00:00.000Z',
  productName: 'Nước xả vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nxv', unitPrice: 80000, effectiveDiscountPct: 0.14,
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SubscriptionsPanel /></QueryClientProvider>);
}

describe('SubscriptionsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('liệt kê lịch: tên, chu kỳ + tiền, trạng thái, % giảm đang áp', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    renderPanel();
    expect(await screen.findByText('Nước xả vải Tubu')).toBeInTheDocument();
    expect(screen.getByText('Mỗi 4 tuần · 160.000đ')).toBeInTheDocument();
    expect(screen.getByText('Đang chạy')).toBeInTheDocument();
    expect(screen.getByText('Đang giảm 14% cho đơn định kỳ')).toBeInTheDocument();
  });

  it('"Tạm dừng" gọi đổi trạng thái PAUSED', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    mocks.setSubscriptionStatus.mockResolvedValue({ ...SUB, status: 'PAUSED' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạm dừng' }));
    await waitFor(() => expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'PAUSED'));
  });

  it('"Hủy" mở sheet giữ chân; "Bỏ qua kỳ này" gọi skip; "Vẫn hủy" gọi CANCELLED', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    mocks.skipSubscriptionCycle.mockResolvedValue(SUB);
    mocks.setSubscriptionStatus.mockResolvedValue({ ...SUB, status: 'CANCELLED' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy' }));
    expect(await screen.findByText('Giữ lại lịch định kỳ?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua kỳ này' }));
    await waitFor(() => expect(mocks.skipSubscriptionCycle).toHaveBeenCalledWith('s1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Vẫn hủy' }));
    await waitFor(() => expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'CANCELLED'));
  });

  it('lịch đang tạm dừng: hiện "Đang tạm dừng", "Tiếp tục" gọi đổi trạng thái ACTIVE', async () => {
    const paused = { ...SUB, status: 'PAUSED' as const };
    mocks.getSubscriptions.mockResolvedValue([paused]);
    mocks.setSubscriptionStatus.mockResolvedValue({ ...paused, status: 'ACTIVE' });
    renderPanel();
    expect(await screen.findByText('Đang tạm dừng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    await waitFor(() => expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'ACTIVE'));
  });

  it('lỗi tải → ErrorState, "Thử lại" gọi lại danh sách', async () => {
    mocks.getSubscriptions.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([SUB]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /thử lại/i }));
    expect(await screen.findByText('Nước xả vải Tubu')).toBeInTheDocument();
    expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('chưa có lịch → EmptyState, CTA sang /browse', async () => {
    mocks.getSubscriptions.mockResolvedValue([]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Khám phá sản phẩm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('không dùng biến CSS cũ', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    const { container } = renderPanel();
    await screen.findByText('Nước xả vải Tubu');
    expect(container.innerHTML).not.toMatch(/--(neutral|leaf|primary|clay)-/);
  });
});
