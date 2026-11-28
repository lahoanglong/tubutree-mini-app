import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getLoyalty: vi.fn(),
  getCoupons: vi.fn(),
  getPointsTransactions: vi.fn(),
  coreGet: vi.fn(),
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
  getDailyCheckInStatus: mocks.getDailyCheckInStatus,
  getMemberCard: mocks.getMemberCard,
  postDailyCheckIn: vi.fn(),
}));
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));

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

beforeEach(() => {
  mocks.coreGet.mockImplementation((path: string, opts?: { query?: Record<string, unknown> }) =>
    path === '/me/points/transactions' ? mocks.getPointsTransactions(opts?.query) : Promise.reject(new Error(`chưa giả ${path}`)),
  );
});

const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('LoyaltyPage — thứ tự khối của trang gọn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, rates: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1_000, maxRedeemPct: 0.2 } });
    mocks.getCoupons.mockResolvedValue([COUPON]);
    mocks.getPointsTransactions.mockResolvedValue([
      { id: 'p1', delta: 1_250, reason: 'ORDER', refType: null, expiresAt: null, createdAt: new Date(2026, 9, 5).toISOString() },
      { id: 'p2', delta: -500, reason: 'REDEEM', refType: null, expiresAt: null, createdAt: new Date(2026, 9, 6).toISOString() },
    ]);
    mocks.getDailyCheckInStatus.mockResolvedValue(CHECK_IN);
    mocks.getMemberCard.mockResolvedValue({ memberCode: 'TUBU123', posCreditEnabled: false });
  });

  it('thẻ hạng → dòng điểm danh → dòng Ưu đãi → mục gập luật → quyền lợi → các hạng → lịch sử', async () => {
    renderPage();
    const order = [
      await screen.findByText('Tích điểm ×1', { exact: false }),
      await screen.findByText('Hôm nay bạn chưa điểm danh'),
      await screen.findByText('Đổi quà & mã giảm giá'),
      await screen.findByRole('button', { name: 'Cách kiếm và dùng Điểm Xanh' }),
      await screen.findByText('Quyền lợi của bạn'),
      await screen.findByText('Các hạng'),
      await screen.findByText('Lịch sử Điểm Xanh'),
    ];
    for (let i = 1; i < order.length; i += 1) expect(before(order[i - 1]!, order[i]!), `khối ${i}`).toBe(true);
  });

  it('trang Hạng không còn liệt kê từng mã (nhãn giảm giá, điều kiện đơn, hạn dùng nằm ở Ưu đãi)', async () => {
    renderPage();
    await screen.findByText('Bạn đang có 1 mã giảm giá');
    expect(screen.queryByText('Mã giảm giá của tôi')).toBeNull();
    expect(screen.queryByText('Giảm 30.000đ')).toBeNull();
    expect(screen.queryByText(/WELCOME30/)).toBeNull();
    expect(screen.queryByText(/HSD/)).toBeNull();
  });

  it('mã còn đang tải: dòng Ưu đãi đã có sẵn và nói chung, để thẻ không đổi khi mã về', async () => {
    mocks.getCoupons.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByText('Các hạng');
    expect(screen.getByText('Đổi quà & mã giảm giá')).toBeInTheDocument();
    expect(screen.getByText('Đổi Điểm Xanh lấy mã giảm giá và quà')).toBeInTheDocument();
  });

  it('không tải được mã: dòng Ưu đãi vẫn còn, không giả vờ "có 0 mã"', async () => {
    mocks.getCoupons.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Đổi Điểm Xanh lấy mã giảm giá và quà')).toBeInTheDocument();
    expect(screen.queryByText(/Bạn đang có/)).toBeNull();
  });
});

describe('LoyaltyPage — thuật ngữ thống nhất và số có dấu nghìn', () => {
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

  it('không còn chữ "voucher" / "hạt giống" trên trang', async () => {
    const { container } = renderPage();
    await screen.findByText('Lịch sử Điểm Xanh');
    await screen.findByText('Bạn đang có 1 mã giảm giá');
    await screen.findByText('Hôm nay bạn chưa điểm danh');
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/voucher/i);
    expect(text).not.toMatch(/hạt giống/i);
  });

  it('điểm còn thiếu, ngưỡng hạng và lịch sử điểm đều có dấu phân cách nghìn', async () => {
    renderPage();
    await screen.findByText('Lịch sử Điểm Xanh');
    expect(await screen.findByText('1.250 điểm', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText(/từ 2\.500 điểm tích luỹ/)).toBeInTheDocument();
    expect(screen.getByText('+1.250')).toBeInTheDocument();
    expect(screen.getByText('-2.500')).toBeInTheDocument();
  });
});

describe('LoyaltyPage — một <h1> mỗi trang', () => {
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
