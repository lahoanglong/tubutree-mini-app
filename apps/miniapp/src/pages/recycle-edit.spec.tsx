import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findNestedInteractive, describeNested } from '../components/ui/nested-interactive';
import { ITEM_CARTON, ITEM_MILK, makeRequestDetail, makeWasteMe, makeWastePoint } from '../services/waste-test-fixtures';

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
  getWasteRequest: vi.fn(),
  getWasteMe: vi.fn(),
  previewWaste: vi.fn(),
  editWasteRequest: vi.fn(),
  invalidate: vi.fn(),
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
  previewWaste: mocks.previewWaste,
  editWasteRequest: mocks.editWasteRequest,
  invalidateAfterWasteWrite: mocks.invalidate,
}));
vi.mock('../utils/waste-labels', async (o) => ({ ...(await o<object>()), PREVIEW_DEBOUNCE_MS: 0 }));

import RecycleEditPage from './recycle-edit';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <RecycleEditPage />
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidate };
}

mocks.params = { id: 'req-1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.location.state = null;
  mocks.getWasteMe.mockResolvedValue(makeWasteMe());
  mocks.getWasteRequest.mockResolvedValue(makeRequestDetail());
  mocks.previewWaste.mockResolvedValue({ estimatedPoints: 6000, estimatedDrops: 0, estimatedGrams: null, pointsValueVnd: 6000, blocks: [], feeEstimate: null, itemCaps: [], pointsMonthRemaining: 190_000 });
});

describe('/recycle/r/:id/edit (§4.5, §7.4)', () => {
  it('không sửa được → về trang yêu cầu', async () => {
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ editable: false }));
    renderPage();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/req-1', { replace: true }));
  });
  it('khách bị khoá chương trình → về trang yêu cầu (sửa bị chặn, §15.1)', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ blocked: true }));
    renderPage();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/req-1', { replace: true }));
  });
  it('bộ đếm lấy số đã khai; trần cộng thêm phần đang giữ của chính yêu cầu', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ items: [{ ...ITEM_CARTON, monthRemainingQty: 0 }, ITEM_MILK] }));
    renderPage();
    const carton = (await screen.findByText('Thùng carton')).closest('[data-item]') as HTMLElement;
    expect(within(carton).getByText('5')).toBeInTheDocument();
    expect(within(carton).getByRole('button', { name: 'Tăng số lượng' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(carton).getByRole('button', { name: 'Giảm số lượng' })).toHaveAttribute('aria-disabled', 'false');
  });
  it('nói rõ điểm ước tính có thể đổi và hạn giữ chỗ không đổi', async () => {
    renderPage();
    expect(await screen.findByText('Điểm ước tính có thể thay đổi theo mức quy đổi hiện hành')).toBeInTheDocument();
    expect(screen.getByText('Hạn giữ chỗ không đổi: 25/10/2026')).toBeInTheDocument();
    expect(await screen.findByText('Ước tính mới 6.000 điểm')).toBeInTheDocument();
  });
  it('Mang tới điểm nhận: "Đổi điểm nhận" mở /recycle/points (thay mục) và quay về đây', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi điểm nhận' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/points', { replace: true, state: expect.objectContaining({ returnTo: '/recycle/r/req-1/edit', selectedItemIds: ['item-carton'], draft: expect.objectContaining({ method: 'DROP_OFF', pointId: 'pt-1', lines: { 'item-carton': 5 } }) }) });
  });
  it('quay về từ /recycle/points: dùng nháp trong state (món + điểm mới)', async () => {
    mocks.location.state = { draft: { lines: { 'item-carton': 3 }, method: 'DROP_OFF', pointId: 'pt-2', pickedPoint: makeWastePoint({ id: 'pt-2', name: 'Đại lý Mới' }), provinceCode: null, nearby: null } };
    mocks.editWasteRequest.mockResolvedValue(makeRequestDetail());
    renderPage();
    expect(await screen.findByText('Đại lý Mới')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.editWasteRequest).toHaveBeenCalledWith('req-1', { lines: [{ itemId: 'item-carton', declaredQty: 3 }], pointId: 'pt-2' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/r/req-1', { replace: true }));
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });
  it('Gửi về kho: không có bộ chọn điểm, body không có pointId; lỗi hiện câu máy chủ', async () => {
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ method: 'MAIL_IN', point: null }));
    mocks.editWasteRequest.mockRejectedValue(new Error('Món này hiện chưa nhận, hãy bỏ khỏi danh sách'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.editWasteRequest).toHaveBeenCalledWith('req-1', { lines: [{ itemId: 'item-carton', declaredQty: 5 }] }));
    expect(screen.queryByRole('button', { name: 'Đổi điểm nhận' })).toBeNull();
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Món này hiện chưa nhận, hãy bỏ khỏi danh sách', type: 'error' })));
  });
  it('dòng của món không còn nhận: phải bỏ được trước khi lưu (§15.2 PATCH)', async () => {
    const base = makeRequestDetail();
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ lines: [...base.lines, { ...base.lines[0]!, itemId: 'item-battery', itemName: 'Pin cũ', unitLabel: 'viên', declaredQty: 2 }] }));
    mocks.editWasteRequest.mockResolvedValue(makeRequestDetail());
    renderPage();
    expect(await screen.findByText('Món này hiện chưa nhận')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Lưu thay đổi' });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ món này' }));
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(mocks.editWasteRequest).toHaveBeenCalledWith('req-1', { lines: [{ itemId: 'item-carton', declaredQty: 5 }], pointId: 'pt-1' }));
  });
  it('một PageHeader, không lồng nút', async () => {
    const { container } = renderPage();
    await screen.findByText('Thùng carton');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });
});
