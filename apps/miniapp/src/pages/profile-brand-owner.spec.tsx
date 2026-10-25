import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HttpError } from '../services/http';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), getOwnedBrand: vi.fn(), getOwnsBrand: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Avatar: () => <span />,
  useNavigate: () => vi.fn(),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/account-api', () => ({
  getLoyalty: vi.fn().mockResolvedValue({ pointsBalance: 1, pointsConvertedBalance: 0, tier: { name: 'Mầm Xanh' } }),
  getNotifications: vi.fn().mockResolvedValue([]),
  getWallet: vi.fn().mockResolvedValue({ walletBalance: 0 }),
  getCoupons: vi.fn().mockResolvedValue([]),
  getReferral: vi.fn().mockResolvedValue({ referralCode: 'LAN1', minOrderAmount: 200000, windowDays: 30 }),
}));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicConfig: vi.fn().mockResolvedValue({}),
  fetchOrders: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 1, total: 0 } }),
}));
vi.mock('../services/subscriptions-api', () => ({ getSubscriptions: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/brand-owner-api', () => ({ getOwnedBrand: mocks.getOwnedBrand, getOwnsBrand: mocks.getOwnsBrand }));
vi.mock('../services/dealer-api', () => ({ getDealerMe: vi.fn().mockResolvedValue({ isDealer: false, status: null }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/clipboard', () => ({ copyText: vi.fn() }));
vi.mock('../store/auth', () => {
  const state = () => ({
    status: 'authenticated',
    error: null,
    user: { fullName: 'Lan', role: 'CUSTOMER', referralCode: 'LAN1', pointsBalance: 1, walletBalance: 0, avatarUrl: null, phone: '0901234567', zaloId: 'z1' },
    logout: vi.fn(),
    restore: vi.fn(),
    ensurePhone: vi.fn(),
  });
  const useAuthStore = Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), {
    getState: () => state(),
  });
  return { useAuthStore };
});

import ProfilePage from './profile';

function http404() {
  return new HttpError('Request failed with status code 404', 'ERR_BAD_REQUEST', {
    status: 404,
    data: {},
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProfilePage />
    </QueryClientProvider>,
  );
  return qc;
}

describe('Hub Cá nhân: hỏi chủ nhãn (R6-BUYER-16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwnsBrand.mockResolvedValue(null);
  });

  it('API trả 404 (không sở hữu nhãn) là trạng thái bình thường: không lỗi trong cache, không toast, không có mục quản lý nhãn', async () => {
    mocks.getOwnedBrand.mockRejectedValue(http404());
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const qc = renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    await waitFor(() => expect(mocks.getOwnedBrand).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(qc.getQueryCache().getAll().some((q) => q.queryKey[0] === 'owned-brand' && q.state.status === 'success')).toBe(true));
    expect(qc.getQueryCache().getAll().filter((q) => q.state.status === 'error')).toEqual([]);
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(screen.queryByText('Quản lý nhãn hàng')).toBeNull();
    consoleError.mockRestore();
  });

  it('chủ nhãn thật vẫn thấy mục "Quản lý nhãn hàng"', async () => {
    mocks.getOwnedBrand.mockResolvedValue({ id: 'b1', name: 'Tubu Home' });
    renderPage();
    expect(await screen.findByText('Quản lý nhãn hàng')).toBeInTheDocument();
  });

  it('lỗi khác 404 (mạng, 500) không bị nuốt thành "không phải chủ nhãn"', async () => {
    mocks.getOwnedBrand.mockRejectedValue(new Error('mạng lỗi'));
    const qc = renderPage();
    await waitFor(() => expect(qc.getQueryCache().getAll().some((q) => q.queryKey[0] === 'owned-brand' && q.state.status === 'error')).toBe(true));
  });

  it('/auth/me báo ownsBrand=false: không gọi /brand/owner/me, không có mục quản lý nhãn', async () => {
    mocks.getOwnsBrand.mockResolvedValue(false);
    renderPage();
    await screen.findByText('Câu chuyện thương hiệu');
    await waitFor(() => expect(mocks.getOwnsBrand).toHaveBeenCalledTimes(1));
    expect(mocks.getOwnedBrand).not.toHaveBeenCalled();
    expect(screen.queryByText('Quản lý nhãn hàng')).toBeNull();
  });

  it('/auth/me báo ownsBrand=true: gọi /brand/owner/me và hiện mục quản lý nhãn', async () => {
    mocks.getOwnsBrand.mockResolvedValue(true);
    mocks.getOwnedBrand.mockResolvedValue({ id: 'b1', name: 'Tubu Home' });
    renderPage();
    expect(await screen.findByText('Quản lý nhãn hàng')).toBeInTheDocument();
  });

  it('/auth/me lỗi: giữ cách cũ (vẫn hỏi /brand/owner/me)', async () => {
    mocks.getOwnsBrand.mockRejectedValue(new Error('mạng'));
    mocks.getOwnedBrand.mockResolvedValue({ id: 'b1', name: 'Tubu Home' });
    renderPage();
    expect(await screen.findByText('Quản lý nhãn hàng')).toBeInTheDocument();
  });

  it('cờ ownsBrand đổi true → false thì mục quản lý nhãn biến mất dù ownedBrand còn data cũ', async () => {
    mocks.getOwnsBrand.mockResolvedValue(true);
    mocks.getOwnedBrand.mockResolvedValue({ id: 'b1', name: 'Tubu Home' });
    const qc = renderPage();
    expect(await screen.findByText('Quản lý nhãn hàng')).toBeInTheDocument();
    mocks.getOwnsBrand.mockResolvedValue(false);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['auth-me'] });
    });
    await waitFor(() => expect(screen.queryByText('Quản lý nhãn hàng')).toBeNull());
  });
});
