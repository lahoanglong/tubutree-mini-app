import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicConfig: vi.fn(),
  submitExternalClaim: vi.fn(),
  getMyExternalClaims: vi.fn(),
  scanCode: vi.fn(),
  phase: 'authenticated' as string,
  user: { phone: '0901234567' } as { phone?: string | null } | null,
  ensurePhone: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/points/scan', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicConfig: mocks.getPublicConfig,
}));
vi.mock('../services/external-points-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  submitExternalClaim: mocks.submitExternalClaim,
  getMyExternalClaims: mocks.getMyExternalClaims,
}));
vi.mock('../services/zmp-bridge', () => ({ scanCode: mocks.scanCode }));
vi.mock('../hooks/use-auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('../store/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { user: mocks.user, ensurePhone: mocks.ensurePhone };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../components/back-button', () => ({ default: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ExternalPointsPage, { claimStateView } from './external-points';
import { formatDate } from '../utils/format';

// Mốc tương lai tính từ giờ chạy test, để ca "mốc chưa qua" không tự hỏng khi đồng hồ đi qua một ngày cố định.
const futureIso = () => new Date(Date.now() + 7 * 864e5).toISOString();

const LOYALTY = { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000, marketplaceEarnPct: 1, marketplaceClaimEnabled: true };
const EMPTY_LIST = { data: [], meta: { page: 1, limit: 10, total: 0 }, searching: [] };

function rejection(code: string) {
  return Object.assign(new Error('x'), { isAxiosError: true, response: { status: 409, data: { code, message: 'máy chủ' } } });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ExternalPointsPage /></QueryClientProvider>);
}

describe('Trang Tích điểm đơn ngoài app', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase = 'authenticated';
    mocks.user = { phone: '0901234567' };
    mocks.getPublicConfig.mockResolvedValue({ loyalty: LOYALTY });
    mocks.getMyExternalClaims.mockResolvedValue(EMPTY_LIST);
  });

  it('cờ tắt: báo chưa mở, không có ô nhập', async () => {
    mocks.getPublicConfig.mockResolvedValue({ loyalty: { ...LOYALTY, marketplaceClaimEnabled: false } });
    renderPage();
    expect(await screen.findByText('Chưa mở')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tích điểm' })).toBeNull();
    expect(mocks.getMyExternalClaims).not.toHaveBeenCalled();
  });

  it('cờ bật: có dải gấp đôi, ô nhập tay và danh sách rỗng', async () => {
    renderPage();
    expect(await screen.findByText('Mua trong Mini App: tích gấp đôi')).toBeInTheDocument();
    expect(screen.getByLabelText('Mã vận đơn hoặc mã đơn trên sàn')).toBeInTheDocument();
    expect(await screen.findByText('Bạn chưa tích điểm đơn ngoài app nào.')).toBeInTheDocument();
  });

  it('gửi mã thành công: hiện sàn, điểm chờ và mốc dự kiến, tải lại danh sách', async () => {
    const future = futureIso();
    mocks.submitExternalClaim.mockResolvedValue({
      status: 'CLAIMED', claimId: 'c1', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250,
      expectedCreditAt: future, message: 'ok',
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Mã vận đơn hoặc mã đơn trên sàn'), { target: { value: ' spxvn123456789 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    const result = await screen.findByTestId('claim-result');
    expect(mocks.submitExternalClaim).toHaveBeenCalledWith('spxvn123456789');
    expect(result).toHaveTextContent('Đã ghi nhận đơn Shopee SPX***789');
    expect(result).toHaveTextContent('1.250 Điểm Xanh đang chờ cộng');
    expect(result).toHaveTextContent(`Dự kiến cộng từ ${formatDate(future)}`);
    await waitFor(() => expect(mocks.getMyExternalClaims.mock.calls.length).toBeGreaterThan(1));
  });

  it('lỗi theo code: hiện câu tiếng Việt của app, không in message máy chủ', async () => {
    mocks.submitExternalClaim.mockRejectedValue(rejection('ALREADY_CLAIMED'));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Mã vận đơn hoặc mã đơn trên sàn'), { target: { value: 'SPXVN123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mã này đã được dùng để tích điểm trước đó.');
    expect(screen.queryByText('máy chủ')).toBeNull();
    expect(screen.queryByTestId('claim-result')).toBeNull();
  });

  describe('khách chưa chia sẻ số điện thoại (D14-01)', () => {
    const typeCode = async (value = 'SPXVN123456789') => {
      fireEvent.change(await screen.findByLabelText('Mã vận đơn hoặc mã đơn trên sàn'), { target: { value } });
    };

    it('chưa có SĐT: xin SĐT ngay khi bấm Tích điểm, rồi mới gửi mã', async () => {
      mocks.user = { phone: null };
      mocks.ensurePhone.mockResolvedValue('0901234567');
      mocks.submitExternalClaim.mockResolvedValue({
        status: 'SEARCHING', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x',
      });
      renderPage();
      await typeCode();
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
      await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledWith('SPXVN123456789'));
      expect(mocks.ensurePhone).toHaveBeenCalledTimes(1);
      expect(mocks.ensurePhone.mock.invocationCallOrder[0]!).toBeLessThan(mocks.submitExternalClaim.mock.invocationCallOrder[0]!);
    });

    it('chưa có SĐT và khách từ chối chia sẻ: không gửi mã, có câu giải thích và nút Chia sẻ số điện thoại', async () => {
      mocks.user = { phone: null };
      mocks.ensurePhone.mockResolvedValue(null);
      renderPage();
      await typeCode();
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('cho phép Tubu xem số điện thoại');
      expect(screen.getByRole('button', { name: 'Chia sẻ số điện thoại' })).toBeInTheDocument();
      expect(mocks.submitExternalClaim).not.toHaveBeenCalled();
    });

    it('đã có SĐT: gửi thẳng, không xin lại', async () => {
      mocks.submitExternalClaim.mockResolvedValue({
        status: 'SEARCHING', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x',
      });
      renderPage();
      await typeCode();
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
      await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(1));
      expect(mocks.ensurePhone).not.toHaveBeenCalled();
    });

    it('khách từ chối lần đầu rồi bấm nút Chia sẻ số điện thoại: có SĐT thì gửi luôn đúng mã đã nhập', async () => {
      mocks.user = { phone: null };
      mocks.ensurePhone.mockResolvedValueOnce(null).mockResolvedValueOnce('0901234567');
      mocks.submitExternalClaim.mockResolvedValue({
        status: 'SEARCHING', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x',
      });
      renderPage();
      await typeCode();
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ số điện thoại' }));
      await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(1));
      expect(mocks.submitExternalClaim).toHaveBeenCalledWith('SPXVN123456789');
      expect(mocks.ensurePhone).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Chia sẻ số điện thoại' })).toBeNull());
    });

    it('bấm Tích điểm hai lần trong lúc đang xin SĐT: chỉ xin một lần và gửi mã một lần', async () => {
      mocks.user = { phone: null };
      let grant!: (v: string) => void;
      mocks.ensurePhone.mockReturnValue(new Promise<string>((r) => { grant = r; }));
      mocks.submitExternalClaim.mockResolvedValue({
        status: 'SEARCHING', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x',
      });
      renderPage();
      await typeCode();
      const button = screen.getByRole('button', { name: 'Tích điểm' });
      fireEvent.click(button);
      fireEvent.click(button);
      await act(async () => { grant('0901234567'); });
      await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(1));
      expect(mocks.ensurePhone).toHaveBeenCalledTimes(1);
    });

    it('máy chủ trả NOT_ELIGIBLE_USER dù app tưởng đã có SĐT chưa lưu: hiện nút chia sẻ, bấm xong gửi lại đúng mã', async () => {
      mocks.user = { phone: null };
      mocks.ensurePhone.mockResolvedValue('0901234567');
      mocks.submitExternalClaim
        .mockRejectedValueOnce(Object.assign(new Error('x'), { isAxiosError: true, response: { status: 403, data: { code: 'NOT_ELIGIBLE_USER' } } }))
        .mockResolvedValueOnce({
          status: 'SEARCHING', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x',
        });
      renderPage();
      await typeCode();
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
      const share = await screen.findByRole('button', { name: 'Chia sẻ số điện thoại' });
      expect(await screen.findByRole('alert')).toHaveTextContent('cho phép Tubu xem số điện thoại');
      fireEvent.click(share);
      await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(2));
      expect(mocks.submitExternalClaim).toHaveBeenLastCalledWith('SPXVN123456789');
    });
  });

  it('mã trống: nhắc nhập, không gọi API', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tích điểm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bạn nhập mã vận đơn trước nhé.');
    expect(mocks.submitExternalClaim).not.toHaveBeenCalled();
  });

  it('quét được: điền mã vào ô; quét lỗi: gợi ý nhập tay', async () => {
    renderPage();
    const input = (await screen.findByLabelText('Mã vận đơn hoặc mã đơn trên sàn')) as HTMLInputElement;
    mocks.scanCode.mockResolvedValueOnce({ kind: 'ok', content: 'SPXVN999999999' });
    fireEvent.click(screen.getByRole('button', { name: 'Quét mã' }));
    await waitFor(() => expect(input.value).toBe('SPXVN999999999'));
    mocks.scanCode.mockResolvedValueOnce({ kind: 'failed' });
    fireEvent.click(screen.getByRole('button', { name: 'Quét mã' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bạn nhập mã bằng tay');
    mocks.scanCode.mockResolvedValueOnce({ kind: 'ok', content: 'SPXVN111111111' });
    fireEvent.click(screen.getByRole('button', { name: 'Quét mã' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    mocks.scanCode.mockResolvedValueOnce({ kind: 'cancelled' });
    fireEvent.click(screen.getByRole('button', { name: 'Quét mã' }));
    await waitFor(() => expect(mocks.scanCode).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('danh sách: trạng thái, điểm, mốc cộng và phân trang', async () => {
    const future = futureIso();
    const item = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
      id, channel: 'Lazada', maskedCode: `LZ***${id}`, state, points: 500, expectedCreditAt: null, creditedAt: null, createdAt: '2026-10-01T00:00:00.000Z', ...extra,
    });
    mocks.getMyExternalClaims.mockImplementation(async (page: number) =>
      page === 1
        ? {
            data: [
              item('1', 'PENDING'),
              item('2', 'PENDING', { expectedCreditAt: future }),
              item('3', 'CREDITED', { creditedAt: '2026-10-20T05:00:00.000Z' }),
              item('4', 'VOIDED'),
              item('5', 'REVIEW', { points: null }),
            ],
            meta: { page: 1, limit: 10, total: 12 },
            searching: [{ maskedCode: 'SPX***000', createdAt: '2026-10-17T00:00:00.000Z' }],
          }
        : { data: [item('6', 'CREDITED')], meta: { page: 2, limit: 10, total: 12 }, searching: [] },
    );
    renderPage();
    expect(await screen.findByText('Chờ giao hàng')).toBeInTheDocument();
    expect(screen.getByText('Chờ cộng điểm')).toBeInTheDocument();
    expect(screen.getByText(`Dự kiến ${formatDate(future)}`)).toBeInTheDocument();
    expect(screen.getByText('Đã cộng 20/10/2026')).toBeInTheDocument();
    expect(screen.getByText('Đã huỷ')).toBeInTheDocument();
    expect(screen.getByText('Đang kiểm tra')).toBeInTheDocument();
    expect(screen.getByText('Điểm chưa tính được')).toBeInTheDocument();
    expect(screen.getByText('Đang tìm đơn')).toBeInTheDocument();
    expect(screen.getByText('Trang 1/2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sau' }));
    expect(await screen.findByText('LZ***6')).toBeInTheDocument();
    expect(screen.getByText('Trang 2/2')).toBeInTheDocument();
  });

  it('gửi lại mã đã được cộng: mốc đã qua thì dùng câu của API, không hứa "đang chờ cộng"', async () => {
    mocks.submitExternalClaim.mockResolvedValue({
      status: 'CLAIMED', claimId: 'c1', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250,
      expectedCreditAt: '2026-01-05T05:00:00.000Z', message: 'Mã này đã được tích điểm cho bạn rồi.',
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Mã vận đơn hoặc mã đơn trên sàn'), { target: { value: 'SPXVN123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    const result = await screen.findByTestId('claim-result');
    expect(result).toHaveTextContent('Mã này đã được tích điểm cho bạn rồi.');
    expect(result).not.toHaveTextContent('đang chờ cộng');
    expect(result).not.toHaveTextContent('Dự kiến cộng từ');
  });

  it('đang tìm đơn: icon đồng hồ, không phải dấu tích', async () => {
    mocks.submitExternalClaim.mockResolvedValue({
      status: 'SEARCHING', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x',
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Mã vận đơn hoặc mã đơn trên sàn'), { target: { value: 'SPXVN123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    const result = await screen.findByTestId('claim-result');
    expect(result.querySelector('.lucide-clock')).not.toBeNull();
    expect(result.querySelector('.lucide-circle-check, .lucide-check-circle-2')).toBeNull();
  });

  it('mã đang được tài khoản khác chờ: đúng câu CSKH, icon thông tin, không spinner đang tìm, không "Đã ghi nhận"', async () => {
    mocks.submitExternalClaim.mockResolvedValue({
      status: 'CLAIMED_BY_OTHER', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x',
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Mã vận đơn hoặc mã đơn trên sàn'), { target: { value: 'SPXVN123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    const result = await screen.findByTestId('claim-result');
    expect(result).toHaveTextContent('Mã này đang được một tài khoản khác dùng để tích điểm. Nếu đây là đơn của bạn, liên hệ CSKH.');
    expect(result).not.toHaveTextContent('Chưa thấy đơn này');
    expect(result).not.toHaveTextContent('Đã ghi nhận');
    expect(result.querySelector('.lucide-info')).not.toBeNull();
    expect(result.querySelector('.lucide-clock')).toBeNull();
  });

  it('claim đã huỷ, thu hồi, hết hạn: điểm nhạt và gạch ngang, không dùng màu thương hiệu', async () => {
    const mk = (id: string, state: string) => ({ id, channel: 'Lazada', maskedCode: `LZ***${id}`, state, points: 500, expectedCreditAt: null, creditedAt: null, createdAt: '2026-10-01T00:00:00.000Z' });
    mocks.getMyExternalClaims.mockResolvedValue({ data: [mk('1', 'VOIDED'), mk('2', 'REVERSED'), mk('3', 'LAPSED'), mk('4', 'CREDITED')], meta: { page: 1, limit: 10, total: 4 }, searching: [] });
    renderPage();
    const points = await screen.findAllByText('500 Điểm Xanh');
    expect(points).toHaveLength(4);
    expect(points.slice(0, 3).every((p) => p.style.textDecoration === 'line-through')).toBe(true);
    expect(points[3]!.style.textDecoration).toBe('');
    expect(points[0]!.style.color).not.toBe(points[3]!.style.color);
  });

  it('claimStateView: REVERSED và LAPSED có nhãn riêng', () => {
    expect(claimStateView({ state: 'REVERSED', expectedCreditAt: null }).label).toBe('Đã thu hồi');
    expect(claimStateView({ state: 'LAPSED', expectedCreditAt: null }).label).toBe('Hết hạn');
  });

  it('giờ giả sau 05/11/2026: mốc tương lai tính theo giờ giả vẫn hiện "Dự kiến cộng", không tự hỏng theo lịch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-01T03:00:00.000Z'));
    try {
      const future = futureIso();
      mocks.submitExternalClaim.mockResolvedValue({
        status: 'CLAIMED', claimId: 'c1', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250, expectedCreditAt: future, message: 'ok',
      });
      renderPage();
      fireEvent.change(await screen.findByLabelText('Mã vận đơn hoặc mã đơn trên sàn'), { target: { value: 'SPXVN123456789' } });
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
      const result = await screen.findByTestId('claim-result');
      expect(result).toHaveTextContent('1.250 Điểm Xanh đang chờ cộng');
      expect(result).toHaveTextContent(`Dự kiến cộng từ ${formatDate(future)}`);
    } finally {
      vi.useRealTimers();
    }
  });
});
