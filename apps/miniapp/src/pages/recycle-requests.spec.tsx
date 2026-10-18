import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequestSummary, makeWasteMe } from '../services/waste-test-fixtures';

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
  listWasteRequests: vi.fn(),
  getWasteMe: vi.fn(),
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
vi.mock('../services/waste-api', async (orig) => ({
  ...(await orig<object>()),
  listWasteRequests: mocks.listWasteRequests,
  getWasteMe: mocks.getWasteMe,
}));

import RecycleRequestsPage from './recycle-requests';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <RecycleRequestsPage />
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidate };
}

const ROWS = [
  makeRequestSummary({ id: 'r-open', code: 'TR-AAAAA', status: 'OPEN' }),
  makeRequestSummary({ id: 'r-ship', code: 'TR-BBBBB', method: 'MAIL_IN', status: 'IN_TRANSIT', pointName: 'Kho Tubu TP.HCM' }),
  makeRequestSummary({ id: 'r-done', code: 'TR-CCCCC', status: 'COMPLETED', pointsAwarded: 4000 }),
  makeRequestSummary({ id: 'r-exp', code: 'TR-DDDDD', status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' }),
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listWasteRequests.mockResolvedValue(ROWS);
  mocks.getWasteMe.mockResolvedValue(makeWasteMe());
});

describe('/recycle/requests (§4.6, §16.1)', () => {
  it('hai tab có số đếm; mặc định Đang xử lý', async () => {
    renderPage();
    expect(await screen.findByRole('tab', { name: /Đang xử lý/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Đang xử lý/ })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Đã đóng/ })).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /TR-AAAAA/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /TR-CCCCC/ })).toBeNull();
  });
  it('yêu cầu đang xử lý → /recycle/r/:id', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /TR-BBBBB/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/r-ship');
  });
  it('tab Đã đóng: COMPLETED → /recycle/done/:id, trạng thái khác → /recycle/r/:id', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: /Đã đóng/ }));
    expect(screen.getByRole('button', { name: /TR-CCCCC/ })).toHaveTextContent('Đã cộng 4.000 điểm');
    expect(screen.getByRole('button', { name: /TR-DDDDD/ })).toHaveTextContent('Hết hạn giữ chỗ');
    fireEvent.click(screen.getByRole('button', { name: /TR-CCCCC/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/done/r-done');
    fireEvent.click(screen.getByRole('button', { name: /TR-DDDDD/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/r-exp');
  });
  it('tab Đang xử lý: trạng thái theo cách giao, không còn "Đang mở"', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /TR-AAAAA/ })).toHaveTextContent('Chờ bạn mang tới');
    expect(screen.getByRole('button', { name: /TR-BBBBB/ })).toHaveTextContent('Đang vận chuyển');
    expect(screen.queryByText(/Đang mở/)).toBeNull();
  });
  it('khách bị khoá: dòng RECEIVED đọc "Đang chờ Tubu xem lại"', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ blocked: true }));
    mocks.listWasteRequests.mockResolvedValue([makeRequestSummary({ id: 'r-rec', code: 'TR-RECVD', method: 'MAIL_IN', status: 'RECEIVED' })]);
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /TR-RECVD/ })).toHaveTextContent('Đang chờ Tubu xem lại'));
  });
  it('chương trình tạm dừng: dòng Mang tới đang mở đọc "Đang tạm dừng"', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ programmeEnabled: false }));
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /TR-AAAAA/ })).toHaveTextContent('Đang tạm dừng'));
    expect(screen.getByRole('button', { name: /TR-BBBBB/ })).toHaveTextContent('Đang vận chuyển');
  });
  it('/waste/me lỗi: dòng giữ chữ thường, không có trạng thái lỗi', async () => {
    mocks.getWasteMe.mockRejectedValue(new Error('me hỏng'));
    renderPage();
    expect(await screen.findByRole('button', { name: /TR-AAAAA/ })).toHaveTextContent('Chờ bạn mang tới');
    await waitFor(() => expect(mocks.getWasteMe).toHaveBeenCalled());
    expect(screen.queryByText('me hỏng')).toBeNull();
    expect(screen.queryByRole('button', { name: /Thử lại/ })).toBeNull();
  });
  it('COMPLETED 0 điểm: "Chưa đủ để cộng điểm", không "Đã cộng"', async () => {
    mocks.listWasteRequests.mockResolvedValue([makeRequestSummary({ id: 'r-zero', code: 'TR-ZZZZZ', status: 'COMPLETED', pointsAwarded: 0 })]);
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: /Đã đóng/ }));
    const row = screen.getByRole('button', { name: /TR-ZZZZZ/ });
    expect(row).toHaveTextContent('Chưa đủ để cộng điểm');
    expect(row).not.toHaveTextContent('Đã cộng');
  });
  it('ngày tạo theo giờ VN', async () => {
    renderPage();
    expect(await screen.findAllByText(/17\/10\/2026/)).not.toHaveLength(0);
  });
  it('rỗng → EmptyState với "Đổi rác ngay"', async () => {
    mocks.listWasteRequests.mockResolvedValue([]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi rác ngay' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/new');
  });
  it('không có liên kết "Xem kết quả mẫu" của mockup (§19)', async () => {
    renderPage();
    await screen.findByRole('button', { name: /TR-AAAAA/ });
    expect(screen.queryByText(/Xem kết quả mẫu/)).toBeNull();
  });
});
