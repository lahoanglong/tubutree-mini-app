import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Đặc tả hành vi trang Hạng thành viên & Điểm Xanh (C-076, PC-10a): nút điểm danh, nút đổi quà,
 * hộp xác nhận, thẻ thành viên, chúc mừng lên hạng. Viết TRƯỚC khi di cư sang DS v2 để chứng minh
 * việc đổi Button/Modal không đổi điều kiện bật/tắt nút, số lần gọi API và con số hiển thị.
 * Chỉ truy vấn theo role/chữ (không theo class/cấu trúc) để chạy được trên cả bản cũ lẫn bản mới.
 */
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getLoyalty: vi.fn(),
  getCoupons: vi.fn(),
  getPointsTransactions: vi.fn(),
  getDailyCheckInStatus: vi.fn(),
  getMemberCard: vi.fn(),
  postDailyCheckIn: vi.fn(),
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
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.publicConfig }));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', user: { id: 'u1' } };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
const boost = vi.hoisted(() => ({ cfg: { isLoaded: false } as { isLoaded: boolean; loyalty?: Record<string, unknown> } }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => boost.cfg }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../components/qr-code', () => ({
  QrCode: ({ value }: { value: string }) => <span data-testid="qr" data-value={value} />,
}));
vi.mock('../services/account-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLoyalty: mocks.getLoyalty,
  getCoupons: mocks.getCoupons,
  getPointsTransactions: mocks.getPointsTransactions,
  getDailyCheckInStatus: mocks.getDailyCheckInStatus,
  getMemberCard: mocks.getMemberCard,
  postDailyCheckIn: mocks.postDailyCheckIn,
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publicConfig.waste.enabled = true;
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  mocks.getLoyalty.mockResolvedValue(LOYALTY);
  mocks.getCoupons.mockResolvedValue([]);
  mocks.getPointsTransactions.mockResolvedValue([]);
  mocks.getDailyCheckInStatus.mockResolvedValue(CHECK_IN);
  mocks.getMemberCard.mockResolvedValue({ memberCode: 'TUBU123', posCreditEnabled: false });
  mocks.postDailyCheckIn.mockResolvedValue({ message: 'Điểm danh thành công, +3 điểm' });
  mocks.copyText.mockResolvedValue(true);
});

describe('LoyaltyPage — thẻ hạng', () => {
  it('hiện hạng, hệ số, số dư Điểm Xanh và phần còn lại để lên hạng kế', async () => {
    const { container } = renderPage();
    expect(await screen.findByText(/Tích điểm ×1 · 1\.250 điểm Xanh/)).toBeInTheDocument();
    expect(screen.getByText(/để lên hạng Lộc Biếc/)).toBeInTheDocument();
    // tierPoints 1.250 / ngưỡng 2.500 → 50%
    expect(container.querySelector('[style*="width: 50%"]')).not.toBeNull();
  });

  it('hạng cao nhất: không có thanh tiến độ, hiện lời chúc', async () => {
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, nextTier: null });
    const { container } = renderPage();
    expect(await screen.findByText(/Bạn đang ở hạng cao nhất/)).toBeInTheDocument();
    expect(container.querySelector('[style*="width: 50%"]')).toBeNull();
  });

  it('các lối tắt dẫn đúng trang: Vườn Cây → /game, Đổi rác lấy quà → /recycle, Kho quà → /rewards, mua sắm → /browse', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Vườn Cây Tubu'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/game');
    fireEvent.click(screen.getByText('Đổi rác lấy quà'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle');
    fireEvent.click(screen.getByRole('button', { name: /Kho quà/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/rewards');
    fireEvent.click(screen.getByText(/Mua sắm để tích thêm Điểm Xanh/));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse');
  });
});

describe('LoyaltyPage — lối vào Đổi rác theo cờ chương trình', () => {
  it('chương trình tắt → không có hàng Đổi rác; hàng Kho quà vẫn hiện', async () => {
    mocks.publicConfig.waste.enabled = false;
    renderPage();
    await screen.findByText('Lịch sử Điểm Xanh');
    expect(screen.queryByText('Đổi rác lấy quà')).toBeNull();
    expect(screen.queryByText('Trạm Refill')).toBeNull();
    expect(screen.getByText('Kho quà')).toBeInTheDocument();
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

  it('nói rõ tích bao nhiêu % tiền hàng và 1 điểm = 1.000đ khi dùng, lấy từ cấu hình API', async () => {
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, rates: RATES });
    renderPage();
    expect(await screen.findByText('Tích 2% tiền hàng thành Điểm Xanh')).toBeInTheDocument();
    expect(screen.getByText('1 điểm = 1.000đ khi dùng ở bước thanh toán (tối đa 20% giá trị đơn)')).toBeInTheDocument();
  });

  it('tỷ lệ cấu hình khác thì chữ đổi theo, không hardcode 2%', async () => {
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, rates: { ...RATES, earnPct: 3, vndPerPoint: 33 } });
    renderPage();
    expect(await screen.findByText('Tích 3% tiền hàng thành Điểm Xanh')).toBeInTheDocument();
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
    expect(await screen.findByText('từ 5 triệu mua hàng trong 12 tháng · ×1.2')).toBeInTheDocument();
    expect(screen.getByText('hạng khởi đầu · ×1')).toBeInTheDocument();
  });

  it('API cũ chưa trả rates → không hiện dòng giải thích, danh sách hạng vẫn theo điểm', async () => {
    renderPage();
    await screen.findByText(/Tích điểm ×1/);
    expect(screen.queryByText(/Tích .* tiền hàng thành Điểm Xanh/)).toBeNull();
    expect(screen.getByText(/từ 2\.500 điểm tích luỹ/)).toBeInTheDocument();
  });
});

describe('LoyaltyPage — điểm danh Điểm Xanh', () => {
  it('chưa điểm danh: nút "Điểm danh +3" bật; chạm đúp chỉ gọi API 1 lần, rồi báo thành công và khoá nút', async () => {
    mocks.getDailyCheckInStatus.mockResolvedValueOnce(CHECK_IN).mockResolvedValue({ ...CHECK_IN, checkedInToday: true });
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Điểm danh +3' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Điểm danh thành công, +3 điểm', type: 'success' }));
    expect(mocks.postDailyCheckIn).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Đã điểm danh' })).toBeDisabled();
  });

  it('đã điểm danh hôm nay: nút "Đã điểm danh" tắt, bấm không gọi API', async () => {
    mocks.getDailyCheckInStatus.mockResolvedValue({ ...CHECK_IN, checkedInToday: true });
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đã điểm danh' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(mocks.postDailyCheckIn).not.toHaveBeenCalled();
  });

  it('lỗi điểm danh: báo lỗi và tải lại trạng thái để nút theo đúng thực tế', async () => {
    mocks.postDailyCheckIn.mockRejectedValue(new Error('boom'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Điểm danh +3' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(mocks.getDailyCheckInStatus).toHaveBeenCalledTimes(2));
  });

  it('7 ô ngày: số điểm từng ngày có trong trang', async () => {
    renderPage();
    await screen.findByText('Điểm danh nhận Điểm Xanh');
    for (const d of [1, 2, 3, 4, 5, 6, 7]) expect(screen.getByText(`N${d}`)).toBeInTheDocument();
    expect(screen.getByText('+7')).toBeInTheDocument();
  });
});

describe('LoyaltyPage — hai lô Điểm Xanh sau khi gộp xu (PD-3)', () => {
  const WITH_CONVERTED = { ...LOYALTY, pointsBalance: 120, pointsConvertedBalance: 30, pointsTotal: 150 };

  it('thẻ hạng hiện TỔNG hai lô và dòng "trong đó N điểm không hết hạn"', async () => {
    mocks.getLoyalty.mockResolvedValue(WITH_CONVERTED);
    renderPage();
    expect(await screen.findByText(/Tích điểm ×1 · 150 điểm Xanh/)).toBeInTheDocument();
    expect(screen.getByText('trong đó 30 điểm không hết hạn')).toBeInTheDocument();
  });

  it('thẻ thành viên số cũng hiện tổng hai lô', async () => {
    mocks.getLoyalty.mockResolvedValue(WITH_CONVERTED);
    renderPage();
    fireEvent.click(await screen.findByText('Thẻ thành viên số (mã QR)'));
    expect(await screen.findByText(/Hạng Mầm Xanh · 150 điểm Xanh/)).toBeInTheDocument();
  });

  it('không có lô quy đổi: không hiện dòng "không hết hạn" nào', async () => {
    renderPage();
    await screen.findByText(/Tích điểm ×1 · 1\.250 điểm Xanh/);
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
    expect(screen.getByText(/Hạng Mầm Xanh · 1\.250 điểm Xanh/)).toBeInTheDocument();
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
    await screen.findByText(/Tích điểm ×1\.2/);
    expect(screen.queryByText(/Chúc mừng lên hạng/)).not.toBeInTheDocument();
    expect(localStorage.getItem('tubu_last_tier_min')).toBe('2500');
  });

  it('mốc cũ thấp hơn hạng hiện tại: chúc mừng kèm quyền lợi, "Tuyệt vời!" đóng lại', async () => {
    localStorage.setItem('tubu_last_tier_min', '0');
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, tier: TIER2, nextTier: null });
    renderPage();
    expect(await screen.findByText('Chúc mừng lên hạng Lộc Biếc!')).toBeInTheDocument();
    // một lần ở mục "Quyền lợi của bạn", một lần trong hộp chúc mừng
    expect(screen.getAllByText(/Quà sinh nhật/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Tuyệt vời!' }));
    await waitFor(() => expect(screen.queryByText(/Chúc mừng lên hạng/)).not.toBeInTheDocument());
  });

  it('mốc cũ bằng hạng hiện tại: không chúc mừng', async () => {
    localStorage.setItem('tubu_last_tier_min', '0');
    renderPage();
    await screen.findByText(/Tích điểm ×1 /);
    expect(screen.queryByText(/Chúc mừng lên hạng/)).not.toBeInTheDocument();
  });
});

describe('LoyaltyPage — cảnh báo React trùng key', () => {
  it('mọi danh sách dựng từ dữ liệu đúng hình của API (mã giảm giá, 7 ô điểm danh, hạng, lịch sử) không phát cảnh báo key', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getCoupons.mockResolvedValue(
      ['GIAM10', 'FREESHIP'].map((code) => ({ code, type: 'AMOUNT', value: 10_000, minOrder: null, maxDiscount: null, endAt: '2026-12-31T00:00:00.000Z' })),
    );
    mocks.getPointsTransactions.mockResolvedValue(
      [1, 2, 3].map((n) => ({ id: `tx${n}`, delta: 5, reason: 'DAILY_CHECKIN', refType: 'CHECKIN', expiresAt: null, createdAt: '2026-10-0' + n + 'T00:00:00.000Z' })),
    );
    try {
      renderPage();
      await screen.findByText('2 mã');
      await screen.findByText('Lịch sử Điểm Xanh');
      expect(errors.mock.calls.filter((c) => /same key|unique "key"/.test(String(c[0])))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('LoyaltyPage — thẻ mã giảm giá (R6-BUYER-12)', () => {
  it('mã phần trăm có trần ghi "tối đa …"; không có trần thì chỉ ghi phần trăm', async () => {
    mocks.getCoupons.mockResolvedValue([
      { code: 'XANH10', type: 'PERCENT', value: 10, minOrder: null, maxDiscount: 50_000, endAt: '2026-12-31T00:00:00.000Z' },
      { code: 'KHONGTRAN', type: 'PERCENT', value: 5, minOrder: null, maxDiscount: null, endAt: '2026-12-31T00:00:00.000Z' },
    ]);
    renderPage();
    expect(await screen.findByText('Giảm 10% (tối đa 50.000đ)')).toBeInTheDocument();
    expect(screen.getByText('Giảm 5%')).toBeInTheDocument();
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
