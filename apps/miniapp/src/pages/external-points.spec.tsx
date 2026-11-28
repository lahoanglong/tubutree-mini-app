import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

const mocks = vi.hoisted(() => ({
  getPublicConfig: vi.fn(),
  submitExternalClaim: vi.fn(),
  retryExternalClaimPhone: vi.fn(),
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
  getLoyalty: vi.fn(),
  locState: null as unknown,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/points/scan', search: mocks.search, state: mocks.locState }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicConfig: mocks.getPublicConfig,
}));
vi.mock('../services/external-points-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  submitExternalClaim: mocks.submitExternalClaim,
  retryExternalClaimPhone: mocks.retryExternalClaimPhone,
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
vi.mock('../services/account-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLoyalty: mocks.getLoyalty,
}));
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
import { MARKETPLACE_CLAIM_COPY, PHONE_CONFIRM_COPY } from '@tubutree/app-core/marketplace-claim-copy';

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
    mocks.locState = null;
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0, pointsConvertedBalance: 0, pointsMarketplaceBalance: 0, lockedPoints: 0 });
  });

  describe('nút chính sau khi quét (W44 U2)', () => {
    const claimed = () =>
      mocks.submitExternalClaim.mockResolvedValue({
        status: 'CLAIMED', claimId: 'c1', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250,
        expectedCreditAt: futureIso(), message: 'ok',
      });
    const submit = async () => {
      fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: 'spxvn123456789' } });
      fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
      await screen.findByTestId('claim-result');
    };

    it('đang có 1.200 điểm dùng được: nút nói "đang có", khác số "đang chờ cộng" của đơn vừa quét', async () => {
      claimed();
      mocks.getLoyalty.mockResolvedValue({ pointsBalance: 1200, pointsConvertedBalance: 0, pointsMarketplaceBalance: 0, lockedPoints: 0 });
      renderPage();
      await submit();
      const cta = screen.getByTestId('scan-shop-now');
      await waitFor(() => expect(cta).toHaveTextContent('Dùng 1.200 Điểm Xanh đang có'));
      expect(screen.getByTestId('claim-result')).toHaveTextContent('1.250 Điểm Xanh đang chờ cộng');
    });

    it('chưa có điểm dùng được: mời mua sắm trên Mini App, không hứa điểm', async () => {
      claimed();
      renderPage();
      await submit();
      const cta = screen.getByTestId('scan-shop-now');
      await waitFor(() => expect(cta).toHaveTextContent('Mua sắm ngay trên Mini App'));
      expect(cta).not.toHaveTextContent('Điểm Xanh');
    });
  });

  describe('nút lùi khi vào từ trang con (W44 U3)', () => {
    const titleBox = async () => (await screen.findByText('Tích điểm đơn sàn', { selector: 'h1, h1 *' })).closest('div') as HTMLElement;

    it('vào bằng thanh đáy: tiêu đề sát lề, không chừa chỗ nút lùi', async () => {
      window.history.replaceState({ idx: 2 }, '', '/points/scan');
      renderPage();
      expect((await titleBox()).style.paddingLeft).toBe('0px');
    });

    it('PUSH từ trang sản phẩm, còn lịch sử: tiêu đề chừa chỗ cho nút lùi nổi', async () => {
      window.history.replaceState({ idx: 2 }, '', '/points/scan');
      mocks.locState = { from: '/product/dau-goi-buoi' };
      renderPage();
      expect((await titleBox()).style.paddingLeft).not.toBe('0px');
    });
  });

  it('cờ tắt: báo chưa mở, không có ô nhập', async () => {
    mocks.getPublicConfig.mockResolvedValue({ loyalty: { ...LOYALTY, marketplaceClaimEnabled: false } });
    renderPage();
    expect(await screen.findByText('Chưa mở')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tích điểm' })).toBeNull();
    expect(mocks.getMyExternalClaims).not.toHaveBeenCalled();
    // Tab giữa vẫn mở được màn này khi cờ tắt (W42): không hứa tỉ lệ tích cho tính năng chưa mở.
    expect(screen.queryByTestId('scan-guide')).toBeNull();
    expect(screen.queryByText(/giá trị đơn thành Điểm Xanh/)).toBeNull();
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Mã này đã tích điểm trước đó.');
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
      expect(await screen.findByText('Tubu dùng số điện thoại Zalo để ghép đơn và báo khi cộng điểm.')).toBeInTheDocument();
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
      expect(await screen.findByTestId('phone-declined')).toHaveTextContent('Mã vẫn được giữ');
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
      expect(await screen.findByRole('alert')).toHaveTextContent('cho phép xem số điện thoại');
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
    expect(alert).not.toHaveTextContent('cho phép xem số điện thoại');
    expect(screen.queryByRole('button', { name: 'Chia sẻ số điện thoại' })).toBeNull();
  });

  it('gõ tay mã hợp lệ thì nút Tích điểm thành nút chính; trống hoặc chưa đủ mã thì vẫn là nút phụ', async () => {
    renderPage();
    const input = await screen.findByLabelText('Hoặc nhập mã vận đơn');
    const submitBtn = () => screen.getByRole('button', { name: 'Tích điểm' });
    expect(submitBtn().className).toMatch(/secondary/);
    fireEvent.change(input, { target: { value: 'SPX12' } });
    expect(submitBtn().className).toMatch(/secondary/);
    fireEvent.change(input, { target: { value: 'spx-vn-123456789' } });
    expect(submitBtn().className).not.toMatch(/secondary/);
    fireEvent.change(input, { target: { value: '' } });
    expect(submitBtn().className).toMatch(/secondary/);
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
      expect(await screen.findByRole('alert')).toHaveTextContent('Đây là mã thẻ Tubu. Hãy quét mã vạch trên nhãn dán ngoài hộp nhé.');
      expect(mocks.submitExternalClaim).not.toHaveBeenCalled();
      expect(mocks.trackEvent).toHaveBeenCalledWith('ext_claim_scan', 'miniapp', { result: 'ok', parsed: 'card_link' });
    });

    it('quét ra nội dung không có mã: đổ vào ô, báo, không gửi', async () => {
      mocks.scanCode.mockResolvedValue({ kind: 'ok', content: 'https://example.com/about' });
      renderPage();
      await screen.findByRole('button', { name: 'Quét mã trên nhãn' });
      fireEvent.click(scanBtn());
      expect(await screen.findByRole('alert')).toHaveTextContent('không phải mã vận đơn');
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

    it('lời chào theo sàn; ba bước nằm ở hướng dẫn chung đầu màn (W42), không lặp trong lời chào; nút chính vẫn là quét', async () => {
      openFromCard('src=shopee&card=2611');
      renderPage();
      const welcome = await screen.findByTestId('card-welcome');
      expect(welcome).toHaveTextContent('Cảm ơn bạn đã mua Tubu Tree trên Shopee');
      expect(welcome).not.toHaveTextContent('1.');
      const guide = await screen.findByTestId('scan-guide');
      expect(guide).toHaveTextContent('Quét mã vận đơn Shopee, TikTok, Lazada');
      expect(guide.querySelectorAll('li')).toHaveLength(3);
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
      // Màn quét là tab gốc (W42): sang tab gốc khác thì thay mục lịch sử.
      fireEvent.click(screen.getByRole('button', { name: 'Xem sản phẩm' }));
      expect(mocks.navigate).toHaveBeenCalledWith('/browse', { replace: true });
      fireEvent.click(screen.getByRole('button', { name: 'Về trang chủ' }));
      expect(mocks.navigate).toHaveBeenLastCalledWith('/', { replace: true });
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
      expect(await screen.findByText('Quà thẻ dành cho tài khoản chưa có đơn. Đơn này vẫn tích điểm được.')).toBeInTheDocument();
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
    expect(result).toHaveTextContent('Mã này đang tích điểm cho tài khoản khác. Nếu là đơn của bạn, liên hệ CSKH nhé.');
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

describe('W78A: Tích điểm đơn sàn khoá đồng bộ chạm đúp', () => {
  const SEARCHING = { status: 'SEARCHING', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x' };
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const typeCode = async (value = 'SPXVN123456789') => {
    fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value } });
  };
  const submitBtn = () => screen.getByRole('button', { name: 'Tích điểm' });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase = 'authenticated';
    mocks.search = '';
    mocks.hasOA = false;
    mocks.getOaPromptState.mockResolvedValue({ promptSeen: true, followed: false });
    window.history.replaceState({}, '', '/points/scan');
    __resetEntrySourceForTest();
    setCardGiftNote(null);
    mocks.user = { phone: '0901234567' };
    mocks.getPublicConfig.mockResolvedValue({ loyalty: LOYALTY });
    mocks.getMyExternalClaims.mockResolvedValue(EMPTY_LIST);
  });

  it('chạm đúp "Tích điểm" trong cùng một khung hình chỉ gửi một lần; xong hiện kết quả một lần và làm mới danh sách một lần', async () => {
    const d = deferred<typeof SEARCHING>();
    mocks.submitExternalClaim.mockReturnValue(d.promise);
    renderPage();
    await typeCode();
    const btn = submitBtn();
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(1);
    expect(mocks.submitExternalClaim).toHaveBeenCalledWith('SPXVN123456789', 'typed');
    await waitFor(() => expect(submitBtn()).toHaveAttribute('aria-busy', 'true'));
    await act(async () => d.resolve(SEARCHING));
    expect(await screen.findAllByTestId('claim-result')).toHaveLength(1);
    await waitFor(() => expect(mocks.getMyExternalClaims).toHaveBeenCalledTimes(2));
  });

  it('chạm lần hai ngay sau lần một, trước khi nút kịp vẽ lại "đang gửi" (khoá của Button đã nhả): vẫn chỉ gửi một lần', async () => {
    const d = deferred<typeof SEARCHING>();
    mocks.submitExternalClaim.mockReturnValue(d.promise);
    renderPage();
    await typeCode();
    const btn = submitBtn();
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      await Promise.resolve();
      fireEvent.click(btn);
    });
    expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(SEARCHING));
    await screen.findByTestId('claim-result');
    expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(1);
  });

  it('mã từ quét QR: chạm lần hai sát lần một vẫn chỉ gửi một lần, via=scan', async () => {
    const d = deferred<typeof SEARCHING>();
    mocks.submitExternalClaim.mockReturnValue(d.promise);
    mocks.scanCode.mockResolvedValue({ kind: 'ok', content: 'SPXVN999999999' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Quét mã trên nhãn' }));
    await waitFor(() => expect((screen.getByLabelText('Hoặc nhập mã vận đơn') as HTMLInputElement).value).toBe('SPXVN999999999'));
    const btn = submitBtn();
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      await Promise.resolve();
      fireEvent.click(btn);
    });
    expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(1);
    expect(mocks.submitExternalClaim).toHaveBeenCalledWith('SPXVN999999999', 'scan');
    await act(async () => d.resolve(SEARCHING));
    await screen.findByTestId('claim-result');
  });

  it('"Tích điểm" và "Chia sẻ số điện thoại" cùng một khung hình, cả hai cùng chờ xin SĐT rồi cùng gửi mã: chỉ một lần gửi', async () => {
    mocks.user = { phone: null };
    mocks.ensurePhone.mockResolvedValueOnce(null);
    const d = deferred<typeof SEARCHING>();
    mocks.submitExternalClaim.mockReturnValue(d.promise);
    renderPage();
    await typeCode();
    fireEvent.click(submitBtn());
    const share = await screen.findByRole('button', { name: 'Chia sẻ số điện thoại' });
    const grant = deferred<string>();
    mocks.ensurePhone.mockReturnValue(grant.promise);
    await act(async () => {
      fireEvent.click(submitBtn());
      fireEvent.click(share);
    });
    expect(mocks.ensurePhone).toHaveBeenCalledTimes(3);
    await act(async () => grant.resolve('0901234567'));
    await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(1));
    await act(async () => d.resolve(SEARCHING));
    await screen.findByTestId('claim-result');
    expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(1);
  });

  it('lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
    const d = deferred<typeof SEARCHING>();
    mocks.submitExternalClaim.mockReturnValueOnce(d.promise);
    renderPage();
    await typeCode();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(submitBtn()).toHaveAttribute('aria-busy', 'true'));
    await act(async () => d.reject(rejection('ALREADY_CLAIMED')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mã này đã tích điểm trước đó.');
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy'));

    mocks.submitExternalClaim.mockResolvedValueOnce(SEARCHING);
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('claim-result')).toBeInTheDocument();
  });
});

// W113A: gửi mã bị máy chủ từ chối vì trạng thái đã đổi (400/404/409) thì giữ lời báo hiện có, tải lại danh sách yêu cầu và giữ khoá tới khi dữ liệu về (tối đa LOCK_REFRESH_WAIT_MS); mất mạng, quá hạn, 401, 5xx nhả ngay, không tải lại.
describe('W113A: Tích điểm đơn sàn giữ khoá tới khi danh sách yêu cầu làm mới về', () => {
  const SEARCHING = { status: 'SEARCHING', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'x' };
  const reject = (code: string, status: number) =>
    new HttpError('máy chủ', undefined, { status, data: { code, message: 'máy chủ' }, headers: {} });
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const submitBtn = () => screen.getByRole('button', { name: 'Tích điểm' });
  const renderLive = (refresh: () => Promise<unknown>) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(<QueryClientProvider client={qc}><ExternalPointsPage /></QueryClientProvider>);
    return invalidate;
  };
  const typeCode = async () => {
    fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: 'SPXVN123456789' } });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitExternalClaim.mockReset();
    mocks.phase = 'authenticated';
    mocks.search = '';
    mocks.hasOA = false;
    mocks.getOaPromptState.mockResolvedValue({ promptSeen: true, followed: false });
    window.history.replaceState({}, '', '/points/scan');
    __resetEntrySourceForTest();
    setCardGiftNote(null);
    mocks.user = { phone: '0901234567' };
    mocks.getPublicConfig.mockResolvedValue({ loyalty: LOYALTY });
    mocks.getMyExternalClaims.mockResolvedValue(EMPTY_LIST);
  });

  it.each([400, 404, 409])('bị từ chối %i: giữ lời báo theo mã, tải lại danh sách yêu cầu, khoá giữ tới khi dữ liệu về', async (status) => {
    mocks.submitExternalClaim.mockRejectedValueOnce(reject('ALREADY_CLAIMED', status)).mockResolvedValue(SEARCHING);
    const refresh = deferred();
    const invalidate = renderLive(() => refresh.promise);
    await typeCode();
    fireEvent.click(submitBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent('Mã này đã tích điểm trước đó.');
    expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['external-claims'] }]);
    expect(submitBtn()).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(submitBtn());
      fireEvent.click(submitBtn());
    });
    expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve());
    await settle();
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy'));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ])('%s: báo lỗi, nhả khoá ngay, không tải lại danh sách', async (_label, error) => {
    mocks.submitExternalClaim.mockRejectedValueOnce(error).mockResolvedValue(SEARCHING);
    const invalidate = renderLive(() => new Promise(() => undefined));
    await typeCode();
    fireEvent.click(submitBtn());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy'));
    expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(2));
  });

  it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
    mocks.submitExternalClaim.mockRejectedValueOnce(reject('ALREADY_CLAIMED', 409)).mockResolvedValue(SEARCHING);
    renderLive(() => new Promise(() => undefined));
    await typeCode();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(submitBtn());
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(submitBtn()).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy'));
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(2));
  });
});

describe('Trang Tích điểm đơn sàn — W46: xác nhận 4 số cuối SĐT người nhận, gập hướng dẫn', () => {
  const confirmRejection = (code: string, status: number, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error('x'), { isHttpError: true, response: { status, data: { code, message: 'máy chủ', requiredDigits: 4, ...extra } } });
  const CLAIMED = { status: 'CLAIMED', claimId: 'c1', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250, expectedCreditAt: futureIso(), message: 'ok' };
  const typeAndSend = async () => {
    fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: 'SPXVN123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
  };
  const last4 = () => screen.getByTestId('phone-confirm-input') as HTMLInputElement;
  const confirmWith = async (digits: string) => {
    fireEvent.change(last4(), { target: { value: digits } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận & Tích điểm' }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase = 'authenticated';
    mocks.search = '';
    mocks.hasOA = true;
    mocks.getOaPromptState.mockResolvedValue({ promptSeen: true, followed: false });
    mocks.setOaPromptState.mockResolvedValue(undefined);
    window.history.replaceState({}, '', '/points/scan');
    __resetEntrySourceForTest();
    setCardGiftNote(null);
    mocks.user = { phone: '0901234567' };
    mocks.getPublicConfig.mockResolvedValue({ loyalty: LOYALTY });
    mocks.getMyExternalClaims.mockResolvedValue(EMPTY_LIST);
    mocks.locState = null;
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0, pointsConvertedBalance: 0, pointsMarketplaceBalance: 0, lockedPoints: 0 });
  });

  it('SĐT lệch: hộp đúng chữ đề bài theo sàn, ô 4 số kiểu số; không câu lỗi đỏ ở thẻ gửi mã', async () => {
    mocks.submitExternalClaim.mockRejectedValueOnce(confirmRejection('PHONE_CONFIRM_REQUIRED', 403, { channel: 'shopee' }));
    renderPage();
    await typeAndSend();
    const box = await screen.findByTestId('phone-confirm-sheet');
    expect(screen.getByText('Xác nhận SĐT nhận hàng')).toBeTruthy();
    expect(box).toHaveTextContent('Nhập 4 số cuối SĐT nhận hàng trên đơn Shopee');
    expect(box).toHaveTextContent('Đây là số người nhận ghi trên đơn Shopee, có thể khác số tài khoản của bạn.');
    expect(last4().getAttribute('inputmode')).toBe('numeric');
    expect(last4().getAttribute('pattern')).toBe('[0-9]*');
    expect(last4().maxLength).toBe(4);
    expect(screen.getByRole('button', { name: 'Quét đơn khác' })).toBeTruthy();
    expect(screen.queryByTestId('phone-confirm-error')).toBeNull();
    expect(screen.queryByText('máy chủ')).toBeNull();
  });

  it('đúng 4 số: gửi lại đúng mã kèm 4 số, đóng hộp, thẻ kết quả', async () => {
    mocks.submitExternalClaim
      .mockRejectedValueOnce(confirmRejection('PHONE_CONFIRM_REQUIRED', 403, { channel: 'shopee' }))
      .mockResolvedValueOnce(CLAIMED);
    renderPage();
    await typeAndSend();
    await screen.findByTestId('phone-confirm-sheet');
    await confirmWith('8326');
    await screen.findByTestId('claim-result');
    expect(mocks.submitExternalClaim).toHaveBeenLastCalledWith('SPXVN123456789', 'typed', '8326');
    await waitFor(() => expect(screen.queryByTestId('phone-confirm-sheet')).toBeNull());
  });

  it('Lazada sai: báo còn 2 lượt kèm nút nhắn CSKH; sai lần 3: khoá, nút xác nhận tắt', async () => {
    mocks.submitExternalClaim
      .mockRejectedValueOnce(confirmRejection('PHONE_CONFIRM_REQUIRED', 403, { channel: 'lazada' }))
      .mockRejectedValueOnce(confirmRejection('PHONE_CONFIRM_WRONG', 403, { channel: 'lazada', remainingAttempts: 2 }))
      .mockRejectedValueOnce(confirmRejection('PHONE_CONFIRM_LOCKED', 429, { channel: 'lazada', remainingAttempts: 0 }));
    renderPage();
    await typeAndSend();
    expect(await screen.findByTestId('phone-confirm-sheet')).toHaveTextContent('trên đơn Lazada');
    await confirmWith('9921');
    expect(await screen.findByText('Số điện thoại nhận hàng chưa khớp — kiểm tra lại 4 số cuối trên phiếu giao hàng rồi thử lại (còn 2 lượt).')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Nhắn CSKH Tubu' }));
    expect(mocks.openOAChat).toHaveBeenCalledWith(expect.stringContaining('SPX***789'));
    await waitFor(() => expect(last4().value).toBe(''));
    await confirmWith('1111');
    expect(await screen.findByText('Bạn đã nhập sai 3 lần. Thử lại đơn này sau 24 giờ hoặc nhắn CSKH.')).toBeTruthy();
    expect(last4().disabled).toBe(true);
    expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(3);
  });

  it('chưa đủ 4 số: nhắc, không gọi API', async () => {
    mocks.submitExternalClaim.mockRejectedValueOnce(confirmRejection('PHONE_CONFIRM_REQUIRED', 403, { channel: null }));
    renderPage();
    await typeAndSend();
    expect(await screen.findByTestId('phone-confirm-sheet')).toHaveTextContent('trên đơn sàn TMĐT');
    await confirmWith('83');
    expect(await screen.findByText('Bạn nhập đủ 4 chữ số nhé.')).toBeTruthy();
    expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(1);
  });

  it('"Quét đơn khác": đóng hộp, mở trình quét của Zalo', async () => {
    mocks.submitExternalClaim.mockRejectedValueOnce(confirmRejection('PHONE_CONFIRM_REQUIRED', 403, { channel: 'shopee' }));
    mocks.scanCode.mockResolvedValue({ kind: 'cancelled' });
    renderPage();
    await typeAndSend();
    await screen.findByTestId('phone-confirm-sheet');
    fireEvent.click(screen.getByRole('button', { name: 'Quét đơn khác' }));
    await waitFor(() => expect(mocks.scanCode).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('phone-confirm-sheet')).toBeNull());
    expect((screen.getByLabelText('Hoặc nhập mã vận đơn') as HTMLInputElement).value).toBe('');
  });

  it('hướng dẫn: lịch sử rỗng mở đủ 3 bước; đã có đơn thì gập một dòng, chạm để mở', async () => {
    const first = renderPage();
    expect(await screen.findByTestId('scan-guide')).toBeTruthy();
    expect(screen.queryByTestId('scan-guide-toggle')).toBeNull();
    first.unmount();
    mocks.getMyExternalClaims.mockResolvedValue({ ...EMPTY_LIST, meta: { page: 1, limit: 10, total: 2 } });
    renderPage();
    const toggle = await screen.findByTestId('scan-guide-toggle');
    expect(toggle).toHaveTextContent('Hướng dẫn quét mã');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('scan-guide')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('scan-guide').id).toBe(toggle.getAttribute('aria-controls'));
  });
});

describe('Trang Tích điểm đơn sàn — W59: không claim REVIEW rác, nhập lại 4 số cuối từ lịch sử', () => {
  const confirmRejection = (code: string, status: number, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error('x'), { isHttpError: true, response: { status, data: { code, message: 'máy chủ', requiredDigits: 4, ...extra } } });
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'c7',
    kind: 'SCAN',
    channel: 'Shopee',
    maskedCode: 'SPX***777',
    state: 'REVIEW',
    points: 900,
    expectedCreditAt: null,
    creditedAt: null,
    holdUntil: null,
    createdAt: '2026-11-27T00:00:00Z',
    ...over,
  });
  const last4 = () => screen.getByTestId('phone-confirm-input') as HTMLInputElement;
  const confirmWith = (digits: string) => {
    fireEvent.change(last4(), { target: { value: digits } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận & Tích điểm' }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase = 'authenticated';
    mocks.search = '';
    mocks.hasOA = true;
    mocks.getOaPromptState.mockResolvedValue({ promptSeen: true, followed: false });
    mocks.setOaPromptState.mockResolvedValue(undefined);
    window.history.replaceState({}, '', '/points/scan');
    __resetEntrySourceForTest();
    setCardGiftNote(null);
    mocks.user = { phone: '0901234567' };
    mocks.getPublicConfig.mockResolvedValue({ loyalty: LOYALTY });
    mocks.getMyExternalClaims.mockReset().mockResolvedValue(EMPTY_LIST);
    mocks.retryExternalClaimPhone.mockReset();
    mocks.locState = null;
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 0, pointsConvertedBalance: 0, pointsMarketplaceBalance: 0, lockedPoints: 0 });
  });

  it('đóng hộp 4 số mà chưa khớp: báo mã chưa tích và nằm ở lịch sử, làm mới lịch sử', async () => {
    mocks.submitExternalClaim.mockRejectedValueOnce(confirmRejection('PHONE_CONFIRM_REQUIRED', 403, { channel: 'shopee' }));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: 'SPXVN123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    await screen.findByTestId('phone-confirm-sheet');
    const before = mocks.getMyExternalClaims.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(await screen.findByText(PHONE_CONFIRM_COPY.later)).toBeTruthy();
    await waitFor(() => expect(mocks.getMyExternalClaims.mock.calls.length).toBeGreaterThan(before));
    expect(mocks.submitExternalClaim).toHaveBeenCalledTimes(1);
  });

  it('sai đủ 3 lần (đơn khoá) rồi đóng hộp: báo câu khoá, không mời nhập lại từ lịch sử', async () => {
    mocks.submitExternalClaim
      .mockRejectedValueOnce(confirmRejection('PHONE_CONFIRM_REQUIRED', 403, { channel: 'shopee' }))
      .mockRejectedValueOnce(confirmRejection('PHONE_CONFIRM_LOCKED', 429, { channel: 'shopee', remainingAttempts: 0 }));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Hoặc nhập mã vận đơn'), { target: { value: 'SPXVN123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    await screen.findByTestId('phone-confirm-sheet');
    confirmWith('1111');
    expect(await screen.findByText(PHONE_CONFIRM_COPY.locked, { selector: '[role="alert"]' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(await screen.findByText(PHONE_CONFIRM_COPY.locked, { selector: '[role="status"]' })).toBeTruthy();
    expect(screen.queryByText(PHONE_CONFIRM_COPY.later)).toBeNull();
  });

  it('đúng 4 số từ lịch sử nhưng máy chủ đưa đơn vào kiểm tra (REVIEW): báo đang kiểm tra, không hiện điểm chờ cộng', async () => {
    mocks.getMyExternalClaims.mockResolvedValue({ ...EMPTY_LIST, needsPhone: [{ attemptId: 'a1', channel: 'shopee', maskedCode: 'SPX***001', createdAt: '2026-11-28T01:00:00Z' }] });
    mocks.retryExternalClaimPhone.mockResolvedValueOnce({ status: 'REVIEW', claimId: 'c9', channel: 'shopee', maskedCode: 'SPX***001', points: 9000, expectedCreditAt: null, message: 'ok' });
    renderPage();
    await screen.findByTestId('claim-needs-phone');
    fireEvent.click(screen.getByTestId('claim-needs-phone-row').querySelector('[role="button"]')!);
    await screen.findByTestId('phone-confirm-sheet');
    confirmWith('5511');
    const done = await screen.findByTestId('claim-retry-done');
    expect(done).toHaveTextContent('Đã ghi nhận đơn Shopee SPX***001');
    expect(done).toHaveTextContent(MARKETPLACE_CLAIM_COPY.resultReview);
    expect(done).not.toHaveTextContent('Điểm Xanh đang chờ cộng');
  });

  it('dòng "Chờ bạn nhập 4 số cuối": chạm mở hộp (không có "Quét đơn khác"), đúng 4 số gửi attemptId và báo đã ghi nhận', async () => {
    mocks.getMyExternalClaims.mockResolvedValue({ ...EMPTY_LIST, needsPhone: [{ attemptId: 'a1', channel: 'shopee', maskedCode: 'SPX***001', createdAt: '2026-11-28T01:00:00Z' }] });
    mocks.retryExternalClaimPhone.mockResolvedValueOnce({ status: 'CLAIMED', claimId: 'c9', channel: 'shopee', maskedCode: 'SPX***001', points: 700, expectedCreditAt: null, message: 'ok' });
    renderPage();
    const group = await screen.findByTestId('claim-needs-phone');
    expect(group).toHaveTextContent(PHONE_CONFIRM_COPY.retryTitle);
    expect(group).toHaveTextContent('Nhập 4 số cuối');
    fireEvent.click(screen.getByTestId('claim-needs-phone-row').querySelector('[role="button"]')!);
    expect(await screen.findByTestId('phone-confirm-sheet')).toHaveTextContent('trên đơn Shopee');
    expect(screen.queryByRole('button', { name: 'Quét đơn khác' })).toBeNull();
    confirmWith('5511');
    await waitFor(() => expect(mocks.retryExternalClaimPhone).toHaveBeenCalledWith({ attemptId: 'a1' }, '5511'));
    const done = await screen.findByTestId('claim-retry-done');
    expect(done).toHaveTextContent('Đã ghi nhận đơn Shopee SPX***001');
    expect(done).toHaveTextContent('700 Điểm Xanh đang chờ cộng');
    await waitFor(() => expect(screen.queryByTestId('phone-confirm-sheet')).toBeNull());
  });

  it('claim chờ chỉ vì SĐT: nhãn "Nhập 4 số cuối" thay "Đang kiểm tra", chạm gửi claimId; sai báo lời PO trong hộp', async () => {
    mocks.getMyExternalClaims.mockResolvedValue({ ...EMPTY_LIST, data: [row({ phoneRetry: true }), row({ id: 'c8', maskedCode: 'SPX***888' })], meta: { page: 1, limit: 10, total: 2 } });
    mocks.retryExternalClaimPhone.mockRejectedValueOnce(confirmRejection('PHONE_CONFIRM_WRONG', 403, { channel: 'shopee', remainingAttempts: 2 }));
    renderPage();
    const retryRow = await screen.findByTestId('claim-row-retry');
    expect(retryRow).toHaveTextContent('Nhập 4 số cuối');
    expect(retryRow).not.toHaveTextContent('Đang kiểm tra');
    expect(screen.getAllByTestId('claim-row-retry')).toHaveLength(1);
    fireEvent.click(retryRow.querySelector('[role="button"]')!);
    await screen.findByTestId('phone-confirm-sheet');
    confirmWith('0000');
    await waitFor(() => expect(mocks.retryExternalClaimPhone).toHaveBeenCalledWith({ claimId: 'c7' }, '0000'));
    expect(await screen.findByText(PHONE_CONFIRM_COPY.wrong(2))).toBeTruthy();
  });

  it('dòng không còn để nhập lại (409): đóng hộp, báo câu máy chủ', async () => {
    mocks.getMyExternalClaims.mockResolvedValue({ ...EMPTY_LIST, data: [row({ phoneRetry: true })], meta: { page: 1, limit: 10, total: 1 } });
    mocks.retryExternalClaimPhone.mockRejectedValueOnce(
      new HttpError('Request failed with status code 409', 'ERR_BAD_REQUEST', {
        status: 409,
        data: { statusCode: 409, code: 'PHONE_RETRY_GONE', message: 'Đơn này không còn cần nhập 4 số cuối. Bạn xem trạng thái mới trong lịch sử nhé.' },
      } as never),
    );
    renderPage();
    fireEvent.click((await screen.findByTestId('claim-row-retry')).querySelector('[role="button"]')!);
    await screen.findByTestId('phone-confirm-sheet');
    confirmWith('5511');
    expect(await screen.findByTestId('claim-retry-notice')).toHaveTextContent('không còn cần nhập 4 số cuối');
    await waitFor(() => expect(screen.queryByTestId('phone-confirm-sheet')).toBeNull());
  });
});
