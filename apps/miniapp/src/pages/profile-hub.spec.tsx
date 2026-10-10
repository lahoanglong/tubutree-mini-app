import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), openSnackbar: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Avatar: () => <span />,
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/account-api', () => ({
  getLoyalty: vi.fn().mockResolvedValue({ pointsBalance: 120, tier: { name: 'Mầm Xanh' } }),
  getNotifications: vi.fn().mockResolvedValue([]),
  getWallet: vi.fn().mockResolvedValue({ walletBalance: 50000, coinsBalance: 1500 }),
  getCoupons: vi.fn().mockResolvedValue([{ code: 'A' }, { code: 'B' }]),
}));
vi.mock('../services/brand-owner-api', () => ({ getOwnedBrand: vi.fn().mockResolvedValue(null) }));
vi.mock('../services/dealer-api', () => ({ getDealerMe: vi.fn().mockResolvedValue({ isDealer: false, status: null }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../store/auth', () => {
  const state = {
    status: 'authenticated',
    error: null,
    user: { fullName: 'Lan', role: 'CUSTOMER', referralCode: 'LAN1', pointsBalance: 100, walletBalance: 40000, avatarUrl: null },
    logout: vi.fn(),
    restore: vi.fn(),
  };
  const useAuthStore = Object.assign(() => state, { getState: () => ({ ...state, login: vi.fn() }) });
  return { useAuthStore };
});

import ProfilePage from './profile';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProfilePage /></QueryClientProvider>);
}

describe('Thanh số dư ở hub Cá nhân (C-086)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('có đủ Điểm Xanh, Ví Tubu, TubuXu, Mã giảm giá', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /^TubuXu: 1\.500 xu$/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Mã giảm giá: 2 mã$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Điểm Xanh:/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Ví Tubu:/ })).toBeInTheDocument();
  });

  it('không còn mục Hoàn tiền sàn ngoài; bấm mục menu điều hướng thật, không báo "đang hoàn thiện"', async () => {
    renderPage();
    expect(screen.queryByText('Hoàn tiền sàn ngoài')).toBeNull();
    fireEvent.click(await screen.findByText('Câu chuyện thương hiệu'));
    expect(mocks.navigate).toHaveBeenCalledWith('/brand-story', undefined);
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });
});
