import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  shareLink: vi.fn(),
  copyText: vi.fn(),
  getAffiliateMe: vi.fn(),
  registerAffiliate: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div data-testid="sheet">{children}</div> : null,
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }),
}));
vi.mock('../services/zmp-bridge', () => ({ shareLink: mocks.shareLink }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/qr-code', () => ({ QrCode: () => null }));
vi.mock('../components/affiliate/ctv-order-sheet', () => ({
  CtvOrderSheet: () => <div data-testid="ctv-order-sheet" />,
}));
vi.mock('../services/affiliate-api', () => ({
  getAffiliateMe: mocks.getAffiliateMe,
  registerAffiliate: mocks.registerAffiliate,
  getAffiliateDashboard: vi.fn().mockResolvedValue({
    todayCommission: 0, monthCommission: 125_000, pendingCommission: 0, withdrawableCommission: 0,
    totalClicks: 4, totalConversions: 1, monthRevenue: 0,
    tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
  }),
  getAffiliateLinks: vi.fn().mockResolvedValue([]),
  createAffiliateLink: vi.fn(),
  getCommissions: vi.fn().mockResolvedValue([]),
  requestPayout: vi.fn(),
  getStorefrontAnalytics: vi.fn().mockResolvedValue({ storefronts: [] }),
  getProductBreakdown: vi.fn().mockResolvedValue([]),
  getCtvTiers: vi.fn().mockResolvedValue({ allTiers: [] }),
  getCtvMilestones: vi.fn().mockResolvedValue({ milestones: [], previousMonth: null }),
  claimCtvMilestone: vi.fn(),
}));
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({ affiliateMinWithdrawBank: 50_000, isLoaded: true }),
}));

import AffiliatePage from './affiliate';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AffiliatePage /></QueryClientProvider>);
}

describe('Dashboard CTV — chia sẻ mã giới thiệu (C-067)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAffiliateMe.mockResolvedValue({ isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 });
    mocks.copyText.mockResolvedValue(true);
  });

  it('shareLink reject: sao chép lời mời kèm liên kết có mã và báo snackbar, không im lặng', async () => {
    mocks.shareLink.mockRejectedValue(new Error('zalo từ chối'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith(expect.stringContaining('/?ref=TUBU88'));
    expect(mocks.copyText).toHaveBeenCalledWith(expect.stringContaining('dùng mã TUBU88'));
    expect((mocks.openSnackbar.mock.calls[0]![0] as { text: string }).text).toMatch(/Chưa chia sẻ được qua Zalo/);
  });

  it('chia sẻ được thì không báo gì thêm', async () => {
    mocks.shareLink.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ' }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    expect(mocks.shareLink.mock.calls[0]![0].path).toBe('/?ref=TUBU88');
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });
});
