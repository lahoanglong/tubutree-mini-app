import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicConfig: vi.fn(),
  submitExternalClaim: vi.fn(),
  getMyExternalClaims: vi.fn(),
  scanCode: vi.fn(),
  phase: 'authenticated' as string,
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
vi.mock('../components/back-button', () => ({ default: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ExternalPointsPage, { claimStateView } from './external-points';

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
    mocks.submitExternalClaim.mockResolvedValue({
      status: 'CLAIMED', claimId: 'c1', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250,
      expectedCreditAt: '2026-11-05T05:00:00.000Z', message: 'ok',
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Mã vận đơn hoặc mã đơn trên sàn'), { target: { value: ' spxvn123456789 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    const result = await screen.findByTestId('claim-result');
    expect(mocks.submitExternalClaim).toHaveBeenCalledWith('spxvn123456789');
    expect(result).toHaveTextContent('Đã ghi nhận đơn Shopee SPX***789');
    expect(result).toHaveTextContent('1.250 Điểm Xanh đang chờ cộng');
    expect(result).toHaveTextContent('Dự kiến cộng từ 05/11/2026');
    await waitFor(() => expect(mocks.getMyExternalClaims.mock.calls.length).toBeGreaterThan(1));
  });

  it('lỗi theo code: hiện câu tiếng Việt của app, không in message máy chủ', async () => {
    mocks.submitExternalClaim.mockRejectedValue(rejection('ALREADY_CLAIMED'));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Mã vận đơn hoặc mã đơn trên sàn'), { target: { value: 'SPXVN123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mã này đã được tích điểm rồi.');
    expect(screen.queryByText('máy chủ')).toBeNull();
    expect(screen.queryByTestId('claim-result')).toBeNull();
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
    mocks.scanCode.mockResolvedValueOnce('SPXVN999999999');
    fireEvent.click(screen.getByRole('button', { name: 'Quét mã' }));
    await waitFor(() => expect(input.value).toBe('SPXVN999999999'));
    mocks.scanCode.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: 'Quét mã' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bạn nhập mã bằng tay');
  });

  it('danh sách: trạng thái, điểm, mốc cộng và phân trang', async () => {
    const item = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
      id, channel: 'Lazada', maskedCode: `LZ***${id}`, state, points: 500, expectedCreditAt: null, creditedAt: null, createdAt: '2026-10-01T00:00:00.000Z', ...extra,
    });
    mocks.getMyExternalClaims.mockImplementation(async (page: number) =>
      page === 1
        ? {
            data: [
              item('1', 'PENDING'),
              item('2', 'PENDING', { expectedCreditAt: '2026-11-05T05:00:00.000Z' }),
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
    expect(screen.getByText('Dự kiến 05/11/2026')).toBeInTheDocument();
    expect(screen.getByText('Đã cộng 20/10/2026')).toBeInTheDocument();
    expect(screen.getByText('Đã huỷ')).toBeInTheDocument();
    expect(screen.getByText('Cần duyệt')).toBeInTheDocument();
    expect(screen.getByText('Điểm chưa tính được')).toBeInTheDocument();
    expect(screen.getByText('Đang tìm đơn')).toBeInTheDocument();
    expect(screen.getByText('Trang 1/2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sau' }));
    expect(await screen.findByText('LZ***6')).toBeInTheDocument();
    expect(screen.getByText('Trang 2/2')).toBeInTheDocument();
  });

  it('claimStateView: REVERSED và LAPSED có nhãn riêng', () => {
    expect(claimStateView({ state: 'REVERSED', expectedCreditAt: null }).label).toBe('Đã thu hồi');
    expect(claimStateView({ state: 'LAPSED', expectedCreditAt: null }).label).toBe('Hết hạn');
  });
});
