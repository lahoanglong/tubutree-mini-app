import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  getWasteMe: vi.fn(),
  getWastePoints: vi.fn(),
  getNearbyWastePoints: vi.fn(),
  requestZaloLocation: vi.fn(),
  getZaloAccessToken: vi.fn(),
  callPhone: vi.fn(),
  openExternal: vi.fn(),
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
  getWasteMe: mocks.getWasteMe,
  getWastePoints: mocks.getWastePoints,
  getNearbyWastePoints: mocks.getNearbyWastePoints,
}));
vi.mock('../services/zmp-bridge', () => ({
  requestZaloLocation: mocks.requestZaloLocation,
  getZaloAccessToken: mocks.getZaloAccessToken,
  callPhone: mocks.callPhone,
  openExternal: mocks.openExternal,
}));

import RecyclePointsPage, { filterPointsByText } from './recycle-points';
import type { WastePointsNavState, WastePointsReturnState, WasteWizardDraft } from './recycle-new';
import { ITEM_CARTON, ITEM_MILK, makeWasteMe, makeWastePoint } from '../services/waste-test-fixtures';
import { describeNested, findNestedInteractive } from '../components/ui/nested-interactive';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <RecyclePointsPage />
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidate };
}

const DRAFT: WasteWizardDraft = { lines: { 'item-carton': 5, 'item-milk': 5 }, method: 'DROP_OFF', pointId: null, pickedPoint: null, provinceCode: null, nearby: null };
const NAV: WastePointsNavState = { returnTo: '/recycle/new?step=method', draft: DRAFT, selectedItemIds: ['item-carton', 'item-milk'] };
const HCM = makeWastePoint({ id: 'pt-hcm', name: 'Đại lý Cô Ba' });
const HCM2 = makeWastePoint({ id: 'pt-hcm2', name: 'Đại lý Tân Định', addressLine: '5 Hai Bà Trưng', communeName: 'Phường Tân Định' });
const HN = makeWastePoint({ id: 'pt-hn', name: 'Đại lý Hồ Gươm', provinceCode: '01', provinceName: 'Hà Nội', communeName: 'Phường Hoàn Kiếm' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.location.state = NAV;
  mocks.auth.status = 'authenticated';
  mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: true };
  mocks.getWasteMe.mockResolvedValue(makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true } }));
  mocks.getWastePoints.mockResolvedValue([HCM, HCM2, HN]);
  mocks.requestZaloLocation.mockResolvedValue(null);
});

describe('/recycle/points (§4.4)', () => {
  it('không có state điều hướng → về /recycle/new', async () => {
    mocks.location.state = null;
    renderPage();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/recycle/new', { replace: true }));
  });
  it('khách (chưa đăng nhập) → về /recycle thay vì skeleton mãi', async () => {
    mocks.auth.status = 'idle';
    renderPage();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/recycle', { replace: true }));
    expect(mocks.navigate).not.toHaveBeenCalledWith('/recycle/new', expect.anything());
  });
  it('tab theo tỉnh có điểm; đổi tab lọc danh sách', async () => {
    renderPage();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['TP.HCM', 'Hà Nội']);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: 'Hà Nội' }));
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Đại lý Hồ Gươm/ })).toBeInTheDocument();
  });
  it('tìm theo tên, phường/xã hoặc tên đường, không phân biệt dấu', async () => {
    renderPage();
    await screen.findAllByRole('radio');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm điểm nhận' }), { target: { value: 'tan dinh' } });
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([expect.stringContaining('Đại lý Tân Định')]);
    expect(filterPointsByText([HCM, HCM2], 'hai bà').map((p) => p.id)).toEqual(['pt-hcm2']);
    expect(filterPointsByText([HCM, HCM2, HN], 'hoan kiem').map((p) => p.id)).toEqual(['pt-hn']);
  });
  it('"Gần tôi": token vị trí trong body, nhóm Gần tôi + nhãn Gần nhất', async () => {
    mocks.requestZaloLocation.mockResolvedValue({ token: 'loc' });
    mocks.getZaloAccessToken.mockResolvedValue({ accessToken: 'acc', code: 'c' });
    mocks.getNearbyWastePoints.mockResolvedValue([{ ...HCM2, distanceKm: 0.8 }, { ...HCM, distanceKm: 2.1 }]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Dùng vị trí của tôi' }));
    expect(await screen.findByRole('tab', { name: 'Gần tôi' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.getNearbyWastePoints).toHaveBeenCalledWith({ locationToken: 'loc', zaloAccessToken: 'acc' });
    expect(within(screen.getByRole('radio', { name: /Đại lý Tân Định/ })).getByText('Gần nhất')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Đại lý Tân Định/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Chọn điểm này' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/new?step=method', {
      replace: true,
      state: {
        draft: {
          ...DRAFT,
          nearby: [{ ...HCM2, distanceKm: 0.8 }, { ...HCM, distanceKm: 2.1 }],
          pointId: 'pt-hcm2',
          pickedPoint: { ...HCM2, distanceKm: 0.8 },
        },
      },
    });
  });
  it('nháp đã có nearby (bước 2 lấy rồi) → không xin vị trí lại', async () => {
    mocks.location.state = { ...NAV, draft: { ...DRAFT, nearby: [{ ...HCM, distanceKm: 1 }] } };
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Gần tôi' })).toBeInTheDocument();
    expect(mocks.requestZaloLocation).not.toHaveBeenCalled();
  });
  it('từ chối vị trí → không lỗi, không nhóm Gần tôi, không "Gần nhất"', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Dùng vị trí của tôi' }));
    await waitFor(() => expect(mocks.requestZaloLocation).toHaveBeenCalled());
    expect(screen.queryByRole('tab', { name: 'Gần tôi' })).toBeNull();
    expect(screen.queryByText('Gần nhất')).toBeNull();
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });
  it('thiếu ZALO_APP_SECRET: máy chủ trả danh sách không có khoảng cách → không có nhóm Gần tôi', async () => {
    mocks.requestZaloLocation.mockResolvedValue({ token: 'loc' });
    mocks.getZaloAccessToken.mockResolvedValue({ accessToken: 'acc', code: 'c' });
    mocks.getNearbyWastePoints.mockResolvedValue([HCM, HCM2, HN]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Dùng vị trí của tôi' }));
    await waitFor(() => expect(mocks.getNearbyWastePoints).toHaveBeenCalled());
    expect(screen.queryByRole('tab', { name: 'Gần tôi' })).toBeNull();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['TP.HCM', 'Hà Nội']);
  });
  it('"Chọn điểm này" khoá tới khi chọn; chọn → trả nháp về bước 2 bằng replace', async () => {
    renderPage();
    const choose = await screen.findByRole('button', { name: 'Chọn điểm này' });
    expect(choose).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Đại lý Cô Ba/ }));
    fireEvent.click(choose);
    const state: WastePointsReturnState = { draft: { ...DRAFT, method: 'DROP_OFF', pointId: 'pt-hcm', pickedPoint: HCM } };
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/new?step=method', { replace: true, state });
  });
  it('điểm hết hạn mức không chọn được nên "Chọn điểm này" vẫn khoá', async () => {
    mocks.getWastePoints.mockResolvedValue([{ ...HCM, quotaFull: true }]);
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: /Đại lý Cô Ba/ }));
    expect(screen.getByRole('button', { name: 'Chọn điểm này' })).toBeDisabled();
  });
  it('điểm không nhận đủ món đã chọn nên "Chọn điểm này" vẫn khoá (§4.4, ảnh 04)', async () => {
    mocks.getWastePoints.mockResolvedValue([{ ...HCM, acceptedItemIds: [] }]);
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: /Đại lý Cô Ba/ }));
    expect(screen.getByRole('button', { name: 'Chọn điểm này' })).toBeDisabled();
    expect(screen.getByText('Điểm này không nhận: Thùng carton, Vỏ hộp sữa')).toBeInTheDocument();
  });
  it('khối "Chưa có điểm gần bạn?" nói thật về phí và dẫn tới cách còn lại đang bật', async () => {
    renderPage();
    expect(await screen.findByText('Chưa có điểm gần bạn?')).toBeInTheDocument();
    expect(screen.getByText('Gửi gói nhỏ qua hãng vận chuyển thường tốn hơn giá trị điểm.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi về kho Tubu HCM' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/new?step=method', { replace: true, state: { draft: { ...DRAFT, method: 'MAIL_IN' } } });
    expect(screen.getByRole('button', { name: 'Thu kèm đơn mua' })).toBeInTheDocument();
  });
  it('khoá đường kho và cờ tắt → khối không có nút nào', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ shipLockedAt: '2026-10-01T00:00:00.000Z' }));
    renderPage();
    const block = (await screen.findByText('Chưa có điểm gần bạn?')).closest('section') as HTMLElement;
    expect(within(block).queryAllByRole('button')).toHaveLength(0);
  });
  it('chỉ cờ làn của tài khoản tắt (không khoá đường kho) → khối không có nút nào', async () => {
    mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: false, pickup: true };
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: false } }));
    renderPage();
    const block = (await screen.findByText('Chưa có điểm gần bạn?')).closest('section') as HTMLElement;
    expect(within(block).queryAllByRole('button')).toHaveLength(0);
  });
  it('mở từ màn sửa món → khối không có nút đổi cách giao (lần sửa không đổi được cách giao)', async () => {
    mocks.location.state = { ...NAV, returnTo: '/recycle/r/req-1/edit' };
    renderPage();
    const block = (await screen.findByText('Chưa có điểm gần bạn?')).closest('section') as HTMLElement;
    expect(within(block).queryAllByRole('button')).toHaveLength(0);
  });
  it('một PageHeader, không lồng nút', async () => {
    const { container } = renderPage();
    await screen.findAllByRole('radio');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });
});

describe('/recycle/points — món chỉ kho nhận (B-36)', () => {
  it('nói rõ vì sao điểm đại lý bị khoá khi đã chọn món chỉ kho nhận', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ items: [ITEM_CARTON, { ...ITEM_MILK, warehouseOnly: true }] }));
    mocks.location.state = NAV;
    mocks.getWastePoints.mockResolvedValue([HCM, makeWastePoint({ id: 'wh-1', kind: 'WAREHOUSE', name: 'Kho Tubu TP.HCM' })]);
    renderPage();
    expect(await screen.findByText(/Vỏ hộp sữa chỉ kho TP\.HCM nhận, nên các điểm đại lý đang bị khoá.*chọn kho Tubu/)).toBeInTheDocument();
  });
  it('kho không có trong danh sách (không ACTIVE): không bảo khách chọn kho, nói chưa có điểm nhận món này', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ items: [ITEM_CARTON, { ...ITEM_MILK, warehouseOnly: true }] }));
    mocks.location.state = NAV;
    renderPage();
    expect(await screen.findByText(/Vỏ hộp sữa chỉ kho TP\.HCM nhận, mà kho chưa nhận được lúc này. Hiện chưa có điểm nào nhận món này/)).toBeInTheDocument();
    expect(screen.queryByText(/chọn kho Tubu/)).toBeNull();
  });
});
