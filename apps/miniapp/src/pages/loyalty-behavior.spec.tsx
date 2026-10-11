import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
  getLoyaltyRewards: vi.fn(),
  getDailyCheckInStatus: vi.fn(),
  getMemberCard: vi.fn(),
  postDailyCheckIn: vi.fn(),
  redeemLoyaltyReward: vi.fn(),
  copyText: vi.fn(),
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
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../components/qr-code', () => ({
  QrCode: ({ value }: { value: string }) => <span data-testid="qr" data-value={value} />,
}));
vi.mock('../services/account-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLoyalty: mocks.getLoyalty,
  getCoupons: mocks.getCoupons,
  getPointsTransactions: mocks.getPointsTransactions,
  getLoyaltyRewards: mocks.getLoyaltyRewards,
  getDailyCheckInStatus: mocks.getDailyCheckInStatus,
  getMemberCard: mocks.getMemberCard,
  postDailyCheckIn: mocks.postDailyCheckIn,
  redeemLoyaltyReward: mocks.redeemLoyaltyReward,
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
const REWARD_OK = { id: 'r-ok', title: 'Giảm 20.000đ', description: 'Đơn từ 150.000đ', pointsCost: 500, type: 'AMOUNT', value: 20_000, canRedeem: true };
const REWARD_LOCKED = { id: 'r-locked', title: 'Giảm 50.000đ', description: 'Đơn từ 300.000đ', pointsCost: 5_000, type: 'AMOUNT', value: 50_000, canRedeem: false };
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
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  mocks.getLoyalty.mockResolvedValue(LOYALTY);
  mocks.getCoupons.mockResolvedValue([]);
  mocks.getPointsTransactions.mockResolvedValue([]);
  mocks.getLoyaltyRewards.mockResolvedValue({ pointsBalance: 1_250, rewards: [REWARD_OK, REWARD_LOCKED] });
  mocks.getDailyCheckInStatus.mockResolvedValue(CHECK_IN);
  mocks.getMemberCard.mockResolvedValue({ memberCode: 'TUBU123', posCreditEnabled: false });
  mocks.postDailyCheckIn.mockResolvedValue({ message: 'Điểm danh thành công, +3 điểm' });
  mocks.redeemLoyaltyReward.mockResolvedValue({ coupon: { code: 'GIFT20K' } });
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

  it('các lối tắt dẫn đúng trang: Vườn Cây → /game, Trạm Refill → /refill, mua sắm → /browse', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Vườn Cây Tubu'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/game');
    fireEvent.click(screen.getByText('Trạm Refill'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/refill');
    fireEvent.click(screen.getByText(/Mua sắm để tích thêm Điểm Xanh/));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse');
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

describe('LoyaltyPage — đổi Điểm Xanh nhận mã giảm giá', () => {
  it('ưu đãi chưa đủ điểm: nút "Cần 5.000 điểm" tắt, bấm không mở hộp xác nhận', async () => {
    renderPage();
    const locked = await screen.findByRole('button', { name: 'Cần 5.000 điểm' });
    expect(locked).toBeDisabled();
    fireEvent.click(locked);
    expect(screen.queryByText('Xác nhận đổi ưu đãi')).not.toBeInTheDocument();
  });

  it('đủ điểm: bấm "Đổi ngay" mở hộp xác nhận với điểm trừ và điểm còn lại đúng; chưa gọi API', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi ngay' }));
    expect(await screen.findByText('Xác nhận đổi ưu đãi')).toBeInTheDocument();
    expect(screen.getByText('-500 điểm Xanh')).toBeInTheDocument();
    expect(screen.getByText('750 điểm Xanh')).toBeInTheDocument();
    expect(mocks.redeemLoyaltyReward).not.toHaveBeenCalled();
  });

  it('"Huỷ" đóng hộp xác nhận mà không gọi API', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi ngay' }));
    await screen.findByText('Xác nhận đổi ưu đãi');
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(screen.queryByText('Xác nhận đổi ưu đãi')).not.toBeInTheDocument());
    expect(mocks.redeemLoyaltyReward).not.toHaveBeenCalled();
  });

  it('xác nhận: gọi đúng 1 lần với id ưu đãi dù chạm đúp, báo mã mới, đóng hộp và tải lại điểm', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi ngay' }));
    await screen.findByText('Xác nhận đổi ưu đãi');
    const confirm = screen.getAllByRole('button', { name: 'Đổi ngay' }).at(-1)!;
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({
        text: 'Đổi thành công! Mã GIFT20K đã vào mục Mã giảm giá của tôi.',
        type: 'success',
      }),
    );
    expect(mocks.redeemLoyaltyReward).toHaveBeenCalledTimes(1);
    expect(mocks.redeemLoyaltyReward).toHaveBeenCalledWith('r-ok');
    await waitFor(() => expect(screen.queryByText('Xác nhận đổi ưu đãi')).not.toBeInTheDocument());
    await waitFor(() => expect(mocks.getLoyaltyRewards).toHaveBeenCalledTimes(2));
  });

  // BottomSheet (ZaUI Sheet unmountOnClose) giữ nút trong DOM và bấm được thêm ~200ms sau khi đóng:
  // hành động phải đọc state đang sống, không đọc phần nội dung được giữ lại cho hoạt ảnh.
  it('bấm "Huỷ" rồi chạm ngay "Đổi ngay" trong hộp đang đóng: không đổi quà', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi ngay' }));
    await screen.findByText('Xác nhận đổi ưu đãi');
    const confirm = screen.getAllByRole('button', { name: 'Đổi ngay' }).at(-1)!;
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(confirm.isConnected).toBe(true);
    fireEvent.click(confirm);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(mocks.redeemLoyaltyReward).not.toHaveBeenCalled();
  });

  it('đổi thành công rồi chạm lại "Đổi ngay" trong hộp đang đóng: vẫn chỉ gọi API 1 lần', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi ngay' }));
    await screen.findByText('Xác nhận đổi ưu đãi');
    const confirm = screen.getAllByRole('button', { name: 'Đổi ngay' }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    expect(confirm.isConnected).toBe(true);
    fireEvent.click(confirm);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(mocks.redeemLoyaltyReward).toHaveBeenCalledTimes(1);
  });

  it('đổi lỗi: báo lỗi, vẫn tải lại điểm', async () => {
    mocks.redeemLoyaltyReward.mockRejectedValue(new Error('boom'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi ngay' }));
    await screen.findByText('Xác nhận đổi ưu đãi');
    fireEvent.click(screen.getAllByRole('button', { name: 'Đổi ngay' }).at(-1)!);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(mocks.getLoyaltyRewards).toHaveBeenCalledTimes(2));
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

  it('hộp xác nhận đổi mã giảm giá: "Điểm còn lại" là tổng hai lô sau khi trừ, khớp con số ở đầu trang', async () => {
    // 600 thường + 100 quy đổi, đổi ưu đãi 500 điểm (chỉ trừ lô thường) → còn 200 điểm Xanh, không phải 100.
    mocks.getLoyalty.mockResolvedValue({ ...LOYALTY, pointsBalance: 600, pointsConvertedBalance: 100, pointsTotal: 700 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi ngay' }));
    await screen.findByText('Xác nhận đổi ưu đãi');
    expect(screen.getByText('-500 điểm Xanh')).toBeInTheDocument();
    expect(screen.getByText('200 điểm Xanh')).toBeInTheDocument();
    expect(screen.queryByText('100 điểm Xanh')).toBeNull();
  });

  it('thẻ thành viên số cũng hiện tổng hai lô', async () => {
    mocks.getLoyalty.mockResolvedValue(WITH_CONVERTED);
    renderPage();
    fireEvent.click(await screen.findByText('Thẻ thành viên số (mã QR)'));
    expect(await screen.findByText(/Hạng Mầm Xanh · 150 điểm Xanh/)).toBeInTheDocument();
  });

  it('có điểm không hết hạn thì danh mục đổi quà nói rõ phần đó không dùng để đổi mã giảm giá', async () => {
    mocks.getLoyalty.mockResolvedValue(WITH_CONVERTED);
    renderPage();
    expect(await screen.findByText(/Điểm không hết hạn chỉ dùng khi thanh toán, không dùng để đổi mã giảm giá/)).toBeInTheDocument();
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
  it('mọi danh sách dựng từ dữ liệu đúng hình của API (mã giảm giá, 7 ô điểm danh, hạng, quà, lịch sử) không phát cảnh báo key', async () => {
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
      await screen.findByText('Giảm 20.000đ');
      expect(errors.mock.calls.filter((c) => /same key|unique "key"/.test(String(c[0])))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});
