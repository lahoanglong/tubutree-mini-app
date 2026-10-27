import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  keySeq: 0,
  params: {} as Record<string, string>,
  location: { pathname: '/', search: '', state: null as unknown },
  auth: { status: 'authenticated' as 'idle' | 'loading' | 'authenticated' | 'error' },
  login: vi.fn(),
  ensurePhone: vi.fn(),
  publicConfig: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } },
  getMyRedemptions: vi.fn(),
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div role="dialog">{children}</div> : null),
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location,
  useParams: () => mocks.params,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/api', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
  getLoadErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
  isNotFoundError: (e: unknown) => (e as { status?: number } | null)?.status === 404,
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, login: mocks.login, ensurePhone: mocks.ensurePhone };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/idempotency', () => ({ newIdempotencyKey: () => `key-${++mocks.keySeq}` }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.publicConfig }));
vi.mock('../services/account-api', () => ({ getMyRedemptions: mocks.getMyRedemptions }));
vi.mock('../services/waste-api', async (orig) => ({ ...(await orig<object>()) }));
vi.mock('../components/qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));

import RewardsMinePage from './rewards-mine';
import { makeGiftRedemption } from '../services/waste-test-fixtures';
import { describeNested, findNestedInteractive } from '../components/ui/nested-interactive';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RewardsMinePage />
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.keySeq = 0;
  mocks.auth.status = 'authenticated';
});

describe('/rewards/mine (§4.8)', () => {
  it('READY: mã QG- cỡ lớn + QR, nơi nhận kèm địa chỉ và giờ, hạn nhận theo giờ VN', async () => {
    mocks.getMyRedemptions.mockResolvedValue([makeGiftRedemption()]);
    renderPage();
    const row = (await screen.findByText('Gói hạt giống Tubu')).closest('[data-redemption]') as HTMLElement;
    expect(within(row).getByText('QG-8K2M9P4T', { selector: 'p' })).toBeInTheDocument();
    expect(within(row).getByTestId('qr')).toHaveTextContent('QG-8K2M9P4T');
    expect(within(row).getByText('Nhận tại Kho Tubu TP.HCM')).toBeInTheDocument();
    expect(within(row).getByText('99 Nguyễn Văn Linh, Phường Tân Phong, TP.HCM')).toBeInTheDocument();
    expect(within(row).getByText('T2 08:00–17:00')).toBeInTheDocument();
    expect(within(row).getByText('Hạn nhận 17/12/2026')).toBeInTheDocument();
    expect(within(row).getByText('Chờ nhận')).toBeInTheDocument();
    expect(within(row).getByTestId('qr-center')).toHaveStyle({ justifyContent: 'center' });
    expect(within(row).getByTestId('qr-center')).toContainElement(within(row).getByTestId('qr'));
  });
  it('mã giảm giá nằm trong cùng kiểu thẻ viền với các lượt quà; lượt đã nhận hoặc đã huỷ không có nhãn Chờ nhận', async () => {
    mocks.getMyRedemptions.mockResolvedValue([
      makeGiftRedemption({ id: 'v', giftKind: 'VOUCHER', giftName: 'Miễn phí vận chuyển', status: 'FULFILLED', code: null, couponCode: 'FS-E2E1', claimPoint: null, fulfilledAt: '2026-10-17T03:00:00.000Z' }),
      makeGiftRedemption({ id: 'f', giftName: 'Túi vải Tubu', status: 'FULFILLED', claimPoint: null, fulfilledAt: '2026-10-25T17:30:00.000Z' }),
    ]);
    renderPage();
    const voucher = (await screen.findByText('Miễn phí vận chuyển')).closest('[data-redemption]') as HTMLElement;
    const gift = screen.getByText('Túi vải Tubu').closest('[data-redemption]') as HTMLElement;
    const border = (el: HTMLElement) => (el.firstElementChild as HTMLElement).style.border;
    expect(border(voucher)).toContain('--color-border-subtle');
    expect(border(voucher)).toBe(border(gift));
    expect(screen.queryByText('Chờ nhận')).toBeNull();
  });
  it('CANCELLED: lý do và số điểm đã hoàn (kể cả 0)', async () => {
    mocks.getMyRedemptions.mockResolvedValue([
      makeGiftRedemption({ id: 'a', status: 'CANCELLED', code: 'QG-AAAAAAAA', claimPoint: null, cancelledAt: '2026-10-20T03:00:00.000Z', cancelReason: 'Quá hạn nhận', refundedPoints: 25_000 }),
      makeGiftRedemption({ id: 'b', giftName: 'Túi vải Tubu', status: 'CANCELLED', code: 'QG-BBBBBBBB', claimPoint: null, cancelReason: 'Gian lận', refundedPoints: 0 }),
    ]);
    renderPage();
    expect(await screen.findByText('Đã huỷ: Quá hạn nhận')).toBeInTheDocument();
    expect(screen.getByText('Đã hoàn 25.000 điểm')).toBeInTheDocument();
    expect(screen.getByText('Đã hoàn 0 điểm')).toBeInTheDocument();
    expect(screen.queryByText('QG-AAAAAAAA')).toBeNull();
  });
  it('FULFILLED: ngày nhận', async () => {
    mocks.getMyRedemptions.mockResolvedValue([makeGiftRedemption({ status: 'FULFILLED', claimPoint: null, fulfilledAt: '2026-10-25T17:30:00.000Z' })]);
    renderPage();
    expect(await screen.findByText('Đã nhận ngày 26/10/2026')).toBeInTheDocument();
  });
  it('lượt mã giảm giá dẫn tới ví mã', async () => {
    mocks.getMyRedemptions.mockResolvedValue([makeGiftRedemption({ giftKind: 'VOUCHER', giftName: 'Miễn phí vận chuyển', status: 'FULFILLED', code: null, couponCode: 'FREESHIP-ABC', claimPoint: null, fulfilledAt: '2026-10-17T03:00:00.000Z' })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Miễn phí vận chuyển/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/loyalty');
  });
  it('rỗng → EmptyState dẫn về Kho quà', async () => {
    mocks.getMyRedemptions.mockResolvedValue([]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đến Kho quà' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/rewards');
  });
  it('một PageHeader, không lồng nút', async () => {
    mocks.getMyRedemptions.mockResolvedValue([makeGiftRedemption()]);
    const { container } = renderPage();
    await screen.findByText('Gói hạt giống Tubu');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });
});
