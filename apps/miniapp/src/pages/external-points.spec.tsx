import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicConfig: vi.fn(),
  submitExternalClaim: vi.fn(),
  getMyExternalClaims: vi.fn(),
  scanCode: vi.fn(),
  navigate: vi.fn(),
  search: '',
  hasOA: true,
  openOAChat: vi.fn(),
  followOA: vi.fn(),
  requestNotifyPermission: vi.fn(),
  getOaPromptState: vi.fn(),
  setOaPromptState: vi.fn(),
  trackEvent: vi.fn(),
  phase: 'authenticated' as string,
  user: { phone: '0901234567' } as { phone?: string | null } | null,
  ensurePhone: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/points/scan', search: mocks.search, state: null }),
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
vi.mock('../services/zmp-bridge', () => ({
  scanCode: mocks.scanCode,
  get hasOA() {
    return mocks.hasOA;
  },
  openOAChat: mocks.openOAChat,
  followOA: mocks.followOA,
  requestNotifyPermission: mocks.requestNotifyPermission,
  getOaPromptState: mocks.getOaPromptState,
  setOaPromptState: mocks.setOaPromptState,
}));
vi.mock('../services/analytics', () => ({ trackEvent: mocks.trackEvent }));
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

import ExternalPointsPage, { cardEntryOf, claimStateView } from './external-points';
import { __resetEntrySourceForTest } from '../utils/entry-source';
import { setCardGiftNote } from '../services/card-gift-note';
import { formatDate } from '../utils/format';

// Mốc tương lai tính từ giờ chạy test, để ca "mốc chưa qua" không tự hỏng khi đồng hồ đi qua một ngày cố định.
const futureIso = () => new Date(Date.now() + 7 * 864e5).toISOString();

const LOYALTY = { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000, marketplaceEarnPct: 1, marketplaceClaimEnabled: true };
const EMPTY_LIST = { data: [], meta: { page: 1, limit: 10, total: 0 }, searching: [] };

function rejection(code: string) {
  return Object.assign(new Error('x'), { isHttpError: true, response: { status: 409, data: { code, message: 'máy chủ' } } });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ExternalPointsPage /></QueryClientProvider>);
}

describe('Trang Tích điểm đơn sàn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase = 'authenticated';
    mocks.search = '';
    mocks.hasOA = true;
    mocks.getOaPromptState.mockResolvedValue({ promptSeen: true, followed: false });
    mocks.setOaPromptState.mockResolvedValue(undefined);
    mocks.requestNotifyPermission.mockResolvedValue(true);
    window.history.replaceState({}, '', '/points/scan');
    __resetEntrySourceForTest();
    setCardGiftNote(null);
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
    expect(screen.getByLabelText('Hoặc nhập mã vận đơn')).toBeInTheDocument();
    expect(await screen.findByText('Bạn chưa tích điểm đơn sàn nào.')).toBeInTheDocument();
  });

  it('gửi mã thành công: hiện sàn, điểm chờ và mốc dự kiến, tải lại danh sách', async () => {
    const future = futureIso();
    mocks.submitExternalClaim.mockResolvedValue({
      status: 'CLAIMED', claimId: 'c1', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250,
      expectedCreditAt: future, message: 'ok',
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: ' spxvn123456789 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    const result = await screen.findByTestId('claim-result');
    expect(mocks.submitExternalClaim).toHaveBeenCalledWith('spxvn123456789', 'typed');
    expect(result).toHaveTextContent('Đã ghi nhận đơn Shopee SPX***789');
    expect(result).toHaveTextContent('1.250 Điểm Xanh đang chờ cộng');
    expect(result).toHaveTextContent(`Dự kiến cộng từ ${formatDate(future)}`);
    await waitFor(() => expect(mocks.getMyExternalClaims.mock.calls.length).toBeGreaterThan(1));
  });

  it('lỗi theo code: hiện câu tiếng Việt của app, không in message máy chủ', async () => {
    mocks.submitExternalClaim.mockRejectedValue(rejection('ALREADY_CLAIMED'));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: 'SPXVN123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mã này đã được dùng để tích điểm trước đó.');
    expect(screen.queryByText('máy chủ')).toBeNull();
    expect(screen.queryByTestId('claim-result')).toBeNull();
  });

  describe('khách chưa chia sẻ số điện thoại (D14-01)', () => {
    const typeCode = async (value = 'SPXVN123456789') => {
      fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value } });
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
      await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledWith('SPXVN123456789', 'typed'));
      expect(mocks.ensurePhone).toHaveBeenCalledTimes(1);
      expect(mocks.ensurePhone.mock.invocationCallOrder[0]!).toBeLessThan(mocks.submitExternalClaim.mock.invocationCallOrder[0]!);
    });

    it('chưa có SĐT: câu giải thích hiện sẵn ngay dưới nút quét, TRƯỚC khi xin', async () => {
      mocks.user = { phone: null };
      renderPage();
      expect(await screen.findByText('Tubu dùng số điện thoại Zalo của bạn để ghép đúng đơn và báo khi điểm được cộng.')).toBeInTheDocument();
      expect(mocks.ensurePhone).not.toHaveBeenCalled();
    });

    it('đã có SĐT: không hiện câu giải thích', async () => {
      renderPage();
      await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      expect(screen.queryByText(/Tubu dùng số điện thoại Zalo/)).toBeNull();
    });

    it('khách từ chối chia sẻ: không gửi mã, giữ mã đã nhập, câu trung tính (không phải lỗi đỏ) và nút Chia sẻ số điện thoại', async () => {
      mocks.user = { phone: null };
      mocks.ensurePhone.mockResolvedValue(null);
      renderPage();
      await typeCode();
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
      expect(await screen.findByTestId('phone-declined')).toHaveTextContent('Mã bạn nhập vẫn được giữ');
      expect(screen.queryByRole('alert')).toBeNull();
      expect((screen.getByLabelText('Hoặc nhập mã vận đơn') as HTMLInputElement).value).toBe('SPXVN123456789');
      expect(screen.getByRole('button', { name: 'Chia sẻ số điện thoại' })).toBeInTheDocument();
      expect(mocks.submitExternalClaim).not.toHaveBeenCalled();
      expect(mocks.trackEvent).toHaveBeenCalledWith('ext_claim_phone', 'miniapp', { result: 'denied' });
    });

    it('khách đồng ý chia sẻ: ghi ext_claim_phone granted', async () => {
      mocks.user = { phone: null };
      mocks.ensurePhone.mockResolvedValue('0901234567');
      mocks.submitExternalClaim.mockResolvedValue({
        status: 'SEARCHING', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x',
      });
      renderPage();
      await typeCode();
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
      await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalled());
      expect(mocks.trackEvent).toHaveBeenCalledWith('ext_claim_phone', 'miniapp', { result: 'granted' });
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
      expect(mocks.submitExternalClaim).toHaveBeenCalledWith('SPXVN123456789', 'typed');
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
        .mockRejectedValueOnce(Object.assign(new Error('x'), { isHttpError: true, response: { status: 403, data: { code: 'NOT_ELIGIBLE_USER' } } }))
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
      expect(mocks.submitExternalClaim).toHaveBeenLastCalledWith('SPXVN123456789', 'typed');
    });
  });

  it('tài khoản đã có SĐT mà máy chủ vẫn trả NOT_ELIGIBLE_USER (bị khoá): nói chưa đủ điều kiện, mời liên hệ CSKH, không bảo chia sẻ SĐT', async () => {
    mocks.user = { phone: '0901234567' };
    mocks.submitExternalClaim.mockRejectedValue(rejection('NOT_ELIGIBLE_USER'));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: 'SPXVN123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/chưa đủ điều kiện/);
    expect(alert).toHaveTextContent(/CSKH/);
    expect(alert).not.toHaveTextContent('cho phép Tubu xem số điện thoại');
    expect(screen.queryByRole('button', { name: 'Chia sẻ số điện thoại' })).toBeNull();
  });

  it('mã trống: nhắc nhập, không gọi API', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tích điểm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bạn nhập mã vận đơn trước nhé.');
    expect(mocks.submitExternalClaim).not.toHaveBeenCalled();
  });

  describe('quét mã trên nhãn', () => {
    const SEARCHING = { status: 'SEARCHING', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x' };
    const scanBtn = () => screen.getByRole('button', { name: 'Quét mã trên nhãn' });

    it('nút quét là nút chính ở đầu thẻ, nút Tích điểm là nút phụ nằm sau ô nhập', async () => {
      renderPage();
      const scan = await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      const input = screen.getByLabelText('Hoặc nhập mã vận đơn');
      const submitBtn = screen.getByRole('button', { name: 'Tích điểm' });
      expect(scan.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(input.compareDocumentPosition(submitBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(scan.className).not.toMatch(/secondary/);
    });

    it.each([
      ['mã trần', 'SPXVN999999999', 'SPXVN999999999'],
      ['có gạch nối', 'spx-vn-999999999', 'SPXVN999999999'],
      ['URL chứa mã', 'https://spx.vn/track?tracking_number=SPXVN999999999', 'SPXVN999999999'],
      ['JSON', '{"tracking":"SPXVN999999999"}', 'SPXVN999999999'],
    ])('quét %s: điền mã vào ô, chưa gửi; bấm Tích điểm một lần mới gửi với via=scan', async (_n, content, code) => {
      mocks.scanCode.mockResolvedValue({ kind: 'ok', content });
      mocks.submitExternalClaim.mockResolvedValue(SEARCHING);
      renderPage();
      await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      fireEvent.click(scanBtn());
      await waitFor(() => expect((screen.getByLabelText('Hoặc nhập mã vận đơn') as HTMLInputElement).value).toBe(code));
      expect(mocks.submitExternalClaim).not.toHaveBeenCalled();
      const submitBtn = screen.getByRole('button', { name: 'Tích điểm' });
      expect(submitBtn.className).not.toMatch(/secondary/);
      await waitFor(() => expect(document.activeElement).toBe(submitBtn));
      fireEvent.click(submitBtn);
      await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledWith(code, 'scan'));
      expect(mocks.trackEvent).toHaveBeenCalledWith('ext_claim_scan', 'miniapp', { result: 'ok', parsed: 'code' });
    });

    it('sửa mã sau khi quét thì gửi với via=typed', async () => {
      mocks.scanCode.mockResolvedValue({ kind: 'ok', content: 'SPXVN999999999' });
      mocks.submitExternalClaim.mockResolvedValue(SEARCHING);
      renderPage();
      await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      fireEvent.click(scanBtn());
      const input = (await screen.findByLabelText('Hoặc nhập mã vận đơn')) as HTMLInputElement;
      await waitFor(() => expect(input.value).toBe('SPXVN999999999'));
      fireEvent.change(input, { target: { value: 'SPXVN888888888' } });
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
      await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledWith('SPXVN888888888', 'typed'));
    });

    it('link thẻ Tubu có kèm code=: điền sẵn mã, không gửi', async () => {
      mocks.scanCode.mockResolvedValue({ kind: 'ok', content: 'https://zalo.me/s/2070857098114207963/points/scan?src=shopee&card=2611&code=SPXVN999999999' });
      renderPage();
      await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      fireEvent.click(scanBtn());
      await waitFor(() => expect((screen.getByLabelText('Hoặc nhập mã vận đơn') as HTMLInputElement).value).toBe('SPXVN999999999'));
      expect(mocks.submitExternalClaim).not.toHaveBeenCalled();
    });

    it('scanCode ném lỗi: báo gợi ý nhập tay, không văng', async () => {
      mocks.scanCode.mockRejectedValue(new Error('boom'));
      renderPage();
      await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      fireEvent.click(scanBtn());
      expect(await screen.findByRole('alert')).toHaveTextContent('Bạn nhập mã bằng tay');
    });

    it('quét phải link của chính thẻ Tubu: báo quét mã vạch trên nhãn, không gửi', async () => {
      mocks.scanCode.mockResolvedValue({ kind: 'ok', content: 'https://zalo.me/s/2070857098114207963/points/scan?src=shopee&card=2611' });
      renderPage();
      await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      fireEvent.click(scanBtn());
      expect(await screen.findByRole('alert')).toHaveTextContent('Đây là mã trên thẻ Tubu. Bạn quét mã vạch trên nhãn dán ngoài hộp nhé.');
      expect(mocks.submitExternalClaim).not.toHaveBeenCalled();
      expect(mocks.trackEvent).toHaveBeenCalledWith('ext_claim_scan', 'miniapp', { result: 'ok', parsed: 'card_link' });
    });

    it('quét ra nội dung không có mã: đổ vào ô, báo, không gửi', async () => {
      mocks.scanCode.mockResolvedValue({ kind: 'ok', content: 'https://example.com/about' });
      renderPage();
      await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      fireEvent.click(scanBtn());
      expect(await screen.findByRole('alert')).toHaveTextContent('Chưa tìm thấy mã vận đơn');
      expect((screen.getByLabelText('Hoặc nhập mã vận đơn') as HTMLInputElement).value).toBe('https://example.com/about');
      expect(mocks.submitExternalClaim).not.toHaveBeenCalled();
      expect(mocks.trackEvent).toHaveBeenCalledWith('ext_claim_scan', 'miniapp', { result: 'ok', parsed: 'url' });
    });

    it('quét lỗi: gợi ý nhập tay; khách đóng camera: im lặng; cả hai ghi sự kiện', async () => {
      renderPage();
      await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      mocks.scanCode.mockResolvedValueOnce({ kind: 'failed' });
      fireEvent.click(scanBtn());
      expect(await screen.findByRole('alert')).toHaveTextContent('Bạn nhập mã bằng tay');
      expect(mocks.trackEvent).toHaveBeenCalledWith('ext_claim_scan', 'miniapp', { result: 'failed', parsed: 'none' });
      mocks.scanCode.mockResolvedValueOnce({ kind: 'cancelled' });
      fireEvent.click(scanBtn());
      await waitFor(() => expect(mocks.scanCode).toHaveBeenCalledTimes(2));
      expect(mocks.trackEvent).toHaveBeenCalledWith('ext_claim_scan', 'miniapp', { result: 'cancelled', parsed: 'none' });
      expect(mocks.submitExternalClaim).not.toHaveBeenCalled();
    });

    it('quét xong khi chưa có SĐT mà khách từ chối: mã đã quét được giữ trong ô', async () => {
      mocks.user = { phone: null };
      mocks.ensurePhone.mockResolvedValue(null);
      mocks.scanCode.mockResolvedValue({ kind: 'ok', content: 'SPXVN999999999' });
      renderPage();
      await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      fireEvent.click(scanBtn());
      await waitFor(() => expect((screen.getByLabelText('Hoặc nhập mã vận đơn') as HTMLInputElement).value).toBe('SPXVN999999999'));
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
      expect(await screen.findByTestId('phone-declined')).toBeInTheDocument();
      expect((screen.getByLabelText('Hoặc nhập mã vận đơn') as HTMLInputElement).value).toBe('SPXVN999999999');
      expect(mocks.submitExternalClaim).not.toHaveBeenCalled();
    });
  });

  describe('vào từ thẻ trong hộp hàng', () => {
    const openFromCard = (qs: string) => {
      window.history.replaceState({}, '', `/points/scan?${qs}`);
      __resetEntrySourceForTest();
    };

    it('lời chào theo sàn và ba bước; nút chính vẫn là quét', async () => {
      openFromCard('src=shopee&card=2611');
      renderPage();
      const welcome = await screen.findByTestId('card-welcome');
      expect(welcome).toHaveTextContent('Cảm ơn bạn đã mua Tubu Tree trên Shopee');
      expect(welcome).toHaveTextContent('Quét mã trên nhãn dán ngoài hộp');
      expect(welcome).toHaveTextContent('Nhận Điểm Xanh sau khi đơn giao thành công');
      expect(welcome).toHaveTextContent('1. Quét mã trên nhãn dán ngoài hộp');
      expect(welcome).toHaveTextContent('3. Nhận Điểm Xanh');
      expect(screen.getByRole('button', { name: 'Quét mã trên nhãn' })).toBeInTheDocument();
    });

    it('thẻ chung không rõ sàn (src=san): lời chào không nêu sàn', async () => {
      openFromCard('src=san&card=2611');
      renderPage();
      expect(await screen.findByTestId('card-welcome')).toHaveTextContent(/^Cảm ơn bạn đã mua Tubu Tree/);
      expect(screen.getByTestId('card-welcome')).not.toHaveTextContent('Tubu Tree trên');
    });

    it('mở thẳng không qua thẻ: không có lời chào', async () => {
      renderPage();
      await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      expect(screen.queryByTestId('card-welcome')).toBeNull();
    });

    it('?code= điền sẵn vào ô (chuẩn hoá) và KHÔNG tự gửi', async () => {
      mocks.search = '?src=shopee&card=2611&code=spx-vn-123456789';
      renderPage();
      const input = (await screen.findByLabelText('Hoặc nhập mã vận đơn')) as HTMLInputElement;
      expect(input.value).toBe('SPXVN123456789');
      const btn = screen.getByRole('button', { name: 'Tích điểm' });
      expect(btn.className).not.toMatch(/secondary/);
      await new Promise((r) => setTimeout(r, 30));
      expect(mocks.submitExternalClaim).not.toHaveBeenCalled();
      mocks.submitExternalClaim.mockResolvedValue({ status: 'SEARCHING', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x' });
      fireEvent.click(btn);
      await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledWith('SPXVN123456789', 'scan'));
    });

    it.each(['%ZZ', '%E0%A4%A', '%'])('?code=%s hỏng mã hoá %%: trang vẫn dựng, ô để trống', async (bad) => {
      mocks.search = `?src=shopee&card=2611&code=${bad}`;
      renderPage();
      expect(((await screen.findByLabelText('Hoặc nhập mã vận đơn')) as HTMLInputElement).value).toBe('');
      expect(screen.getByRole('alert')).toHaveTextContent('chưa điền sẵn');
    });

    it('?code= là mã vạch hàng Việt Nam (893...): báo thay vì bỏ im lặng', async () => {
      mocks.search = '?code=8934673123457';
      renderPage();
      expect(((await screen.findByLabelText('Hoặc nhập mã vận đơn')) as HTMLInputElement).value).toBe('');
      expect(screen.getByRole('alert')).toHaveTextContent('chưa điền sẵn');
    });

    it('?code= đổi khi vẫn ở trang này (OpenApp cùng route): ô nhập theo mã mới', async () => {
      mocks.search = '?code=SPXVN111111111';
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const tree = <QueryClientProvider client={qc}><ExternalPointsPage /></QueryClientProvider>;
      const { rerender } = render(tree);
      const input = (await screen.findByLabelText('Hoặc nhập mã vận đơn')) as HTMLInputElement;
      expect(input.value).toBe('SPXVN111111111');
      mocks.search = '?code=SPXVN222222222';
      rerender(<QueryClientProvider client={qc}><ExternalPointsPage /></QueryClientProvider>);
      await waitFor(() => expect(input.value).toBe('SPXVN222222222'));
    });

    it('?code= sai dạng: bỏ qua, ô để trống', async () => {
      mocks.search = '?code=abc';
      renderPage();
      expect(((await screen.findByLabelText('Hoặc nhập mã vận đơn')) as HTMLInputElement).value).toBe('');
      expect(screen.getByRole('alert')).toHaveTextContent('chưa điền sẵn');
    });

    it('cờ tắt, config không có số ngày: câu "sắp mở" bỏ cụm số ngày', async () => {
      openFromCard('src=lazada&card=2611');
      mocks.getPublicConfig.mockResolvedValue({ loyalty: { ...LOYALTY, marketplaceClaimEnabled: false } });
      renderPage();
      const soon = await screen.findByTestId('claim-soon');
      expect(soon).toHaveTextContent('hãy quét lại thẻ để tích điểm cho đơn này');
      expect(soon).not.toHaveTextContent('ngày');
    });

    it('cờ tắt mà vào từ thẻ: trạng thái "sắp mở" có nút Xem sản phẩm và Về trang chủ, không có ô nhập', async () => {
      openFromCard('src=lazada&card=2611');
      mocks.getPublicConfig.mockResolvedValue({ loyalty: { ...LOYALTY, marketplaceClaimEnabled: false, marketplaceClaimMaxAgeDays: 45 } });
      renderPage();
      expect(await screen.findByText('Tích điểm đơn sàn sắp mở')).toBeInTheDocument();
      expect(screen.getByTestId('claim-soon')).toHaveTextContent('trong vòng 45 ngày kể từ ngày đặt đơn');
      expect(screen.queryByLabelText('Hoặc nhập mã vận đơn')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Xem sản phẩm' }));
      expect(mocks.navigate).toHaveBeenCalledWith('/browse');
      fireEvent.click(screen.getByRole('button', { name: 'Về trang chủ' }));
      expect(mocks.navigate).toHaveBeenLastCalledWith('/');
    });

    it('cờ tắt, vào không qua thẻ: vẫn có lối đi, chữ là "Chưa mở"', async () => {
      mocks.getPublicConfig.mockResolvedValue({ loyalty: { ...LOYALTY, marketplaceClaimEnabled: false } });
      renderPage();
      expect(await screen.findByText('Chưa mở')).toBeInTheDocument();
      expect(screen.getByTestId('claim-closed')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Về trang chủ' })).toBeInTheDocument();
    });

    it('quà thẻ "chỉ khách mới" bị từ chối: một dòng nhẹ, vẫn tích điểm được', async () => {
      renderPage();
      await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      expect(screen.queryByText(/Quà thẻ dành cho tài khoản chưa có đơn/)).toBeNull();
      act(() => setCardGiftNote('new-customers-only'));
      expect(await screen.findByText('Quà thẻ dành cho tài khoản chưa có đơn. Bạn vẫn tích điểm đơn này được.')).toBeInTheDocument();
    });
  });

  describe('mã đã bị tích: nhắn CSKH', () => {
    const typeAndSend = async (code = 'SPXVN123456789') => {
      fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: code } });
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    };

    it('ALREADY_CLAIMED có nút Nhắn Tubu Tree, bấm mở chat OA kèm mã đã che', async () => {
      mocks.submitExternalClaim.mockRejectedValue(rejection('ALREADY_CLAIMED'));
      renderPage();
      await typeAndSend();
      fireEvent.click(await screen.findByRole('button', { name: 'Nhắn Tubu Tree' }));
      expect(mocks.openOAChat).toHaveBeenCalledWith('Mình cần hỗ trợ tích điểm cho mã SPX***789');
    });

    it('ALREADY_CLAIMED thiếu ID OA: không có nút', async () => {
      mocks.hasOA = false;
      mocks.submitExternalClaim.mockRejectedValue(rejection('ALREADY_CLAIMED'));
      renderPage();
      await typeAndSend();
      await screen.findByRole('alert');
      expect(screen.queryByRole('button', { name: 'Nhắn Tubu Tree' })).toBeNull();
    });

    it('CLAIMED_BY_OTHER có nút Nhắn Tubu Tree kèm mã che của máy chủ', async () => {
      mocks.submitExternalClaim.mockResolvedValue({
        status: 'CLAIMED_BY_OTHER', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x',
      });
      renderPage();
      await typeAndSend();
      fireEvent.click(await screen.findByRole('button', { name: 'Nhắn Tubu Tree' }));
      expect(mocks.openOAChat).toHaveBeenCalledWith('Mình cần hỗ trợ tích điểm cho mã SPX***789');
    });

    it('lỗi khác (đơn đã huỷ) không có nút nhắn', async () => {
      mocks.submitExternalClaim.mockRejectedValue(rejection('CLOSED'));
      renderPage();
      await typeAndSend();
      await screen.findByRole('alert');
      expect(screen.queryByRole('button', { name: 'Nhắn Tubu Tree' })).toBeNull();
    });
  });

  describe('mời theo dõi OA sau khi ghi nhận', () => {
    const CLAIMED = { status: 'CLAIMED', claimId: 'c1', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250, expectedCreditAt: null, message: 'ok' };
    const send = async () => {
      fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: 'SPXVN123456789' } });
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    };

    it('chưa từng hỏi: hiện lời mời không treo thưởng; Theo dõi gọi followOA, xin quyền thông báo, ghi cờ đã hỏi và sự kiện', async () => {
      mocks.getOaPromptState.mockResolvedValue({ promptSeen: false, followed: false });
      mocks.followOA.mockResolvedValue(true);
      mocks.submitExternalClaim.mockResolvedValue(CLAIMED);
      renderPage();
      await send();
      const invite = await screen.findByTestId('oa-invite');
      expect(invite).toHaveTextContent('Theo dõi Tubu Tree trên Zalo');
      expect(invite).not.toHaveTextContent(/thưởng|tặng|nhận .* điểm/i);
      fireEvent.click(screen.getByRole('button', { name: 'Theo dõi' }));
      await waitFor(() => expect(mocks.setOaPromptState).toHaveBeenCalledWith({ promptSeen: true, followed: true }));
      expect(mocks.requestNotifyPermission).toHaveBeenCalledTimes(1);
      expect(mocks.trackEvent).toHaveBeenCalledWith('oa_follow_result', 'miniapp', { placement: 'points_scan', result: 'followed' });
      await waitFor(() => expect(screen.queryByTestId('oa-invite')).toBeNull());
      expect(screen.getByText('Đã theo dõi Tubu Tree trên Zalo.')).toBeInTheDocument();
    });

    it('Zalo từ chối theo dõi: ghi declined, báo nhẹ, không xin quyền thông báo', async () => {
      mocks.getOaPromptState.mockResolvedValue({ promptSeen: false, followed: false });
      mocks.followOA.mockResolvedValue(false);
      mocks.submitExternalClaim.mockResolvedValue(CLAIMED);
      renderPage();
      await send();
      await screen.findByTestId('oa-invite');
      fireEvent.click(screen.getByRole('button', { name: 'Theo dõi' }));
      await waitFor(() => expect(mocks.trackEvent).toHaveBeenCalledWith('oa_follow_result', 'miniapp', { placement: 'points_scan', result: 'declined' }));
      expect(mocks.requestNotifyPermission).not.toHaveBeenCalled();
      expect(await screen.findByText(/Chưa theo dõi được lúc này/)).toBeInTheDocument();
    });

    it('Để sau: ghi dismissed và đánh dấu đã hỏi để không hỏi lại', async () => {
      mocks.getOaPromptState.mockResolvedValue({ promptSeen: false, followed: false });
      mocks.submitExternalClaim.mockResolvedValue(CLAIMED);
      renderPage();
      await send();
      await screen.findByTestId('oa-invite');
      fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
      await waitFor(() => expect(mocks.setOaPromptState).toHaveBeenCalledWith({ promptSeen: true, followed: false }));
      expect(mocks.trackEvent).toHaveBeenCalledWith('oa_follow_result', 'miniapp', { placement: 'points_scan', result: 'dismissed' });
      expect(mocks.followOA).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByTestId('oa-invite')).toBeNull());
    });

    it('đã hỏi rồi (cờ trên máy): không hiện lại', async () => {
      mocks.submitExternalClaim.mockResolvedValue(CLAIMED);
      renderPage();
      await send();
      await screen.findByTestId('claim-result');
      expect(screen.queryByTestId('oa-invite')).toBeNull();
    });

    it('thiếu ID OA: không hiện lời mời', async () => {
      mocks.hasOA = false;
      mocks.getOaPromptState.mockResolvedValue({ promptSeen: false, followed: false });
      mocks.submitExternalClaim.mockResolvedValue(CLAIMED);
      renderPage();
      await send();
      await screen.findByTestId('claim-result');
      expect(screen.queryByTestId('oa-invite')).toBeNull();
    });

    it('đang tìm đơn (SEARCHING) chưa mời: lời mời chỉ sau khi ghi nhận', async () => {
      mocks.getOaPromptState.mockResolvedValue({ promptSeen: false, followed: false });
      mocks.submitExternalClaim.mockResolvedValue({ ...CLAIMED, status: 'SEARCHING', channel: null, points: null });
      renderPage();
      await send();
      await screen.findByTestId('claim-result');
      expect(screen.queryByTestId('oa-invite')).toBeNull();
    });
  });

  it('cardEntryOf: sàn, đợt thẻ hay link khác', () => {
    expect(cardEntryOf(null)).toEqual({ fromCard: false, channel: null });
    expect(cardEntryOf({ source: 'shopee', campaign: 'card-2611' })).toEqual({ fromCard: true, channel: 'Shopee' });
    expect(cardEntryOf({ source: 'tiktok' })).toEqual({ fromCard: true, channel: 'TikTok Shop' });
    expect(cardEntryOf({ source: 'card-2611' })).toEqual({ fromCard: true, channel: null });
    expect(cardEntryOf({ source: 'san', campaign: 'card-2611' })).toEqual({ fromCard: true, channel: null });
    expect(cardEntryOf({ source: 'oa' })).toEqual({ fromCard: false, channel: null });
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
    fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: 'SPXVN123456789' } });
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
    fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: 'SPXVN123456789' } });
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
    fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: 'SPXVN123456789' } });
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
      fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: 'SPXVN123456789' } });
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
      const result = await screen.findByTestId('claim-result');
      expect(result).toHaveTextContent('1.250 Điểm Xanh đang chờ cộng');
      expect(result).toHaveTextContent(`Dự kiến cộng từ ${formatDate(future)}`);
    } finally {
      vi.useRealTimers();
    }
  });
});
