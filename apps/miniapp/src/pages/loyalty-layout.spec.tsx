import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getLoyalty: vi.fn(),
  getCoupons: vi.fn(),
  getPointsTransactions: vi.fn(),
  getDailyCheckInStatus: vi.fn(),
  getMemberCard: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/loyalty', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', user: { id: 'u1' } };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } }) }));
vi.mock('../services/account-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLoyalty: mocks.getLoyalty,
  getCoupons: mocks.getCoupons,
  getPointsTransactions: mocks.getPointsTransactions,
  getDailyCheckInStatus: mocks.getDailyCheckInStatus,
  getMemberCard: mocks.getMemberCard,
  postDailyCheckIn: vi.fn(),
}));

import LoyaltyPage from './loyalty';

const LOYALTY = {
  pointsBalance: 1_250,
  tierPoints: 1_250,
  tier: { id: 't1', name: 'Mầm Xanh', multiplier: 1, perks: ['Miễn phí vận chuyển đơn từ 300.000đ'] },
  nextTier: { id: 't2', name: 'Lộc Biếc', minPoints: 2_500, pointsToGo: 1_250 },
  tiers: [
    { id: 't1', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 },
    { id: 't2', name: 'Lộc Biếc', minPoints: 2_500, multiplier: 1.2 },
  ],
};
const COUPON = {
  code: 'WELCOME30',
  type: 'AMOUNT' as const,
  value: 30_000,
  minOrder: 199_000,
  maxDiscount: null,
  endAt: new Date(2026, 10, 5, 12).toISOString(),
};
const CHECK_IN = {
  checkedInToday: false,
  streakDays: 2,
  currentCycleDay: 3,
  todayPoints: 3,
  rewards: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, points: day, claimed: day < 3, isToday: day === 3 })),
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LoyaltyPage />
    </QueryClientProvider>,
  );
}

const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('LoyaltyPage — kho mã giảm giá lên đầu trang (C-074)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLoyalty.mockResolvedValue(LOYALTY);
    mocks.getCoupons.mockResolvedValue([COUPON]);
    mocks.getPointsTransactions.mockResolvedValue([
      { id: 'p1', delta: 1_250, reason: 'ORDER', refType: null, expiresAt: null, createdAt: new Date(2026, 9, 5).toISOString() },
      { id: 'p2', delta: -500, reason: 'REDEEM', refType: null, expiresAt: null, createdAt: new Date(2026, 9, 6).toISOString() },
    ]);
    mocks.getDailyCheckInStatus.mockResolvedValue(CHECK_IN);
    mocks.getMemberCard.mockResolvedValue({ memberCode: 'TUBU123', posCreditEnabled: false });
  });

  it('"Mã giảm giá của tôi" nằm ngay dưới thẻ hạng, trước điểm danh, các hạng, Kho quà và lịch sử', async () => {
    renderPage();
    const vouchers = await screen.findByText('Mã giảm giá của tôi');
    const checkIn = await screen.findByText('Điểm danh nhận Điểm Xanh');
    const tiers = await screen.findByText('Các hạng');
    const rewards = await screen.findByText('Kho quà');
    const history = await screen.findByText('Lịch sử Điểm Xanh');
    const tierCard = await screen.findByText('Tích điểm ×1', { exact: false });

    expect(before(tierCard, vouchers)).toBe(true);
    for (const later of [checkIn, tiers, rewards, history]) {
      expect(before(vouchers, later)).toBe(true);
    }
  });

  it('hiện số mã, nhãn giảm giá, điều kiện đơn tối thiểu và hạn dùng dd/MM/yyyy', async () => {
    renderPage();
    await screen.findByText('Mã giảm giá của tôi');
    expect(await screen.findByText('1 mã')).toBeInTheDocument();
    expect(screen.getByText('Giảm 30.000đ')).toBeInTheDocument();
    expect(screen.getByText('Mã WELCOME30 · đơn từ 199.000đ')).toBeInTheDocument();
    expect(screen.getByText('HSD 05/11/2026')).toBeInTheDocument();
  });

  it('chưa có mã → câu trống nói đúng thuật ngữ, chỉ cách có mã', async () => {
    mocks.getCoupons.mockResolvedValue([]);
    renderPage();
    await screen.findByText('Mã giảm giá của tôi');
    expect(await screen.findByText(/Chưa có mã giảm giá/)).toBeInTheDocument();
  });

  it('không tải được mã → báo lỗi + nút thử lại, không giả vờ "chưa có mã"', async () => {
    mocks.getCoupons.mockRejectedValueOnce(new Error('boom'));
    mocks.getCoupons.mockResolvedValue([COUPON]);
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(screen.queryByText(/Chưa có mã giảm giá/)).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText('Giảm 30.000đ')).toBeInTheDocument());
  });
});

describe('LoyaltyPage — thuật ngữ Q-26 và số có dấu nghìn (C-074, C-083)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLoyalty.mockResolvedValue(LOYALTY);
    mocks.getCoupons.mockResolvedValue([COUPON]);
    mocks.getPointsTransactions.mockResolvedValue([
      { id: 'p1', delta: 1_250, reason: 'ORDER', refType: null, expiresAt: null, createdAt: new Date(2026, 9, 5).toISOString() },
      { id: 'p2', delta: -2_500, reason: 'REDEEM', refType: null, expiresAt: null, createdAt: new Date(2026, 9, 6).toISOString() },
    ]);
    mocks.getDailyCheckInStatus.mockResolvedValue(CHECK_IN);
    mocks.getMemberCard.mockResolvedValue({ memberCode: 'TUBU123', posCreditEnabled: false });
  });

  it('không còn chữ "voucher" / "hạt giống" trên trang; điểm danh Vườn nói "giọt nước"', async () => {
    const { container } = renderPage();
    await screen.findByText('Lịch sử Điểm Xanh');
    await screen.findByText('Giảm 30.000đ');
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/voucher/i);
    expect(text).not.toMatch(/hạt giống/i);
    expect(text).toContain('giọt nước');
  });

  it('điểm còn thiếu, ngưỡng hạng và lịch sử điểm đều có dấu phân cách nghìn', async () => {
    renderPage();
    await screen.findByText('Lịch sử Điểm Xanh');
    expect(await screen.findByText('1.250', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText(/từ 2\.500 điểm tích luỹ/)).toBeInTheDocument();
    expect(screen.getByText('+1.250')).toBeInTheDocument();
    expect(screen.getByText('-2.500')).toBeInTheDocument();
  });
});

describe('LoyaltyPage — mã tự cấp hiện tên thân thiện (R6-BUYER-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLoyalty.mockResolvedValue(LOYALTY);
    mocks.getCoupons.mockResolvedValue([{ ...COUPON, code: 'MILESTONE1000000-2026-10-CMV9MLSLB009KFKRUMVZQLRA7' }]);
    mocks.getPointsTransactions.mockResolvedValue([]);
    mocks.getDailyCheckInStatus.mockResolvedValue(CHECK_IN);
    mocks.getMemberCard.mockResolvedValue({ memberCode: 'TUBU123', posCreditEnabled: false });
  });

  it('thẻ ghi "Quà mốc chi tiêu 1 triệu", không hiện mã thô hay id khách', async () => {
    const { container } = renderPage();
    await screen.findByText(/Quà mốc chi tiêu 1 triệu/);
    expect(container.textContent).not.toContain('CMV9MLSLB009');
    expect(container.textContent).not.toContain('MILESTONE');
  });
});

describe('LoyaltyPage — một <h1> mỗi trang (C-114)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLoyalty.mockResolvedValue(LOYALTY);
    mocks.getCoupons.mockResolvedValue([COUPON]);
    mocks.getPointsTransactions.mockResolvedValue([]);
    mocks.getDailyCheckInStatus.mockResolvedValue(CHECK_IN);
    mocks.getMemberCard.mockResolvedValue({ memberCode: 'TUBU123', posCreditEnabled: false });
  });

  it('đúng một h1 nói tên trang, nằm trước thẻ hạng', async () => {
    renderPage();
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Hạng thành viên & Điểm Xanh');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(before(h1, await screen.findByText('Tích điểm ×1', { exact: false }))).toBe(true);
  });

  it('đang tải vẫn có h1 (tiêu đề không chờ dữ liệu)', () => {
    mocks.getLoyalty.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
