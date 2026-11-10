import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findNestedInteractive, describeNested } from '../components/ui/nested-interactive';
import { ITEM_BATTERY, ITEM_CARTON, ITEM_MILK, makeRequestDetail, makeWasteMe, makeWastePoint } from '../services/waste-test-fixtures';

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
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div data-testid="zaui-sheet">{children}</div> : null),
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location,
  useParams: () => mocks.params,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/api', async (orig) => ({
  ...(await orig<object>()),
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
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

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
  it('/waste/me lỗi → câu lỗi + "Thử lại" (không skeleton mãi); bấm thì tải lại', async () => {
    mocks.getWasteMe.mockRejectedValueOnce(new Error('Máy chủ bận'));
    renderPage();
    expect(await screen.findByText('Máy chủ bận')).toBeInTheDocument();
    expect(mocks.getWasteMe).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Thùng carton')).toBeInTheDocument();
    expect(mocks.getWasteMe).toHaveBeenCalledTimes(2);
  });
  it('bộ đếm lấy số đã khai; trần cộng thêm phần đang giữ của chính yêu cầu', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ items: [{ ...ITEM_CARTON, monthRemainingQty: 0 }, ITEM_MILK] }));
    renderPage();
    const carton = (await screen.findByText('Thùng carton')).closest('[data-item]') as HTMLElement;
    expect(within(carton).getByRole('textbox', { name: 'Số lượng' })).toHaveValue('5');
    expect(within(carton).getByRole('button', { name: 'Tăng số lượng' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(carton).getByRole('button', { name: 'Giảm số lượng' })).toHaveAttribute('aria-disabled', 'false');
  });
  describe('trần ngày của món chỉ mang tới theo ngày của yêu cầu', () => {
    const pin = { ...ITEM_BATTERY, status: 'ACTIVE' as const, hazardous: true, dailyCapQty: 20, monthlyCapQty: 50, monthRemainingQty: 50, dayRemainingQty: 0 };
    const withPin = (createdAt: string, declaredQty: number) => {
      const base = makeRequestDetail();
      mocks.getWasteMe.mockResolvedValue(makeWasteMe({ items: [ITEM_CARTON, pin] }));
      mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ createdAt, lines: [{ ...base.lines[0]!, itemId: 'item-battery', itemName: 'Pin đã dùng', unitLabel: 'viên', declaredQty }] }));
    };
    it('tạo hôm nay và đã giữ đủ trần: chỉ câu trần, không "còn 0", không tăng quá trần', async () => {
      withPin(new Date().toISOString(), 20);
      renderPage();
      const card = (await screen.findByText('Pin đã dùng')).closest('[data-item]') as HTMLElement;
      expect(within(card).queryByText(/Hôm nay còn nhận được/)).toBeNull();
      expect(within(card).getByText(/Mỗi ngày mang tới điểm nhận tối đa 20 viên/)).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: 'Tăng số lượng' })).toHaveAttribute('aria-disabled', 'true');
    });
    it('không tạo hôm nay: không áp trần ngày phía khách, không dòng "Hôm nay còn…"', async () => {
      withPin('2026-10-17T03:00:00.000Z', 5);
      renderPage();
      const card = (await screen.findByText('Pin đã dùng')).closest('[data-item]') as HTMLElement;
      expect(within(card).queryByText(/Hôm nay còn nhận được/)).toBeNull();
      expect(within(card).getByRole('button', { name: 'Tăng số lượng' })).toHaveAttribute('aria-disabled', 'false');
    });
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
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ lines: [...base.lines, { ...base.lines[0]!, itemId: 'item-battery', itemName: 'Pin đã dùng', unitLabel: 'viên', declaredQty: 2 }] }));
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

describe('/recycle/r/:id/edit: Lưu khoá chạm đúp (W73A)', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('chạm đúp "Lưu thay đổi" trong cùng một khung hình chỉ gửi một lần', async () => {
    const d = deferred();
    mocks.editWasteRequest.mockReturnValueOnce(d.promise);
    renderPage();
    const save = await screen.findByRole('button', { name: 'Lưu thay đổi' });
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(mocks.editWasteRequest).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(makeRequestDetail()));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/req-1', { replace: true }));
  });

  it('đang lưu: nút aria-busy; lỗi thì nhả khoá để bấm lại được', async () => {
    const d = deferred();
    mocks.editWasteRequest.mockReturnValueOnce(d.promise);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toHaveAttribute('aria-busy', 'true'));
    await act(async () => d.reject(new Error('Máy chủ bận')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Máy chủ bận', type: 'error' })));
    mocks.editWasteRequest.mockResolvedValueOnce(makeRequestDetail());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.editWasteRequest).toHaveBeenCalledTimes(2));
  });
});

describe('/recycle/r/:id/edit: Lưu bị máy chủ từ chối thì tải lại rồi mới nhả khoá (W110A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  // TanStack báo cache qua setTimeout(0) nên phải đợi một nhịp sau khi lời hứa tải lại xong.
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const saveButton = () => screen.getByRole('button', { name: 'Lưu thay đổi' });
  const errorToasts = (text: string) => mocks.openSnackbar.mock.calls.filter((c) => c[0].text === text && c[0].type === 'error');

  /** Dựng trang kèm QueryClient để soi lệnh tải lại; `refresh` trả lời hứa cho từng khoá (không trả thì xong ngay). */
  function renderLive(refresh?: (key: readonly unknown[]) => Promise<unknown> | undefined) {
    const view = renderPage();
    const invalidated: unknown[][] = [];
    view.invalidate.mockImplementation(((filters: { queryKey: readonly unknown[] }) => {
      invalidated.push([...filters.queryKey]);
      return refresh?.(filters.queryKey) ?? Promise.resolve();
    }) as never);
    return { ...view, invalidated };
  }

  it.each([
    ['409 không còn sửa được', 'Yêu cầu này không còn sửa được', 409],
    ['400 luật đã đổi', 'Món này hiện chưa nhận, hãy bỏ khỏi danh sách', 400],
    ['404 yêu cầu không còn', 'Không tìm thấy yêu cầu', 404],
  ] as const)('bị từ chối %s: báo lỗi đúng một lần, tải lại yêu cầu, hồ sơ, ước tính; khoá giữ tới khi yêu cầu về', async (_label, message, status) => {
    mocks.editWasteRequest.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(makeRequestDetail());
    const refresh = deferred();
    const { invalidated } = renderLive((key) => (key[1] === 'request' ? (refresh.promise as Promise<unknown>) : undefined));
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(errorToasts(message)).toHaveLength(1));
    await waitFor(() => expect(invalidated).toEqual(expect.arrayContaining([['waste', 'request', 'req-1'], ['waste', 'me'], ['waste', 'preview', 'edit', 'req-1']])));
    // Đã có lời báo lỗi mà yêu cầu chưa về: nút vẫn bận, chạm thêm không gửi lại trên dữ liệu cũ.
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(saveButton());
    await settle();
    expect(mocks.editWasteRequest).toHaveBeenCalledTimes(1);
    expect(errorToasts(message)).toHaveLength(1);
    await act(async () => refresh.resolve());
    await settle();
    await waitFor(() => expect(saveButton()).not.toHaveAttribute('aria-busy'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.editWasteRequest).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ])('%s: không phải dữ liệu cũ nên không tải lại, khoá nhả ngay', async (_label, error) => {
    mocks.editWasteRequest.mockRejectedValueOnce(error).mockResolvedValue(makeRequestDetail());
    // Mọi lệnh tải lại treo mãi: nếu khoá còn đợi chúng thì nút không bao giờ sáng lại.
    const { invalidated } = renderLive(() => new Promise<unknown>(() => undefined));
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: error.message, type: 'error' })));
    await waitFor(() => expect(saveButton()).not.toHaveAttribute('aria-busy'));
    expect(invalidated).toEqual([]);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.editWasteRequest).toHaveBeenCalledTimes(2));
  });

  it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS, không giữ nút mãi', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.editWasteRequest.mockRejectedValueOnce(serverError('Yêu cầu này không còn sửa được', 409)).mockResolvedValue(makeRequestDetail());
      renderLive(() => new Promise<unknown>(() => undefined));
      fireEvent.click(await screen.findByRole('button', { name: 'Lưu thay đổi' }));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Yêu cầu này không còn sửa được', type: 'error' })));
      expect(saveButton()).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(saveButton()).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() => expect(saveButton()).not.toHaveAttribute('aria-busy'));
      fireEvent.click(saveButton());
      await waitFor(() => expect(mocks.editWasteRequest).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('bị từ chối vì yêu cầu không còn sửa được: lời báo hiện trước, rồi yêu cầu tải lại thật không còn editable thì màn tự về chi tiết yêu cầu (hành vi sẵn có)', async () => {
    mocks.editWasteRequest.mockRejectedValueOnce(serverError('Yêu cầu này không còn sửa được', 409));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu thay đổi' }));
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ editable: false, cancellable: false, status: 'CANCELLED' }));
    await waitFor(() => expect(errorToasts('Yêu cầu này không còn sửa được')).toHaveLength(1));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/req-1', { replace: true }));
    expect(errorToasts('Yêu cầu này không còn sửa được')).toHaveLength(1);
  });
});
