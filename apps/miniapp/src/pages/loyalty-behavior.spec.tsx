import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Đặc tả hành vi trang Hạng thành viên & Điểm Xanh: nút điểm danh, nút đổi quà, hộp xác nhận, thẻ thành viên,
 * chúc mừng lên hạng. Giữ điều kiện bật/tắt nút, số lần gọi API và con số hiển thị.
 * Chỉ truy vấn theo role/chữ (không theo class/cấu trúc) để đổi giao diện mà test vẫn đứng.
 */
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getLoyalty: vi.fn(),
  getCoupons: vi.fn(),
  getPointsTransactions: vi.fn(),
  coreGet: vi.fn(),
  getDailyCheckInStatus: vi.fn(),
  getMemberCard: vi.fn(),
  postDailyCheckIn: vi.fn(),
  listWasteRequests: vi.fn(),
  copyText: vi.fn(),
  publicConfig: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: false } },
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/loyalty', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
const boost = vi.hoisted(() => ({ cfg: { isLoaded: false } as { isLoaded: boolean; loyalty?: Record<string, unknown> } }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ ...mocks.publicConfig, ...boost.cfg }) }));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', user: { id: 'u1' } };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../components/qr-code', () => ({
  QrCode: ({ value }: { value: string }) => <span data-testid="qr" data-value={value} />,
}));
vi.mock('../services/account-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLoyalty: mocks.getLoyalty,
  getCoupons: mocks.getCoupons,
  getDailyCheckInStatus: mocks.getDailyCheckInStatus,
  getMemberCard: mocks.getMemberCard,
  postDailyCheckIn: mocks.postDailyCheckIn,
}));
// Lịch sử điểm đọc qua app-core + coreHttp (phân trang); mocks.getPointsTransactions nhận query của trang.
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));

vi.mock('../services/waste-api', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), listWasteRequests: mocks.listWasteRequests }));

import LoyaltyPage from './loyalty';

const TIERS = [
  { id: 't1', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 },
  { id: 't2', name: 'Lộc Biếc', minPoints: 2_500, multiplier: 1.2 },
];
const LOYALTY = {
  pointsBalance: 1_250,
  tierPoints: 1_250,
  tier: { id: 't1', name: 'Mầm Xanh', multiplier: 1, perks: ['Miễn phí vận chuyển đơn từ 300.000đ'] },
  nextTier: { id: 't2', name: 'Lộc Biếc', minPoints: 2_500, pointsToGo: 1_250 },
  tiers: TIERS,
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

/** Máy chủ giả: trả đúng trang theo before/beforeId/limit như API thật (dòng đã sắp mới nhất trước). */
function servePointsHistory(rows: { id: string }[]) {
  mocks.getPointsTransactions.mockImplementation(async (q?: { beforeId?: string; limit?: number }) => {
    const start = q?.beforeId ? rows.findIndex((r) => r.id === q.beforeId) + 1 : 0;
    return rows.slice(start, start + (q?.limit ?? 100));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publicConfig.waste.enabled = true;
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  boost.cfg = { isLoaded: false };
  mocks.listWasteRequests.mockResolvedValue([]);
  mocks.getLoyalty.mockResolvedValue(LOYALTY);
  mocks.getCoupons.mockResolvedValue([]);
  mocks.getPointsTransactions.mockResolvedValue([]);
  mocks.coreGet.mockImplementation((path: string, opts?: { query?: Record<string, unknown> }) =>
    path === '/me/points/transactions' ? mocks.getPointsTransactions(opts?.query) : Promise.reject(new Error(`chưa giả ${path}`)),
  );
  mocks.getDailyCheckInStatus.mockResolvedValue(CHECK_IN);
  mocks.getMemberCard.mockResolvedValue({ memberCode: 'TUBU123', posCreditEnabled: false });
  mocks.postDailyCheckIn.mockResolvedValue({
    points: { success: true, cycleDay: 3, streakDays: 3, pointsEarned: 3, totalPoints: 3, message: '' },
    water: { seedsEarned: 10, streakDays: 1, totalSeeds: 10, streakFrozeUsed: false, bonusNote: '' },
    alreadyDone: false,
    pending: [],
  });
  mocks.copyText.mockResolvedValue(true);
});

describe('LoyaltyPage — thẻ hạng', () => {
  it('hiện hạng, hệ số, số dư Điểm Xanh và phần còn lại để lên hạng kế', async () => {
    const { container } = renderPage();
    expect(await screen.findByText('Tích điểm ×1 · 1.250 Điểm Xanh')).toBeInTheDocument();
    expect(screen.getByText(/để lên hạng Lộc Biếc/)).toBeInTheDocument();
    // tierPoints 1.250 / ngưỡng 2.500 → 50%
    expect(container.querySelector('[style*="width: 50%"]')).not.toBeNull();
  });

  it('hệ số hạng viết dấu phẩy kiểu Việt và "Điểm Xanh" viết hoa (D6-06)', async () => {
    mocks.getLoyalty.mockResolvedValue({
      ...LOYALTY,
      pointsBalance: 130_000,
      tier: { id: 't2', name: 'Lộc Biếc', multiplier: 1.2, perks: [] },
      nextTier: null,
    });
    mocks.getPointsTransactions.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/^Tích điểm ×1,2 ·/)).toBeInTheDocument();
    expect(document.body.textContent).toContain('Điểm Xanh');
    expect(document.body.textContent).not.toMatch(/×1\.2/);
    expect(document.body.textContent).not.toMatch(/điểm Xanh/);
    expect(screen.getByText(/· ×1,2$/)).toBeInTheDocument();
  });

  it('không còn tên "Vườn Cây" ở trang Điểm Xanh — một tên Vườn Xanh cho một tính năng (D6-07)', async () => {
    renderPage();
    await screen.findByText('Lịch sử Điểm Xanh');
    await screen.findByText('Hôm nay bạn chưa điểm danh');
    expect(document.body.textContent).not.toContain('Vườn Cây');
    expect(document.body.textContent).toContain('Vườn Xanh');
  });

  it('hạng cao nhất: không có thanh tiến độ, hiện lời chúc', async () => {
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, nextTier: null });
    const { container } = renderPage();
    expect(await screen.findByText(/Bạn đang ở hạng cao nhất/)).toBeInTheDocument();
    expect(container.querySelector('[style*="width: 50%"]')).toBeNull();
  });

  it('chỉ còn hai lối đi: dòng điểm danh → /game, dòng Ưu đãi → /offers?tab=rewards; không còn Vườn Xanh, Đổi rác, Kho quà riêng hay nút mua sắm', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Hôm nay bạn chưa điểm danh/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/game');
    fireEvent.click(screen.getByRole('button', { name: /^Đổi quà & mã giảm giá/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/offers?tab=rewards');
    for (const gone of ['Chăm cây nhận quà', 'Đổi rác lấy quà', 'Yêu cầu đổi rác', 'Kho quà', /Ví mã/, /Mua sắm để tích thêm/]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });
});

describe('LoyaltyPage — một dòng sang hub Ưu đãi', () => {
  const COUPON = { code: 'WELCOME30', type: 'AMOUNT', value: 30_000, minOrder: 199_000, maxDiscount: null, endAt: '2026-12-31T00:00:00.000Z' };

  it('có mã: dòng phụ nêu số mã, bấm mở tab Đổi quà của Ưu đãi; không liệt kê từng mã', async () => {
    mocks.getCoupons.mockResolvedValue([COUPON, { ...COUPON, code: 'FREESHIP1' }]);
    renderPage();
    expect(await screen.findByText('Bạn đang có 2 mã giảm giá')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Đổi quà & mã giảm giá/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/offers?tab=rewards');
    expect(screen.queryByText('Mã giảm giá của tôi')).toBeNull();
    expect(screen.queryByText('Giảm 30.000đ')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Đổi quà & mã giảm giá/ })).toHaveLength(1);
  });

  it('chưa có mã hoặc tải mã lỗi: dòng phụ nói chung', async () => {
    renderPage();
    expect(await screen.findByText('Đổi Điểm Xanh lấy mã giảm giá và quà')).toBeInTheDocument();
    expect(screen.queryByText(/Bạn đang có/)).toBeNull();
  });
});

describe('LoyaltyPage — không còn lối Đổi rác riêng (hub Ưu đãi và Trang chủ đã có)', () => {
  it.each([true, false])('chương trình Đổi rác bật=%s: không có hàng Đổi rác, không hỏi danh sách yêu cầu', async (enabled) => {
    mocks.publicConfig.waste.enabled = enabled;
    mocks.listWasteRequests.mockResolvedValue([{ id: 'r1' }]);
    boost.cfg = { isLoaded: true };
    renderPage();
    await screen.findByText('Lịch sử Điểm Xanh');
    expect(screen.queryByText('Đổi rác lấy quà')).toBeNull();
    expect(screen.queryByText('Yêu cầu đổi rác')).toBeNull();
    expect(mocks.listWasteRequests).not.toHaveBeenCalled();
  });
});

describe('LoyaltyPage — quà đã chuyển sang /rewards', () => {
  it('trang Điểm Xanh không còn danh mục đổi quà', async () => {
    renderPage();
    await screen.findByText('Lịch sử Điểm Xanh');
    expect(screen.queryByText('Đổi Điểm Xanh nhận mã giảm giá')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đổi ngay' })).toBeNull();
  });
});

describe('LoyaltyPage — giải thích cách tích điểm và mốc hạng (ENGAGE-21)', () => {
  const RATES = { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1_000, maxRedeemPct: 0.2 };

  it('luật tích/dùng nằm trong mục gập "Cách kiếm và dùng Điểm Xanh": đóng mặc định, bấm thì mở, bấm lại thì đóng', async () => {
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, rates: RATES });
    renderPage();
    const toggle = await screen.findByRole('button', { name: 'Cách kiếm và dùng Điểm Xanh' });
    const body = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(body).not.toBeVisible();
    expect(toggle.closest('h2')).not.toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(body).toBeVisible();
    expect(screen.getByText('Tích 2% tiền hàng thành Điểm Xanh')).toBeVisible();
    expect(screen.getByText('1 điểm = 1.000đ khi dùng ở bước thanh toán (tối đa 20% giá trị đơn)')).toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(body).not.toBeVisible();
  });

  it('thẻ hạng không còn hai dòng luật (đã dời vào mục gập)', async () => {
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, rates: RATES });
    renderPage();
    const tierLine = await screen.findByText(/^Tích điểm ×1 ·/);
    const body = document.getElementById(screen.getByRole('button', { name: 'Cách kiếm và dùng Điểm Xanh' }).getAttribute('aria-controls')!)!;
    expect(body).toContainElement(screen.getByText('Tích 2% tiền hàng thành Điểm Xanh'));
    expect(tierLine.parentElement).not.toContainElement(screen.getByText('Tích 2% tiền hàng thành Điểm Xanh'));
  });

  it('tỷ lệ cấu hình khác thì chữ đổi theo, không hardcode 2%', async () => {
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, rates: { ...RATES, earnPct: 3, vndPerPoint: 33 } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cách kiếm và dùng Điểm Xanh' }));
    expect(screen.getByText('Tích 3% tiền hàng thành Điểm Xanh')).toBeVisible();
  });

  it('dòng "còn X điểm" kèm số tiền mua hàng tương ứng', async () => {
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, rates: RATES });
    renderPage();
    expect(await screen.findByText(/tương đương khoảng 62\.500đ mua hàng/)).toBeInTheDocument();
  });

  it('danh sách hạng quy mốc ra tiền mua hàng 12 tháng', async () => {
    mocks.getLoyalty.mockResolvedValue({
      ...LOYALTY,
      rates: RATES,
      tiers: [TIERS[0], { ...TIERS[1], minPoints: 500, minSpending: 5_000_000 }],
    });
    renderPage();
    expect(await screen.findByText('từ 5 triệu mua hàng trong 12 tháng · ×1,2')).toBeInTheDocument();
    expect(screen.getByText('hạng khởi đầu · ×1')).toBeInTheDocument();
  });

  it('API cũ chưa trả rates → không có mục gập luật, danh sách hạng vẫn theo điểm', async () => {
    renderPage();
    await screen.findByText(/Tích điểm ×1/);
    expect(screen.queryByRole('button', { name: 'Cách kiếm và dùng Điểm Xanh' })).toBeNull();
    expect(screen.queryByText(/Tích .* tiền hàng thành Điểm Xanh/)).toBeNull();
    expect(screen.getByText(/từ 2\.500 điểm tích luỹ/)).toBeInTheDocument();
  });
});

describe('LoyaltyPage — điểm danh chỉ ở Vườn Xanh: trang chỉ có dòng trạng thái', () => {
  const checkInButtons = () => screen.queryAllByRole('button', { name: /^(Đã )?[Đđ]iểm danh$/ });

  it('chưa điểm danh: dòng "Hôm nay bạn chưa điểm danh" mở Vườn Xanh; không có nút điểm danh, không gọi lệnh điểm danh', async () => {
    renderPage();
    const row = await screen.findByRole('button', { name: /^Hôm nay bạn chưa điểm danh/ });
    expect(row).toHaveTextContent('Mở tab Vườn Xanh');
    expect(checkInButtons()).toHaveLength(0);
    fireEvent.click(row);
    expect(mocks.navigate).toHaveBeenLastCalledWith('/game');
    expect(mocks.postDailyCheckIn).not.toHaveBeenCalled();
  });

  it('đã điểm danh: dòng "Hôm nay bạn đã điểm danh", vẫn không có nút', async () => {
    mocks.getDailyCheckInStatus.mockResolvedValue({ ...CHECK_IN, checkedInToday: true });
    renderPage();
    expect(await screen.findByRole('region', { name: 'Hôm nay bạn đã điểm danh' })).toBeInTheDocument();
    expect(screen.queryByText('Hôm nay bạn chưa điểm danh')).toBeNull();
    expect(checkInButtons()).toHaveLength(0);
  });

  it('không còn thẻ 7 ô điểm danh, luật điểm danh hay lời mời trong thẻ đó', async () => {
    renderPage();
    await screen.findByText('Hôm nay bạn chưa điểm danh');
    expect(screen.queryByText('Điểm danh mỗi ngày')).toBeNull();
    expect(screen.queryByText('N1')).toBeNull();
    expect(screen.queryByText(/không thì lịch 7 ngày bắt đầu lại/)).toBeNull();
  });

  it('tải trạng thái điểm danh lỗi: không vẽ dòng, phần còn lại của trang vẫn đủ', async () => {
    mocks.getDailyCheckInStatus.mockRejectedValue(new Error('boom'));
    renderPage();
    await screen.findByText('Lịch sử Điểm Xanh');
    await waitFor(() => expect(mocks.getDailyCheckInStatus).toHaveBeenCalled());
    expect(screen.queryByText(/Hôm nay bạn (chưa|đã) điểm danh/)).toBeNull();
    expect(screen.getByText('Đổi quà & mã giảm giá')).toBeInTheDocument();
  });
});

describe('LoyaltyPage — hai lô Điểm Xanh sau khi gộp xu', () => {
  const WITH_CONVERTED = { ...LOYALTY, pointsBalance: 120, pointsConvertedBalance: 30, pointsTotal: 150 };

  it('thẻ hạng hiện TỔNG hai lô và dòng "trong đó N điểm không hết hạn"', async () => {
    mocks.getLoyalty.mockResolvedValue(WITH_CONVERTED);
    renderPage();
    expect(await screen.findByText(/Tích điểm ×1 · 150 Điểm Xanh/)).toBeInTheDocument();
    expect(screen.getByText('trong đó 30 điểm không hết hạn')).toBeInTheDocument();
  });

  it('thẻ thành viên số cũng hiện tổng hai lô', async () => {
    mocks.getLoyalty.mockResolvedValue(WITH_CONVERTED);
    renderPage();
    fireEvent.click(await screen.findByText('Thẻ thành viên số (mã QR)'));
    expect(await screen.findByText(/Hạng Mầm Xanh · 150 Điểm Xanh/)).toBeInTheDocument();
  });

  it('không có lô quy đổi: không hiện dòng "không hết hạn" nào', async () => {
    renderPage();
    await screen.findByText(/Tích điểm ×1 · 1\.250 Điểm Xanh/);
    expect(screen.queryByText(/không hết hạn/)).toBeNull();
  });

  it('lịch sử: dòng của lô quy đổi ghi "Điểm không hết hạn", nhãn xu cũ đọc được', async () => {
    mocks.getPointsTransactions.mockResolvedValue([
      { id: 'x1', delta: 30, reason: 'XU_TO_POINTS:u1', createdAt: '2026-10-12T03:00:00.000Z', lot: 'CONVERTED' },
      { id: 'x2', delta: 5, reason: 'ORDER_EARN:o1', createdAt: '2026-10-11T03:00:00.000Z', lot: 'STANDARD' },
    ]);
    renderPage();
    expect(await screen.findByText('Chuyển từ xu cũ sang Điểm Xanh')).toBeInTheDocument();
    expect(screen.getAllByText(/ · Điểm không hết hạn$/)).toHaveLength(1);
  });
});

describe('LoyaltyPage — lịch sử phí shipper thu gom tận nhà', () => {
  it('dòng trừ và dòng hoàn có nhãn riêng kèm mã yêu cầu, không in chuỗi kỹ thuật', async () => {
    mocks.getPointsTransactions.mockResolvedValue([
      { id: 'w1', delta: -25_000, reason: 'WASTE_PICKUP_FEE:TR-8K2M9', createdAt: '2026-10-14T05:00:00.000Z', lot: 'STANDARD' },
      { id: 'w2', delta: 25_000, reason: 'WASTE_PICKUP_FEE_REFUND:TR-8K2M9', createdAt: '2026-10-15T05:00:00.000Z', lot: 'STANDARD' },
    ]);
    renderPage();
    expect(await screen.findByText('Trừ phí shipper thu gom · TR-8K2M9')).toBeInTheDocument();
    expect(screen.getByText('Hoàn điểm phí shipper · TR-8K2M9')).toBeInTheDocument();
    expect(screen.queryByText(/WASTE_PICKUP_FEE/)).toBeNull();
  });
});

describe('LoyaltyPage — hạn dùng Điểm Xanh (R2-ENGAGE-8)', () => {
  it('hiện điểm sắp hết hạn gần nhất kèm ngày và chính sách 12 tháng', async () => {
    const soon = new Date(Date.now() + 10 * 864e5);
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, expiringPoints: { amount: 70, expiresAt: soon.toISOString() }, pointExpireMonths: 12 });
    renderPage();
    expect(await screen.findByText(/^70 Điểm Xanh sẽ hết hạn ngày \d{2}\/\d{2}\/\d{4} \(còn 10 ngày\)$/)).toBeInTheDocument();
    expect(screen.getByText('Điểm Xanh thường có hạn 12 tháng kể từ ngày nhận, điểm cũ được dùng trước.')).toBeInTheDocument();
  });

  it('điểm quy đổi vẫn ghi rõ không hết hạn bên cạnh dòng điểm sắp hết hạn', async () => {
    mocks.getLoyalty.mockResolvedValue({
      ...LOYALTY,
      pointsConvertedBalance: 30,
      expiringPoints: { amount: 500, expiresAt: '2099-01-01T03:00:00.000Z' },
      pointExpireMonths: 12,
    });
    renderPage();
    expect(await screen.findByText('trong đó 30 điểm không hết hạn')).toBeInTheDocument();
    expect(screen.getByText(/^500 Điểm Xanh sẽ hết hạn ngày 01\/01\/2099$/)).toBeInTheDocument();
  });

  it('không có điểm sắp hết hạn: chỉ còn dòng chính sách, không có dòng "sẽ hết hạn"', async () => {
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, expiringPoints: null, pointExpireMonths: 12 });
    renderPage();
    expect(await screen.findByText(/có hạn 12 tháng/)).toBeInTheDocument();
    expect(screen.queryByText(/sẽ hết hạn ngày/)).toBeNull();
  });
});

describe('LoyaltyPage — hạn giữ hạng, lịch sử, biểu tượng hạng, thẻ tải khi mở', () => {
  it('đang trong hạn giữ hạng: một dòng nói phải mua thêm bao nhiêu và đến ngày nào', async () => {
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, tierGrace: { until: '2026-11-07T10:00:00.000Z', spendingToKeep: 400_000, pointsToKeep: 0 } });
    renderPage();
    expect(await screen.findByText('Giữ hạng Mầm Xanh: đơn giao thành công thêm 400.000đ trước 07/11/2026')).toBeInTheDocument();
  });

  it('không có hạn giữ hạng: không có dòng đó', async () => {
    renderPage();
    await screen.findByText(/Tích điểm ×1/);
    expect(screen.queryByText(/Giữ hạng/)).not.toBeInTheDocument();
  });

  it('lịch sử: 20 dòng, "Xem thêm" tải trang kế từ máy chủ (cả dòng cũ hơn 100) cho tới hết', async () => {
    const rows = Array.from({ length: 145 }, (_, i) => ({
      id: `n${String(i).padStart(3, '0')}`, delta: 1, reason: 'CHECKIN_DAILY:DAY_1', expiresAt: null, createdAt: new Date(Date.UTC(2026, 9, 10, 5, 0, 0) - i * 1000).toISOString(),
    }));
    servePointsHistory(rows);
    renderPage();
    const rowsShown = () => screen.getAllByText('+1').length;
    await screen.findByRole('button', { name: 'Xem thêm' });
    expect(rowsShown()).toBe(20);
    for (const shown of [40, 60, 80, 100, 120, 140]) {
      fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
      await waitFor(() => expect(rowsShown()).toBe(shown));
    }
    // Trang 8 chỉ còn 5 dòng: hết dòng cũ hơn thì không còn nút.
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    await waitFor(() => expect(rowsShown()).toBe(145));
    expect(screen.queryByRole('button', { name: /^Xem thêm/ })).not.toBeInTheDocument();
    // Mỗi trang gửi mốc của dòng cuối trang trước.
    expect(mocks.getPointsTransactions.mock.calls[0]![0]).toMatchObject({ limit: 20 });
    expect(mocks.getPointsTransactions.mock.calls[1]![0]).toMatchObject({ limit: 20, beforeId: 'n019', before: rows[19]!.createdAt });
  });

  it('lịch sử: ít hơn một trang thì không có nút "Xem thêm"', async () => {
    servePointsHistory([{ id: 'a', delta: 1, reason: 'CHECKIN_DAILY:DAY_1', expiresAt: null, createdAt: '2026-10-10T05:00:00Z' } as never]);
    renderPage();
    await screen.findByText('+1');
    expect(screen.queryByRole('button', { name: /^Xem thêm/ })).not.toBeInTheDocument();
  });

  it('lịch sử: tải lỗi thì báo lỗi có nút thử lại, không giả vờ "chưa có giao dịch"', async () => {
    mocks.getPointsTransactions.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Chưa tải được lịch sử Điểm Xanh')).toBeInTheDocument();
    expect(screen.queryByText('Chưa có giao dịch điểm nào')).toBeNull();
  });

  it('lịch sử: tải trang kế lỗi thì giữ các dòng đã có, nút đổi thành "thử lại" và bấm lại tải được', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `n${String(i).padStart(2, '0')}`, delta: 1, reason: 'CHECKIN_DAILY:DAY_1', expiresAt: null, createdAt: new Date(Date.UTC(2026, 9, 10, 5) - i * 1000).toISOString() }));
    servePointsHistory(rows);
    renderPage();
    await screen.findByRole('button', { name: 'Xem thêm' });
    mocks.getPointsTransactions.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Chưa tải được, bấm để thử lại' }));
    await waitFor(() => expect(screen.getAllByText('+1')).toHaveLength(30));
  });

  it('lịch sử: chạm đúp "Xem thêm" trong cùng một nhịp chỉ xin trang kế một lần, nút khoá tới khi trang về', async () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({ id: `n${String(i).padStart(2, '0')}`, delta: 1, reason: 'CHECKIN_DAILY:DAY_1', expiresAt: null, createdAt: new Date(Date.UTC(2026, 9, 10, 5) - i * 1000).toISOString() }));
    servePointsHistory(rows);
    renderPage();
    const more = await screen.findByRole('button', { name: 'Xem thêm' });
    let deliver: () => void = () => undefined;
    mocks.getPointsTransactions.mockImplementationOnce(
      () => new Promise((resolve) => { deliver = () => resolve(rows.slice(20, 40)); }),
    );
    act(() => {
      fireEvent.click(more);
      fireEvent.click(more);
    });
    await waitFor(() => expect(mocks.getPointsTransactions).toHaveBeenCalledTimes(2));
    expect(more).toHaveAttribute('aria-busy', 'true');
    await act(async () => deliver());
    await waitFor(() => expect(screen.getAllByText('+1')).toHaveLength(40));
    expect(mocks.getPointsTransactions).toHaveBeenCalledTimes(2);
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
    await waitFor(() => expect(screen.getAllByText('+1')).toHaveLength(45));
    expect(mocks.getPointsTransactions).toHaveBeenCalledTimes(3);
  });

  it('đổi tên hạng trong admin: biểu tượng vẫn theo thứ hạng', async () => {
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, tier: { id: 't2', name: 'Hạng Bạc Đặc Biệt', multiplier: 1.2, perks: [] } });
    const { container } = renderPage();
    await screen.findByText(/Tích điểm ×1,2/);
    expect(container.textContent).toContain('🌿');
  });

  it('thẻ thành viên chỉ tải khi khách mở thẻ', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Thẻ thành viên số (mã QR)'));
    await screen.findByText('Thẻ Thành Viên Tubu');
    expect(mocks.getMemberCard).toHaveBeenCalledTimes(1);
  });

  it('chưa mở thẻ: không gọi getMemberCard', async () => {
    renderPage();
    await screen.findByText(/Tích điểm ×1/);
    expect(mocks.getMemberCard).not.toHaveBeenCalled();
  });
});

describe('LoyaltyPage — thẻ thành viên số', () => {
  const openCard = async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Thẻ thành viên số (mã QR)'));
    await screen.findByText('Thẻ Thành Viên Tubu');
  };

  it('mở thẻ: QR mã hoá đúng memberCode, hiện mã gõ tay được và lời nhắc theo cờ backend', async () => {
    await openCard();
    expect(await screen.findByTestId('qr')).toHaveAttribute('data-value', 'TUBU123');
    expect(screen.getByText('TUBU123')).toBeInTheDocument();
    expect(screen.getByText(/Đây là mã thành viên của bạn/)).toBeInTheDocument();
    expect(screen.getByText(/Hạng Mầm Xanh · 1\.250 Điểm Xanh/)).toBeInTheDocument();
  });

  it('chép mã thành công: báo "Đã sao chép", nút đổi thành "Đã chép"', async () => {
    await openCard();
    fireEvent.click(await screen.findByText('Chép'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép mã thành viên', type: 'success' }));
    expect(mocks.copyText).toHaveBeenCalledWith('TUBU123');
    expect(screen.getByText('Đã chép')).toBeInTheDocument();
  });

  it('chép không được: báo lỗi, KHÔNG báo "Đã sao chép"', async () => {
    mocks.copyText.mockResolvedValue(false);
    await openCard();
    fireEvent.click(await screen.findByText('Chép'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã sao chép mã thành viên' }));
    expect(screen.queryByText('Đã chép')).not.toBeInTheDocument();
  });

  it('lỗi tải mã: có nút Thử lại gọi lại API, không vẽ QR', async () => {
    mocks.getMemberCard.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    fireEvent.click(await screen.findByText('Thẻ thành viên số (mã QR)'));
    await screen.findByText(/Chưa tải được mã thành viên/);
    expect(screen.queryByTestId('qr')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByTestId('qr')).toHaveAttribute('data-value', 'TUBU123');
  });

  it('"Đóng" tắt thẻ', async () => {
    await openCard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Đóng' })[0]!);
    await waitFor(() => expect(screen.queryByText('Thẻ Thành Viên Tubu')).not.toBeInTheDocument());
  });
});

describe('LoyaltyPage — chúc mừng lên hạng (§6.6 #78)', () => {
  const TIER2 = { id: 't2', name: 'Lộc Biếc', multiplier: 1.2, perks: ['Quà sinh nhật', 'Ưu tiên giao hàng'] };

  it('lần đầu (chưa có mốc cũ): chỉ ghi mốc, không bật chúc mừng', async () => {
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, tier: TIER2, nextTier: null });
    renderPage();
    await screen.findByText(/Tích điểm ×1,2/);
    expect(screen.queryByText(/Chúc mừng lên hạng/)).not.toBeInTheDocument();
    expect(localStorage.getItem('tubu_last_tier_min_v2')).toBe('2500');
  });

  it('mốc lưu trước đợt đổi ngưỡng điểm (khoá cũ) bị bỏ qua: không chúc mừng giả', async () => {
    localStorage.setItem('tubu_last_tier_min', '0');
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, tier: TIER2, nextTier: null });
    renderPage();
    await screen.findByText(/Tích điểm ×1,2/);
    expect(screen.queryByText(/Chúc mừng lên hạng/)).not.toBeInTheDocument();
  });

  it('mốc cũ thấp hơn hạng hiện tại: chúc mừng kèm quyền lợi, "Tuyệt vời!" đóng lại', async () => {
    localStorage.setItem('tubu_last_tier_min_v2', '0');
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, tier: TIER2, nextTier: null });
    renderPage();
    expect(await screen.findByText('Chúc mừng lên hạng Lộc Biếc!')).toBeInTheDocument();
    // một lần ở mục "Quyền lợi của bạn", một lần trong hộp chúc mừng
    expect(screen.getAllByText(/Quà sinh nhật/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Tuyệt vời!' }));
    await waitFor(() => expect(screen.queryByText(/Chúc mừng lên hạng/)).not.toBeInTheDocument());
  });

  it('mốc cũ bằng hạng hiện tại: không chúc mừng', async () => {
    localStorage.setItem('tubu_last_tier_min_v2', '0');
    renderPage();
    await screen.findByText(/Tích điểm ×1 /);
    expect(screen.queryByText(/Chúc mừng lên hạng/)).not.toBeInTheDocument();
  });
});

describe('LoyaltyPage — cảnh báo React trùng key', () => {
  it('mọi danh sách dựng từ dữ liệu đúng hình của API (hạng, lịch sử) không phát cảnh báo key', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getCoupons.mockResolvedValue(
      ['GIAM10', 'FREESHIP'].map((code) => ({ code, type: 'AMOUNT', value: 10_000, minOrder: null, maxDiscount: null, endAt: '2026-12-31T00:00:00.000Z' })),
    );
    mocks.getPointsTransactions.mockResolvedValue(
      [1, 2, 3].map((n) => ({ id: `tx${n}`, delta: 5, reason: 'DAILY_CHECKIN', refType: 'CHECKIN', expiresAt: null, createdAt: '2026-10-0' + n + 'T00:00:00.000Z' })),
    );
    try {
      renderPage();
      await screen.findByText('Bạn đang có 2 mã giảm giá');
      await screen.findByText('Lịch sử Điểm Xanh');
      expect(errors.mock.calls.filter((c) => /same key|unique "key"/.test(String(c[0])))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('LoyaltyPage — dải "Mua trong Mini App tích gấp đôi"', () => {
  const ON = { isLoaded: true, loyalty: { earnPct: 2, vndPerPoint: 50, marketplaceEarnPct: 1, marketplaceClaimEnabled: true } };

  it('cờ tích đơn sàn bật: dải nằm trên thẻ hạng; tắt: không có', async () => {
    boost.cfg = ON;
    const { unmount } = renderPage();
    const strip = await screen.findByTestId('points-boost');
    expect(strip).toHaveTextContent('Mua trong Mini App: tích gấp đôi');
    expect(strip.compareDocumentPosition(await screen.findByText(/Tích điểm ×/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    boost.cfg = { isLoaded: true, loyalty: { ...ON.loyalty, marketplaceClaimEnabled: false } };
    renderPage();
    await screen.findByText(/Tích điểm ×/);
    expect(screen.queryByTestId('points-boost')).toBeNull();
    boost.cfg = { isLoaded: false };
  });
});
