import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WasteDeskRequestDTO } from '@tubutree/shared-types';

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
  getDeskPoints: vi.fn(),
  deskLookup: vi.fn(),
  deskConfirm: vi.fn(),
  deskReject: vi.fn(),
  deskFulfilGift: vi.fn(),
  getDeskPointReport: vi.fn(),
  scanCode: vi.fn(),
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
vi.mock('../services/zmp-bridge', async (orig) => ({ ...(await orig<object>()), scanCode: mocks.scanCode }));
vi.mock('../utils/idempotency', () => ({ newIdempotencyKey: () => `key-${++mocks.keySeq}` }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.publicConfig }));
vi.mock('../services/waste-api', async (orig) => ({
  ...(await orig<object>()),
  getDeskPoints: mocks.getDeskPoints,
  deskLookup: mocks.deskLookup,
  deskConfirm: mocks.deskConfirm,
  deskReject: mocks.deskReject,
  deskFulfilGift: mocks.deskFulfilGift,
  getDeskPointReport: mocks.getDeskPointReport,
}));

import RecycleDeskPage, { deskPreviewPoints } from './recycle-desk';
import { makeDeskPoint, makeDeskRequest, makeGiftRedemption, WAREHOUSE_DESK } from '../services/waste-test-fixtures';
import { describeNested, findNestedInteractive } from '../components/ui/nested-interactive';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <RecycleDeskPage />
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidate };
}

const REQ = makeDeskRequest();
const LINE0 = REQ.lines[0]!;
const lookupReq = (over: Partial<WasteDeskRequestDTO> = {}) => mocks.deskLookup.mockResolvedValue({ type: 'REQUEST', request: { ...REQ, ...over } });
async function lookUp(code = 'tr-8k2m9') {
  fireEvent.change(await screen.findByLabelText('Mã yêu cầu hoặc mã nhận quà'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Tra mã' }));
}
const line = (name: string) => screen.getByText(name).closest('[data-line]') as HTMLElement;
const minus = (name: string, n: number) => { for (let i = 0; i < n; i++) fireEvent.click(within(line(name)).getByRole('button', { name: 'Giảm số lượng' })); };
const plus = (name: string, n: number) => { for (let i = 0; i < n; i++) fireEvent.click(within(line(name)).getByRole('button', { name: 'Tăng số lượng' })); };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDeskPoints.mockResolvedValue([makeDeskPoint()]);
  mocks.getDeskPointReport.mockResolvedValue({ pointId: 'pt-1', month: '2026-10', confirmations: 0, pointsAwarded: 0, quotaUsed: 0, units: [] });
  lookupReq();
});

describe('/recycle/desk — vào màn (§16.1, §4.10)', () => {
  it('không có điểm nào → không vào được, không có ô nhập mã', async () => {
    mocks.getDeskPoints.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Tài khoản của bạn chưa được gắn với điểm nhận nào')).toBeInTheDocument();
    expect(screen.queryByLabelText('Mã yêu cầu hoặc mã nhận quà')).toBeNull();
  });
  it('danh sách điểm lỗi → báo lỗi tải có nút Thử lại, bấm thì tải lại và vào được màn', async () => {
    mocks.getDeskPoints.mockRejectedValueOnce(new Error('Mất kết nối'));
    renderPage();
    expect(await screen.findByText('Mất kết nối')).toBeInTheDocument();
    expect(screen.queryByText('Tài khoản của bạn chưa được gắn với điểm nhận nào')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByLabelText('Mã yêu cầu hoặc mã nhận quà')).toBeInTheDocument();
    expect(mocks.getDeskPoints).toHaveBeenCalledTimes(2);
  });
  it('không có điểm nào khi chương trình tắt → báo tạm dừng, không báo chưa được gắn', async () => {
    mocks.getDeskPoints.mockResolvedValue([]);
    mocks.publicConfig.waste.enabled = false;
    try {
      renderPage();
      expect(await screen.findByText('Chương trình đang tạm dừng')).toBeInTheDocument();
      expect(screen.queryByText('Tài khoản của bạn chưa được gắn với điểm nhận nào')).toBeNull();
    } finally {
      mocks.publicConfig.waste.enabled = true;
    }
  });
  it('danh sách rỗng khi cấu hình công khai chưa tải → chưa kết luận tạm dừng hay chưa được gắn', async () => {
    mocks.getDeskPoints.mockResolvedValue([]);
    mocks.publicConfig.isLoaded = false;
    mocks.publicConfig.waste.enabled = false;
    try {
      renderPage();
      await waitFor(() => expect(mocks.getDeskPoints).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByText('Chương trình đang tạm dừng')).toBeNull();
      expect(screen.queryByText(/chưa được gắn/)).toBeNull();
    } finally {
      mocks.publicConfig.isLoaded = true;
      mocks.publicConfig.waste.enabled = true;
    }
  });
  it('đại lý: thẻ hạn mức tháng (đã dùng, còn lại) + ghi chú không tự cộng điểm', async () => {
    renderPage();
    expect(await screen.findByText('Hạn mức điểm tháng này')).toBeInTheDocument();
    expect(screen.getByText('Đã dùng 120.000 / 500.000 điểm')).toBeInTheDocument();
    expect(screen.getByText('Còn lại 380.000 điểm')).toBeInTheDocument();
    expect(screen.getByText('Tubu cộng điểm cho khách theo số bạn xác nhận. Điểm không do cửa hàng cộng.')).toBeInTheDocument();
  });
  it('điểm không có hạn mức tháng: ghi "Không giới hạn theo tháng", không lặp chữ "hạn" (D8-13)', async () => {
    mocks.getDeskPoints.mockResolvedValue([makeDeskPoint({ quota: null })]);
    renderPage();
    expect(await screen.findByText('Không giới hạn theo tháng')).toBeInTheDocument();
    expect(screen.queryByText(/giới hạn hạn mức/)).toBeNull();
  });
  it('một điểm: tên điểm hiện dưới tiêu đề; hạn mức có thanh tiến độ theo đã dùng trên giới hạn', async () => {
    renderPage();
    expect(await screen.findByText('Đại lý Cô Ba')).toBeInTheDocument();
    expect(screen.getByTestId('progress-fill')).toHaveStyle({ width: '24%' });
  });
  it('nhiều điểm: tên điểm chỉ nằm trên các tab, không lặp thành dòng riêng', async () => {
    mocks.getDeskPoints.mockResolvedValue([makeDeskPoint(), WAREHOUSE_DESK]);
    renderPage();
    await screen.findByRole('tab', { name: 'Đại lý Cô Ba' });
    expect(screen.getAllByText('Đại lý Cô Ba')).toHaveLength(1);
  });
  it('thứ tự: ô nhập mã, hạn mức, thẻ yêu cầu, rồi ưu đãi và báo cáo; xác nhận nằm trong thanh dính đáy', async () => {
    renderPage();
    await screen.findByText('Hạn mức điểm tháng này');
    await lookUp();
    await screen.findByText('Ng*** A');
    const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const quota = screen.getByText('Hạn mức điểm tháng này');
    const input = screen.getByLabelText('Mã yêu cầu hoặc mã nhận quà');
    const card = screen.getByText('Ng*** A');
    const perk = screen.getByText('Ưu đãi riêng của cửa hàng');
    const report = screen.getByText('Báo cáo tháng này');
    expect(before(input, quota) && before(quota, card) && before(card, perk) && before(perk, report)).toBe(true);
    expect(within(screen.getByTestId('sticky-bar')).getByRole('button', { name: 'Xác nhận đã nhận' })).toBeInTheDocument();
  });
  it('kho: không có thẻ hạn mức; có dòng trần nhân viên trong ngày', async () => {
    mocks.getDeskPoints.mockResolvedValue([WAREHOUSE_DESK]);
    renderPage();
    expect(await screen.findByText('Hôm nay còn xác nhận được 150.000 điểm')).toBeInTheDocument();
    expect(screen.queryByText('Hạn mức điểm tháng này')).toBeNull();
  });
  it('nhiều điểm → chọn điểm ở đầu màn', async () => {
    mocks.getDeskPoints.mockResolvedValue([makeDeskPoint(), WAREHOUSE_DESK]);
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Kho Tubu TP.HCM' }));
    expect(screen.getByText('Hôm nay còn xác nhận được 150.000 điểm')).toBeInTheDocument();
  });
});

describe('/recycle/desk — tra mã và đếm (§4.10)', () => {
  it('tra mã gửi mã đã chuẩn hoá (TR- viết hoa); thẻ yêu cầu che tên và số', async () => {
    renderPage();
    await lookUp();
    expect(mocks.deskLookup).toHaveBeenCalledWith('TR-8K2M9');
    expect(await screen.findByText('Ng*** A')).toBeInTheDocument();
    expect(screen.getByText('090****567')).toBeInTheDocument();
    expect(within(line('Thùng carton')).getByText('Khách khai 5 thùng')).toBeInTheDocument();
  });
  it('bộ đếm số thực nhận điền sẵn số khai, hiện "Tối đa N", không vượt số khai và chưa hỏi lý do', async () => {
    renderPage();
    await lookUp();
    await screen.findByText('Ng*** A');
    expect(within(line('Thùng carton')).getByText('5')).toBeInTheDocument();
    expect(within(line('Thùng carton')).getByText('Tối đa 5')).toBeInTheDocument();
    plus('Thùng carton', 2);
    expect(within(line('Thùng carton')).getByText('5')).toBeInTheDocument();
    expect(within(line('Thùng carton')).getByRole('button', { name: 'Tăng số lượng' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Xác nhận đã nhận' })).toBeEnabled();
    expect(screen.queryByText('Chọn lý do cho món nhận thiếu để xác nhận')).toBeNull();
  });
  it('điểm sẽ cộng tính trực tiếp theo nhóm', async () => {
    renderPage();
    await lookUp();
    await screen.findByText('Ng*** A');
    expect(screen.getByText('Điểm Tubu sẽ cộng cho khách: 6.000 điểm')).toBeInTheDocument();
    minus('Vỏ hộp sữa', 1);
    expect(screen.getByText('Điểm Tubu sẽ cộng cho khách: 5.000 điểm')).toBeInTheDocument();
    minus('Thùng carton', 5);
    minus('Vỏ hộp sữa', 4);
    expect(screen.getByText('Điểm Tubu sẽ cộng cho khách: 0 điểm')).toBeInTheDocument();
    expect(deskPreviewPoints([{ unitsPerPoint: 10, pointsPerGroup: 1000 }], { a: 25 }, ['a'])).toBe(2000);
  });
  it('dòng thiếu phải có lý do (7 lý do §4.10) thì nút xác nhận mới mở', async () => {
    renderPage();
    await lookUp();
    await screen.findByText('Ng*** A');
    minus('Vỏ hộp sữa', 2);
    const confirm = screen.getByRole('button', { name: 'Xác nhận đã nhận' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText('Chọn lý do cho món nhận thiếu để xác nhận')).toBeInTheDocument();
    expect(within(line('Vỏ hộp sữa')).getByText('Lý do nhận thiếu')).toBeInTheDocument();
    const reason = within(line('Vỏ hộp sữa')).getByRole('combobox', { name: 'Lý do nhận thiếu: Vỏ hộp sữa' });
    expect(within(reason).getByRole('option', { name: 'Chọn lý do' })).toBeDisabled();
    expect(reason).toHaveValue('');
    expect(within(reason).getAllByRole('option').slice(1).map((o) => o.textContent)).toEqual(['Ướt', 'Bẩn', 'Lẫn vật lạ', 'Sai loại', 'Hỏng', 'Không nhận', 'Khác']);
    expect(within(line('Thùng carton')).queryByRole('combobox')).toBeNull();
    fireEvent.change(reason, { target: { value: 'DIRTY' } });
    expect(confirm).toBeEnabled();
    expect(screen.queryByText('Chọn lý do cho món nhận thiếu để xác nhận')).toBeNull();
  });
  it('pin: có bộ đếm, nhắc cất riêng, 25 viên cộng 2.000 điểm, gửi số nhận thật không kèm lý do', async () => {
    lookupReq({ lines: [{ ...LINE0, itemId: 'item-battery', itemName: 'Pin cũ', unitLabel: 'viên', hazardous: true, declaredQty: 25, unitsPerPoint: 10, pointsPerGroup: 1000 }] });
    renderPage();
    await lookUp();
    await screen.findByText('Ng*** A');
    expect(within(line('Pin cũ')).getByRole('button', { name: 'Tăng số lượng' })).toBeInTheDocument();
    expect(within(line('Pin cũ')).getByText('Cất riêng vào thùng kín, không lẫn rác khác')).toBeInTheDocument();
    expect(screen.getByText('Điểm Tubu sẽ cộng cho khách: 2.000 điểm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xác nhận đã nhận' })).toBeEnabled();
    mocks.deskConfirm.mockResolvedValue({ requestId: 'req-1', code: 'TR-8K2M9', status: 'COMPLETED', pointsAwarded: 2000, dropsAwarded: 0, quota: { limit: 500_000, used: 120_000, remaining: 380_000 }, staffDailyCapRemaining: 150_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận' }));
    await waitFor(() => expect(mocks.deskConfirm).toHaveBeenCalledWith('req-1', { lines: [{ itemId: 'item-battery', declaredQty: 25, receivedQty: 25 }] }));
  });
  it('yêu cầu đã xác nhận hoặc đã từ chối (tra lại trong 24 giờ) → thẻ chỉ xem, không bộ đếm, không nút', async () => {
    lookupReq({ status: 'COMPLETED', lines: [{ ...LINE0, receivedQty: 5 }] });
    renderPage();
    await lookUp();
    expect(await screen.findByText('Đã xác nhận')).toBeInTheDocument();
    expect(within(line('Thùng carton')).getByText('Đã nhận 5 thùng')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tăng số lượng' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xác nhận đã nhận' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Từ chối cả yêu cầu' })).toBeNull();
  });
});

describe('/recycle/desk — xác nhận và từ chối (§4.10, §15.5)', () => {
  it('xác nhận: body đủ dòng, snackbar "Tubu sẽ cộng N điểm cho khách", hạn mức mới, xoá thẻ', async () => {
    mocks.deskConfirm.mockResolvedValue({ requestId: 'req-1', code: 'TR-8K2M9', status: 'COMPLETED', pointsAwarded: 6000, dropsAwarded: 0, quota: { limit: 500_000, used: 126_000, remaining: 374_000 }, staffDailyCapRemaining: 150_000 });
    renderPage();
    await lookUp();
    await screen.findByText('Ng*** A');
    mocks.getDeskPoints.mockResolvedValue([makeDeskPoint({ quota: { limit: 500_000, used: 126_000, remaining: 374_000 } })]);
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận' }));
    await waitFor(() => expect(mocks.deskConfirm).toHaveBeenCalledWith('req-1', { lines: [{ itemId: 'item-carton', declaredQty: 5, receivedQty: 5 }, { itemId: 'item-milk', declaredQty: 5, receivedQty: 5 }] }));
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Tubu sẽ cộng 6.000 điểm cho khách', type: 'success' }));
    expect(await screen.findByText('Còn lại 374.000 điểm')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xác nhận đã nhận' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Từ chối cả yêu cầu' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Đã ghi nhận. Tubu sẽ cộng 6.000 điểm cho khách');
    expect(screen.getByText('Yêu cầu TR-8K2M9 của Ng*** A đã xong')).toBeInTheDocument();
    expect(screen.getByText('Hạn mức còn lại: 374.000 điểm')).toBeInTheDocument();
    expect(screen.getByLabelText('Mã yêu cầu hoặc mã nhận quà')).toHaveValue('');
  });
  it('thẻ kết quả ở lại màn tới khi bấm "Nhận yêu cầu khác"; số hạn mức lấy từ phản hồi, không bịa khi điểm không giới hạn', async () => {
    mocks.deskConfirm.mockResolvedValue({ requestId: 'req-1', code: 'TR-8K2M9', status: 'COMPLETED', pointsAwarded: 6000, dropsAwarded: 0, quota: null, staffDailyCapRemaining: 150_000 });
    renderPage();
    await lookUp();
    await screen.findByText('Ng*** A');
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận' }));
    expect(await screen.findByText('Yêu cầu TR-8K2M9 của Ng*** A đã xong')).toBeInTheDocument();
    expect(screen.queryByText(/Hạn mức còn lại:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nhận yêu cầu khác' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByLabelText('Mã yêu cầu hoặc mã nhận quà')).toHaveValue('');
  });
  it('dòng thiếu gửi kèm shortfallReason', async () => {
    mocks.deskConfirm.mockResolvedValue({ requestId: 'req-1', code: 'TR-8K2M9', status: 'COMPLETED', pointsAwarded: 5000, dropsAwarded: 0, quota: null, staffDailyCapRemaining: 150_000 });
    renderPage();
    await lookUp();
    await screen.findByText('Ng*** A');
    minus('Vỏ hộp sữa', 5);
    fireEvent.change(within(line('Vỏ hộp sữa')).getByRole('combobox'), { target: { value: 'WET' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận' }));
    await waitFor(() => expect(mocks.deskConfirm.mock.calls[0]![1].lines[1]).toEqual({ itemId: 'item-milk', declaredQty: 5, receivedQty: 0, shortfallReason: 'WET' }));
  });
  it('kho + Gửi về kho chưa nhận: xác nhận và từ chối gửi match.parcelCode là mã yêu cầu đã tra (§15.3, §15.5)', async () => {
    mocks.getDeskPoints.mockResolvedValue([WAREHOUSE_DESK]);
    lookupReq({ method: 'MAIL_IN', status: 'IN_TRANSIT', pointId: 'wh-1', lines: [LINE0] });
    mocks.deskConfirm.mockRejectedValueOnce(new Error('Vui lòng thử lại'));
    mocks.deskReject.mockResolvedValue({ requestId: 'req-1', code: 'TR-8K2M9', status: 'REJECTED' });
    renderPage();
    await lookUp('TR-8K2M9');
    await screen.findByText('Ng*** A');
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận' }));
    await waitFor(() => expect(mocks.deskConfirm).toHaveBeenCalledWith('req-1', { lines: [{ itemId: 'item-carton', declaredQty: 5, receivedQty: 5 }], match: { parcelCode: 'TR-8K2M9' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Từ chối cả yêu cầu' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ướt' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Từ chối yêu cầu' }));
    await waitFor(() => expect(mocks.deskReject).toHaveBeenCalledWith('req-1', { rejectionReason: 'WET', match: { parcelCode: 'TR-8K2M9' } }));
  });
  it('điểm nhận (đại lý) không gửi match', async () => {
    mocks.deskConfirm.mockResolvedValue({ requestId: 'req-1', code: 'TR-8K2M9', status: 'COMPLETED', pointsAwarded: 6000, dropsAwarded: 0, quota: { limit: 500_000, used: 126_000, remaining: 374_000 }, staffDailyCapRemaining: 150_000 });
    renderPage();
    await lookUp();
    await screen.findByText('Ng*** A');
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận' }));
    await waitFor(() => expect(mocks.deskConfirm).toHaveBeenCalled());
    expect(mocks.deskConfirm.mock.calls[0]![1]).not.toHaveProperty('match');
  });
  it('bưu kiện Gửi về kho tra khi đang chọn tab đối tác vẫn gửi match (tra mã tìm ở mọi điểm của người gọi)', async () => {
    mocks.getDeskPoints.mockResolvedValue([makeDeskPoint(), WAREHOUSE_DESK]);
    lookupReq({ method: 'MAIL_IN', status: 'IN_TRANSIT', pointId: 'wh-1', lines: [LINE0] });
    mocks.deskConfirm.mockResolvedValue({ requestId: 'req-1', code: 'TR-8K2M9', status: 'COMPLETED', pointsAwarded: 5000, dropsAwarded: 0, quota: null, staffDailyCapRemaining: 145_000 });
    renderPage();
    await lookUp('TR-8K2M9');
    await screen.findByText('Ng*** A');
    // Lần tải lại không bao giờ xong, nên chỉ còn phần ghi thẳng vào cache quyết định thẻ hạn mức hiện ra.
    mocks.getDeskPoints.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận' }));
    await waitFor(() => expect(mocks.deskConfirm).toHaveBeenCalledWith('req-1', { lines: [{ itemId: 'item-carton', declaredQty: 5, receivedQty: 5 }], match: { parcelCode: 'TR-8K2M9' } }));
    await waitFor(() => expect(screen.queryByText('Ng*** A')).toBeNull());
    expect(screen.getByText('Còn lại 380.000 điểm')).toBeInTheDocument();
    expect(screen.queryByText('Không giới hạn hạn mức tháng')).toBeNull();
  });
  it('kho + kiện đã RECEIVED: không gửi match', async () => {
    mocks.getDeskPoints.mockResolvedValue([WAREHOUSE_DESK]);
    lookupReq({ method: 'MAIL_IN', status: 'RECEIVED', pointId: 'wh-1', lines: [LINE0] });
    mocks.deskConfirm.mockResolvedValue({ requestId: 'req-1', code: 'TR-8K2M9', status: 'COMPLETED', pointsAwarded: 5000, dropsAwarded: 0, quota: null, staffDailyCapRemaining: 145_000 });
    renderPage();
    await lookUp('TR-8K2M9');
    await screen.findByText('Ng*** A');
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận' }));
    await waitFor(() => expect(mocks.deskConfirm).toHaveBeenCalled());
    expect(mocks.deskConfirm.mock.calls[0]![1]).not.toHaveProperty('match');
  });
  it('kho: thẻ kết quả nêu số điểm còn được xác nhận hôm nay lấy từ phản hồi', async () => {
    mocks.getDeskPoints.mockResolvedValue([WAREHOUSE_DESK]);
    lookupReq({ method: 'MAIL_IN', status: 'RECEIVED', pointId: 'wh-1', lines: [LINE0] });
    mocks.deskConfirm.mockResolvedValue({ requestId: 'req-1', code: 'TR-8K2M9', status: 'COMPLETED', pointsAwarded: 5000, dropsAwarded: 0, quota: null, staffDailyCapRemaining: 150_000 });
    renderPage();
    await lookUp('TR-8K2M9');
    await screen.findByText('Ng*** A');
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận' }));
    expect(await screen.findByText('Còn được xác nhận hôm nay: 150.000 điểm')).toBeInTheDocument();
    expect(screen.queryByText(/Hạn mức còn lại:/)).toBeNull();
  });
  it.each([
    'Không tìm thấy mã',
    'Điểm đã hết hạn mức tháng, còn 3.000 điểm',
    'Khách đang bị khoá, không cộng điểm được',
    'Yêu cầu này đang chờ Tubu xử lý, chưa xác nhận được tại điểm',
    'Bạn không thể xác nhận yêu cầu này',
    'Bạn đã chạm trần điểm xác nhận hôm nay',
    'Khách vừa sửa yêu cầu, vui lòng tra lại mã',
  ])('lỗi máy chủ "%s" hiện nguyên văn bằng snackbar', async (msg) => {
    mocks.deskConfirm.mockRejectedValue(new Error(msg));
    renderPage();
    await lookUp();
    await screen.findByText('Ng*** A');
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: msg, type: 'error' })));
  });
  it('tra mã trượt → snackbar "Không tìm thấy mã"', async () => {
    mocks.deskLookup.mockRejectedValue(new Error('Không tìm thấy mã'));
    renderPage();
    await lookUp('TR-XXXXX');
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Không tìm thấy mã', type: 'error' })));
  });
  it('"Từ chối cả yêu cầu": chọn lý do (danh sách của điểm) rồi gọi reject', async () => {
    mocks.deskReject.mockResolvedValue({ requestId: 'req-1', code: 'TR-8K2M9', status: 'REJECTED' });
    renderPage();
    await lookUp();
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối cả yêu cầu' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Ướt', 'Bẩn', 'Lẫn vật lạ', 'Sai loại', 'Hỏng', 'Không nhận', 'Quá khổ', 'Có pin hoặc vật nguy hại', 'Khác']);
    const send = within(sheet).getByRole('button', { name: 'Từ chối yêu cầu' });
    expect(send).toBeDisabled();
    expect(within(sheet).getByText('Chọn một lý do')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Ướt' }));
    expect(within(sheet).queryByText('Chọn một lý do')).toBeNull();
    fireEvent.change(within(sheet).getByLabelText('Ghi chú (không bắt buộc)'), { target: { value: 'thùng ướt hết' } });
    fireEvent.click(send);
    await waitFor(() => expect(mocks.deskReject).toHaveBeenCalledWith('req-1', { rejectionReason: 'WET', rejectionNote: 'thùng ướt hết' }));
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã từ chối yêu cầu TR-8K2M9' }));
  });
  it('lý do Khác bắt buộc ghi chú (§15.3)', async () => {
    renderPage();
    await lookUp();
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối cả yêu cầu' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Khác' }));
    const send = within(sheet).getByRole('button', { name: 'Từ chối yêu cầu' });
    expect(send).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText('Ghi chú (bắt buộc với lý do Khác)'), { target: { value: 'thùng lẫn đồ khác' } });
    expect(send).toBeEnabled();
  });
  it('một PageHeader, không lồng nút', async () => {
    const { container } = renderPage();
    await lookUp();
    await screen.findByText('Ng*** A');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });
});

describe('/recycle/desk — trao quà ở kho (§8, §15.3)', () => {
  const GIFT = { id: 'red-1', giftName: 'Gói hạt giống Tubu', customerName: 'Ng*** A', status: 'READY' as const, claimExpiresAt: '2026-12-16T17:30:00.000Z' };
  beforeEach(() => { mocks.getDeskPoints.mockResolvedValue([WAREHOUSE_DESK]); mocks.deskLookup.mockResolvedValue({ type: 'GIFT', redemption: GIFT }); });
  it('mã QG- ở kho trao quà: tên quà, khách che, hạn nhận theo giờ VN, "Trao quà" gửi code + pointId', async () => {
    mocks.deskFulfilGift.mockResolvedValue(makeGiftRedemption({ status: 'FULFILLED' }));
    renderPage();
    await lookUp('qg-8k2m9p4t');
    expect(await screen.findByText('Gói hạt giống Tubu')).toBeInTheDocument();
    expect(screen.getByText('Hạn nhận 17/12/2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trao quà' }));
    await waitFor(() => expect(mocks.deskFulfilGift).toHaveBeenCalledWith({ code: 'QG-8K2M9P4T', pointId: 'wh-1' }));
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã trao Gói hạt giống Tubu', type: 'success' }));
    expect(screen.queryByText('Gói hạt giống Tubu')).toBeNull();
  });
  it('Trao quà dùng mã đã tra, không dùng chữ đang gõ dở', async () => {
    mocks.deskFulfilGift.mockResolvedValue(makeGiftRedemption({ status: 'FULFILLED' }));
    renderPage();
    await lookUp('QG-AAAAAAAA');
    await screen.findByText('Gói hạt giống Tubu');
    fireEvent.change(screen.getByLabelText('Mã yêu cầu hoặc mã nhận quà'), { target: { value: 'QG-BBBBBBBB' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trao quà' }));
    await waitFor(() => expect(mocks.deskFulfilGift).toHaveBeenCalledWith({ code: 'QG-AAAAAAAA', pointId: 'wh-1' }));
  });
  it('Trao quà dùng mã đã gửi tra, kể cả khi ô mã đổi lúc đang tra', async () => {
    let resolve!: (v: unknown) => void;
    mocks.deskLookup.mockReturnValue(new Promise((r) => { resolve = r; }));
    mocks.deskFulfilGift.mockResolvedValue(makeGiftRedemption({ status: 'FULFILLED' }));
    renderPage();
    await lookUp('QG-AAAAAAAA');
    fireEvent.change(screen.getByLabelText('Mã yêu cầu hoặc mã nhận quà'), { target: { value: 'QG-BBBBBBBB' } });
    resolve({ type: 'GIFT', redemption: GIFT });
    fireEvent.click(await screen.findByRole('button', { name: 'Trao quà' }));
    await waitFor(() => expect(mocks.deskFulfilGift).toHaveBeenCalledWith({ code: 'QG-AAAAAAAA', pointId: 'wh-1' }));
  });
  it('"Trao quà" khoá khi đang gửi: bấm hai lần chỉ gọi một lần', async () => {
    mocks.deskFulfilGift.mockReturnValue(new Promise(() => {}));
    renderPage();
    await lookUp('QG-8K2M9P4T');
    fireEvent.click(await screen.findByRole('button', { name: 'Trao quà' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Trao quà' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Trao quà' }));
    expect(mocks.deskFulfilGift).toHaveBeenCalledTimes(1);
  });
  it('điểm không bật trao quà → không có nút, có câu giải thích', async () => {
    mocks.getDeskPoints.mockResolvedValue([{ ...WAREHOUSE_DESK, giftHandoverEnabled: false }]);
    renderPage();
    await lookUp('QG-8K2M9P4T');
    expect(await screen.findByText('Điểm này không trao quà')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trao quà' })).toBeNull();
  });
  it.each([
    ['FULFILLED', 'Quà đã được trao'],
    ['CANCELLED', 'Lượt đổi quà đã huỷ'],
  ] as const)('lượt không còn READY (%s) → hiện trạng thái, không có nút', async (status, text) => {
    mocks.deskLookup.mockResolvedValue({ type: 'GIFT', redemption: { ...GIFT, status } });
    renderPage();
    await lookUp('QG-8K2M9P4T');
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trao quà' })).toBeNull();
  });
  it('đại lý: thẻ ưu đãi và báo cáo tháng hiện; kho thì không có thẻ ưu đãi', async () => {
    mocks.getDeskPoints.mockResolvedValue([makeDeskPoint(), WAREHOUSE_DESK]);
    mocks.getDeskPointReport.mockResolvedValue({ pointId: 'pt-1', month: '2026-10', confirmations: 0, pointsAwarded: 0, quotaUsed: 0, units: [] });
    renderPage();
    expect(await screen.findByText('Ưu đãi riêng của cửa hàng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Kho Tubu TP.HCM' }));
    expect(screen.queryByText('Ưu đãi riêng của cửa hàng')).toBeNull();
  });
});

describe('/recycle/desk — quét mã và gõ mã (B-35)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.status = 'authenticated';
    mocks.getDeskPoints.mockResolvedValue([makeDeskPoint()]);
    lookupReq();
  });

  it('nút "Quét mã của khách" nằm trước ô gõ; quét ra mã thì tra luôn', async () => {
    mocks.scanCode.mockResolvedValue({ kind: 'ok', content: 'TR-8K2M9' });
    renderPage();
    const scan = await screen.findByRole('button', { name: 'Quét mã của khách' });
    const input = screen.getByLabelText('Mã yêu cầu hoặc mã nhận quà');
    expect(scan.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(scan);
    await waitFor(() => expect(mocks.deskLookup).toHaveBeenCalledWith('TR-8K2M9'));
  });

  it('quét ra nội dung không phải mã Đổi rác thì báo và không tra', async () => {
    mocks.scanCode.mockResolvedValue({ kind: 'ok', content: 'https://example.com' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Quét mã của khách' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text: expect.stringContaining('không phải mã Đổi rác') })));
    expect(mocks.deskLookup).not.toHaveBeenCalled();
  });

  it('đóng camera thì im lặng, camera lỗi thì báo gõ tay', async () => {
    mocks.scanCode.mockResolvedValueOnce({ kind: 'cancelled' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Quét mã của khách' }));
    await waitFor(() => expect(mocks.scanCode).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    mocks.scanCode.mockResolvedValueOnce({ kind: 'failed' });
    fireEvent.click(screen.getByRole('button', { name: 'Quét mã của khách' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('gõ mã') })));
    expect(mocks.deskLookup).not.toHaveBeenCalled();
  });

  it('ô gõ có ví dụ mẫu; mã thiếu "TR-" vẫn tra được; Enter là tra', async () => {
    renderPage();
    const input = await screen.findByLabelText('Mã yêu cầu hoặc mã nhận quà');
    expect(input).toHaveAttribute('placeholder', 'VD: TR-6NY3J');
    fireEvent.change(input, { target: { value: '6ny3j' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    await waitFor(() => expect(mocks.deskLookup).toHaveBeenCalledWith('TR-6NY3J'));
    await waitFor(() => expect(input).toHaveValue('TR-6NY3J'));
  });
});
