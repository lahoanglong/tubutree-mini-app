import { render, screen, fireEvent } from '@testing-library/react';
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
  getWasteRules: vi.fn(),
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
vi.mock('../services/waste-api', async (orig) => ({ ...(await orig<object>()), getWasteRules: mocks.getWasteRules }));

import RecycleRulesPage from './recycle-rules';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <RecycleRulesPage />
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/recycle/rules (§14.2)', () => {
  it('hiện thể lệ do admin soạn, giữ xuống dòng', async () => {
    mocks.getWasteRules.mockResolvedValue({ text: 'Điểm Xanh là ưu đãi cho khách.\nKhông đổi ra tiền.' });
    renderPage();
    const body = await screen.findByText(/Điểm Xanh là ưu đãi cho khách\./);
    expect(body).toHaveStyle({ whiteSpace: 'pre-line' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
  it('chưa có thể lệ → dòng "Thể lệ đang được cập nhật"', async () => {
    mocks.getWasteRules.mockResolvedValue({ text: null });
    renderPage();
    expect(await screen.findByText('Thể lệ đang được cập nhật')).toBeInTheDocument();
  });
  it('lỗi → nút Thử lại gọi lại', async () => {
    mocks.getWasteRules.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue({ text: 'OK' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('OK')).toBeInTheDocument();
  });
});
