import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  coreGet: vi.fn(),
  getLoyalty: vi.fn(),
  getWallet: vi.fn(),
  getCoupons: vi.fn(),
  getReferral: vi.fn(),
  getDealerMe: vi.fn(),
  getFlags: vi.fn(),
  getOwned: vi.fn(),
  getDesk: vi.fn(),
  getAffiliateMe: vi.fn(),
  chat: vi.fn(),
  role: 'CUSTOMER',
  search: '',
}));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicConfig: vi.fn(async () => ({})),
}));
vi.mock('../services/core-http', () => ({
  coreHttp: {
    get: (path: string) => {
      mocks.coreGet(path);
      return Promise.resolve({ orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: 0 }, unreadNotifications: 0, activeSubscriptions: 0 });
    },
  },
}));
vi.mock('../services/waste-api', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), getDeskPoints: mocks.getDesk }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Avatar: () => <span />,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ search: mocks.search }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/support-chat-api', () => ({ supportChatSummaryQueryOptions: () => ({ queryKey: ['support-chat-summary'], queryFn: mocks.chat }) }));
vi.mock('../services/account-api', () => ({ getLoyalty: mocks.getLoyalty, getWallet: mocks.getWallet, getCoupons: mocks.getCoupons, getReferral: mocks.getReferral }));
vi.mock('../services/brand-owner-api', () => ({ getOwnedBrand: mocks.getOwned, getAuthMeFlags: mocks.getFlags }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: mocks.getAffiliateMe }));
vi.mock('../services/dealer-api', () => ({ getDealerMe: mocks.getDealerMe }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../store/auth', () => {
  const state = () => ({
    status: 'authenticated',
    error: null,
    user: { fullName: 'Lan', role: mocks.role, referralCode: 'LAN1', pointsBalance: 100, walletBalance: 40000, avatarUrl: null, phone: '0901234567', zaloId: 'z1' },
    logout: vi.fn(),
    restore: vi.fn(),
  });
  const useAuthStore = Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: () => ({ ...state(), login: vi.fn() }) });
  return { useAuthStore };
});

import ProfilePage from './profile';

type Entry = { isIntersecting: boolean; target: Element };
const observers: { cb: (e: Entry[]) => void; targets: Element[] }[] = [];
class FakeIO {
  private rec: { cb: (e: Entry[]) => void; targets: Element[] };
  constructor(cb: (e: Entry[]) => void) {
    this.rec = { cb, targets: [] };
    observers.push(this.rec);
  }
  observe = (el: Element) => void this.rec.targets.push(el);
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const requests = () =>
  mocks.coreGet.mock.calls.length + [mocks.getLoyalty, mocks.getWallet, mocks.getCoupons, mocks.getReferral, mocks.getDealerMe, mocks.getFlags, mocks.getOwned, mocks.getDesk, mocks.getAffiliateMe, mocks.chat].reduce((n, f) => n + f.mock.calls.length, 0);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProfilePage /></QueryClientProvider>);
}

describe('Cá nhân: query khối dưới màn đầu chỉ chạy khi sắp vào khung nhìn (F8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observers.length = 0;
    vi.stubGlobal('IntersectionObserver', FakeIO);
    mocks.role = 'CUSTOMER';
    mocks.search = '';
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 1, pointsConvertedBalance: 0, tier: { name: 'Mầm Xanh' } });
    mocks.getWallet.mockResolvedValue({ walletBalance: 1 });
    mocks.getCoupons.mockResolvedValue([]);
    mocks.getReferral.mockResolvedValue({ referralCode: 'LAN1', successCount: 0, earnedPoints: 0, minOrderAmount: 0, windowDays: 30 });
    mocks.getDealerMe.mockResolvedValue({ isDealer: false, status: null });
    mocks.getFlags.mockResolvedValue({ ownsBrand: null, hasDeskPoint: false });
    mocks.getOwned.mockResolvedValue(null);
    mocks.getDesk.mockResolvedValue([]);
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: false, canRegister: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('chưa cuộn: tối đa 4 request; cuộn tới thì các query còn lại mới chạy', async () => {
    renderPage();
    await screen.findByText('Mầm Xanh');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(requests()).toBeLessThanOrEqual(4);
    expect(mocks.getReferral).not.toHaveBeenCalled();
    expect(mocks.getDealerMe).not.toHaveBeenCalled();
    await act(async () => {
      for (const o of observers) o.cb(o.targets.map((target) => ({ isIntersecting: true, target })));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(mocks.getReferral).toHaveBeenCalledTimes(1);
    expect(mocks.getDealerMe).toHaveBeenCalledTimes(1);
    expect(mocks.getFlags).toHaveBeenCalledTimes(1);
  });

  it('mở bằng ?section=referral thì mã giới thiệu tải ngay, không đợi cuộn', async () => {
    mocks.search = '?section=referral';
    renderPage();
    await screen.findByText('Mầm Xanh');
    expect(mocks.getReferral).toHaveBeenCalledTimes(1);
  });
});
