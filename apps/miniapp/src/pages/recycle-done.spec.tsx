import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WasteRequestDetailDTO, WasteRequestLineDTO } from '@tubutree/shared-types';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  keySeq: 0,
  params: { id: 'req-1' } as Record<string, string>,
  location: { pathname: '/', search: '', state: null as unknown },
  auth: { status: 'authenticated' as 'idle' | 'loading' | 'authenticated' | 'error' },
  login: vi.fn(),
  ensurePhone: vi.fn(),
  publicConfig: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } },
  getWasteRequest: vi.fn(),
  getWasteMe: vi.fn(),
  getLoyaltyRewards: vi.fn(),
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
  getWasteRequest: mocks.getWasteRequest,
  getWasteMe: mocks.getWasteMe,
}));
vi.mock('../services/account-api', () => ({ getLoyaltyRewards: mocks.getLoyaltyRewards }));

import RecycleDonePage from './recycle-done';
import { makeRequestDetail, makeWasteMe, makeRewardCatalog } from '../services/waste-test-fixtures';
import { describeNested, findNestedInteractive } from '../components/ui/nested-interactive';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <RecycleDonePage />
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidate };
}

const LINE = makeRequestDetail().lines[0] as WasteRequestLineDTO;
const DONE = (over: Partial<WasteRequestDetailDTO> = {}) => makeRequestDetail({ status: 'COMPLETED', editable: false, cancellable: false, pointsAwarded: 4000, dropsAwarded: null, completedAt: '2026-10-18T03:00:00.000Z', lines: [{ ...LINE, receivedQty: 4, shortfallReason: 'DIRTY', pointsAwarded: 4000 }], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWasteRequest.mockResolvedValue(DONE());
  mocks.getWasteMe.mockResolvedValue(makeWasteMe({ balance: { pointsBalance: 9000, pointsConvertedBalance: 5000, redeemablePoints: 14_000 } }));
  mocks.getLoyaltyRewards.mockResolvedValue(makeRewardCatalog({ redeemablePoints: 14_000 }));
});

describe('/recycle/done/:id (§4.7)', () => {
  it.each(['OPEN', 'IN_TRANSIT', 'RECEIVED', 'REJECTED', 'REVERSED'] as const)('%s → chuyển về /recycle/r/:id', async (status) => {
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ status }));
    renderPage();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/req-1', { replace: true }));
  });
  it('số điểm vừa cộng, bảng kho đếm so với bạn khai kèm lý do', async () => {
    renderPage();
    expect(await screen.findByText('Đã cộng 4.000 điểm')).toBeInTheDocument();
    const row = within(screen.getByRole('table', { name: 'Đã khai và đã đếm' })).getByRole('row', { name: /Thùng carton/ });
    expect(row).toHaveTextContent('5 thùng');
    expect(row).toHaveTextContent('4 thùng');
    expect(row).toHaveTextContent('Bẩn');
  });
  it('số dư mới (tổng hai lô) và tiến độ tới quà từ redeemablePoints', async () => {
    renderPage();
    expect(await screen.findByText('Số dư mới 14.000 điểm')).toBeInTheDocument();
    expect(await screen.findByText('Còn 6.000 điểm tới mã Miễn phí vận chuyển')).toBeInTheDocument();
  });
  it('giọt nước: chỉ khi dropsAwarded > 0, dùng icon không dùng emoji', async () => {
    mocks.getWasteRequest.mockResolvedValue(DONE({ dropsAwarded: 3 }));
    const { container } = renderPage();
    expect(await screen.findByText('+3 giọt nước vào bình của bạn')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });
  it('dropsAwarded null hoặc 0 → không có dòng giọt nước', async () => {
    mocks.getWasteRequest.mockResolvedValue(DONE({ dropsAwarded: 0 }));
    renderPage();
    await screen.findByText('Đã cộng 4.000 điểm');
    expect(screen.queryByText(/giọt nước/)).toBeNull();
  });
  it('thẻ tác động chỉ khi impactGrams khác null, chỉ nói khối lượng', async () => {
    mocks.getWasteRequest.mockResolvedValue(DONE({ impactGrams: 1940 }));
    const { container } = renderPage();
    expect(await screen.findByText('Bạn đã gửi khoảng 1,9 kg bao bì cho Tubu')).toBeInTheDocument();
    expect(screen.getByText('Ước tính theo khối lượng trung bình')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/CO2|cây/);
  });
  it('tác động dưới 50 g → không có thẻ; 100 g → "0,1 kg"', async () => {
    mocks.getWasteRequest.mockResolvedValue(DONE({ impactGrams: 30 }));
    const { unmount } = renderPage();
    await screen.findByText('Đã cộng 4.000 điểm');
    expect(screen.queryByText(/kg bao bì/)).toBeNull();
    expect(screen.queryByText('Ước tính theo khối lượng trung bình')).toBeNull();
    unmount();
    mocks.getWasteRequest.mockResolvedValue(DONE({ impactGrams: 100 }));
    renderPage();
    expect(await screen.findByText('Bạn đã gửi khoảng 0,1 kg bao bì cho Tubu')).toBeInTheDocument();
  });
  it('impactGrams null → không có thẻ tác động', async () => {
    renderPage();
    await screen.findByText('Đã cộng 4.000 điểm');
    expect(screen.queryByText(/kg bao bì/)).toBeNull();
  });
  it('0 điểm: nói thật là chưa đủ để cộng, không hiện "Đã cộng"', async () => {
    mocks.getWasteRequest.mockResolvedValue(DONE({ pointsAwarded: 0, lines: [{ ...LINE, itemId: 'item-milk', itemName: 'Vỏ hộp sữa', unitLabel: 'vỏ', unitsPerPoint: 5, declaredQty: 5, receivedQty: 3, shortfallReason: 'DIRTY', pointsAwarded: 0 }] }));
    renderPage();
    expect(await screen.findByText('Lượt này chưa đủ để cộng điểm')).toBeInTheDocument();
    expect(screen.getByText('Vỏ hộp sữa cần 5 vỏ mới được 1.000 điểm, kho đếm được 3 vỏ')).toBeInTheDocument();
    expect(screen.queryByText(/Đã cộng/)).toBeNull();
  });
  it('"Đổi quà ngay" → /rewards; "Đổi thêm rác" → /recycle/new', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi quà ngay' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/rewards');
    fireEvent.click(screen.getByRole('button', { name: 'Đổi thêm rác' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/new');
  });
  it('một PageHeader, không lồng nút', async () => {
    const { container } = renderPage();
    await screen.findByText('Đã cộng 4.000 điểm');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });
});
