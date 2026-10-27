import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WasteRequestDetailDTO } from '@tubutree/shared-types';

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
  getWastePoints: vi.fn(),
  setWasteTracking: vi.fn(),
  cancelWasteRequest: vi.fn(),
  invalidate: vi.fn(),
  copyText: vi.fn(),
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
  getWastePoints: mocks.getWastePoints,
  setWasteTracking: mocks.setWasteTracking,
  cancelWasteRequest: mocks.cancelWasteRequest,
  invalidateAfterWasteWrite: mocks.invalidate,
}));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../components/qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));
vi.mock('../components/support-contact', () => ({ SupportContact: () => <div data-testid="support-contact" /> }));

import RecycleRequestPage from './recycle-request';
import { makeRequestDetail, makeWasteMe, makeWastePoint, makeWarehouseContact } from '../services/waste-test-fixtures';
import { describeNested, findNestedInteractive } from '../components/ui/nested-interactive';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <RecycleRequestPage />
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidate };
}

const MAIL = (over: Partial<WasteRequestDetailDTO> = {}) => makeRequestDetail({ method: 'MAIL_IN', pointName: 'Kho Tubu TP.HCM', point: makeWarehouseContact(), editable: true, cancellable: true, ...over });
const PICKUP = (over: Partial<WasteRequestDetailDTO> = {}) => makeRequestDetail({ method: 'PICKUP', pointName: 'Kho Tubu TP.HCM', point: makeWarehouseContact(), ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.status = 'authenticated';
  mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: true };
  mocks.getWasteMe.mockResolvedValue(makeWasteMe());
  mocks.getWasteRequest.mockResolvedValue(makeRequestDetail());
  mocks.getWastePoints.mockResolvedValue([makeWastePoint()]);
});

describe('/recycle/r/:id — Mang tới điểm nhận (§4.5, §4.6)', () => {
  it('không có liên kết "Xem kết quả mẫu" của mockup (§19)', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/Xem kết quả mẫu/)).toBeNull();
  });
  it('timeline luôn hiện, bước hiện tại "Mang tới điểm"; bảng đã khai/đã đếm', async () => {
    renderPage();
    const tl = await screen.findByRole('list', { name: 'Tiến độ yêu cầu' });
    expect(within(tl).getByText('Mang tới điểm').closest('li')).toHaveAttribute('aria-current', 'step');
    const table = screen.getByRole('table', { name: 'Đã khai và đã đếm' });
    expect(within(table).getByRole('row', { name: /Thùng carton/ })).toHaveTextContent('5 thùng');
    expect(within(table).getByRole('row', { name: /Thùng carton/ })).toHaveTextContent('—');
  });
  it('"Xem mã QR": mã, QR, điểm nhận, hạn giữ chỗ (giờ VN), chuẩn bị, dòng luật cộng điểm', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem mã QR' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByTestId('qr')).toHaveTextContent('TR-8K2M9');
    expect(within(sheet).getByText('Đại lý Cô Ba')).toBeInTheDocument();
    expect(within(sheet).getByText('Giữ chỗ tới 25/10/2026')).toBeInTheDocument();
    expect(within(sheet).getByText('Gấp phẳng, bỏ băng keo')).toBeInTheDocument();
    expect(within(sheet).getByText('Điểm chỉ cộng sau khi điểm nhận đếm xong theo số thực nhận, không vượt số đã khai')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Theo dõi yêu cầu' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('"Sửa món" chỉ khi editable; "Huỷ yêu cầu" chỉ khi cancellable', async () => {
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ editable: false, cancellable: false }));
    renderPage();
    await screen.findByRole('list', { name: 'Tiến độ yêu cầu' });
    expect(screen.queryByRole('button', { name: 'Sửa món' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Huỷ yêu cầu' })).toBeNull();
  });
  it('Sửa món → /recycle/r/:id/edit', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa món' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/req-1/edit');
  });
  it('điểm nhận tạm ngừng → câu ghim + "Đổi điểm nhận"', async () => {
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ pointAvailable: false }));
    renderPage();
    expect(await screen.findByText('Điểm nhận đang tạm ngừng, hãy chọn điểm khác')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đổi điểm nhận' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/req-1/edit');
  });
  it('điểm nhận tạm ngừng → khung mã QR cũng nhắc và có "Đổi điểm nhận" (§15.2)', async () => {
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ pointAvailable: false }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem mã QR' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Điểm nhận đang tạm ngừng, hãy chọn điểm khác')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Đổi điểm nhận' })).toBeInTheDocument();
  });
  it('chương trình tạm dừng: yêu cầu mang tới điểm không còn "Xem mã QR", có câu tạm dừng và vẫn huỷ được', async () => {
    mocks.publicConfig.waste = { enabled: false, dropoff: false, mailin: false, pickup: false };
    renderPage();
    expect(await screen.findByText('Chương trình đang tạm dừng. Yêu cầu hết hạn ngày 25/10.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xem mã QR' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Huỷ yêu cầu' })).toBeEnabled();
    expect(screen.getByText('Đang tạm dừng')).toBeInTheDocument();
    expect(screen.queryByText('Chờ bạn mang tới')).toBeNull();
  });
  it('khách bị khoá: câu riêng nói tạm không tham gia (không nói chương trình tạm dừng), vẫn huỷ được', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ blocked: true }));
    renderPage();
    expect(await screen.findByText('Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree. Yêu cầu hết hạn ngày 25/10.')).toBeInTheDocument();
    expect(screen.queryByText(/Chương trình đang tạm dừng/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xem mã QR' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Huỷ yêu cầu' })).toBeEnabled();
    expect(screen.getByText('Đang tạm dừng')).toBeInTheDocument();
  });
  it('khoá gửi hàng không làm yêu cầu mang tới điểm tạm dừng; kênh Thu kèm tắt riêng cũng không', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ shipLockedAt: '2026-10-01T00:00:00.000Z' }));
    mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: false };
    renderPage();
    expect(await screen.findByRole('button', { name: 'Xem mã QR' })).toBeInTheDocument();
    expect(screen.queryByText('Đang tạm dừng')).toBeNull();
    expect(screen.queryByText(/Yêu cầu hết hạn ngày/)).toBeNull();
  });
  it('bình thường: có "Xem mã QR" và không có câu tạm dừng', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Xem mã QR' })).toBeInTheDocument();
    expect(screen.queryByText('Chương trình đang tạm dừng')).toBeNull();
  });
  it('cấu hình công khai chưa tải → không coi là tạm dừng: vẫn có "Xem mã QR"', async () => {
    mocks.publicConfig.isLoaded = false;
    mocks.publicConfig.waste = { enabled: false, dropoff: false, mailin: false, pickup: false };
    try {
      renderPage();
      expect(await screen.findByRole('button', { name: 'Xem mã QR' })).toBeInTheDocument();
      expect(screen.queryByText('Chương trình đang tạm dừng')).toBeNull();
    } finally {
      mocks.publicConfig.isLoaded = true;
    }
  });
  it('điểm của yêu cầu đã hết hạn mức tháng → nhắc đổi điểm khác + "Đổi điểm nhận" (§11.4)', async () => {
    const r = makeRequestDetail();
    mocks.getWasteRequest.mockResolvedValue(r);
    mocks.getWastePoints.mockResolvedValue([makeWastePoint({ id: r.point!.id, quotaFull: true })]);
    renderPage();
    expect(await screen.findByText('Điểm này tạm hết hạn mức tháng này, hãy chọn điểm khác')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đổi điểm nhận' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/req-1/edit');
  });
  it('huỷ: hỏi lại, gọi cancel, làm mới khoá; lỗi hiện câu máy chủ', async () => {
    mocks.cancelWasteRequest.mockRejectedValueOnce(new Error('Yêu cầu đã đóng')).mockResolvedValue(makeRequestDetail({ status: 'CANCELLED', cancellable: false, editable: false }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ yêu cầu' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('heading', { level: 2, name: 'Huỷ yêu cầu này?' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Xác nhận huỷ' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Yêu cầu đã đóng', type: 'error' })));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Xác nhận huỷ' }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(1));
    expect(mocks.cancelWasteRequest).toHaveBeenCalledWith('req-1');
  });
});

describe('/recycle/r/:id — Gửi về kho (§4.5b)', () => {
  it('khối 4.5b nằm TRÊN timeline: mã lớn, dòng ghi mã, người nhận + Sao chép, quy tắc gói, cước, hạn nhập', async () => {
    mocks.getWasteRequest.mockResolvedValue(MAIL());
    renderPage();
    const note = await screen.findByText('Ghi mã này lên kiện, mỗi kiện một yêu cầu');
    const tl = screen.getByRole('list', { name: 'Tiến độ yêu cầu' });
    expect(note.compareDocumentPosition(tl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Kho Tubu TP.HCM', { selector: '[data-recipient] *' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép' }));
    expect(mocks.copyText).toHaveBeenCalledWith('Kho Tubu TP.HCM\n0281234567\n99 Nguyễn Văn Linh, Phường Tân Phong, TP.HCM');
    expect(screen.getByText('Đóng gói không lẫn pin, hoá chất, vật nhọn, đồ ướt hoặc bẩn')).toBeInTheDocument();
    expect(screen.getByText('Kho từ chối kiện còn cước phải trả khi nhận')).toBeInTheDocument();
    expect(screen.getByText('Nhập mã vận đơn trước 25/10')).toBeInTheDocument();
  });
  it.each([null, ''])('kho không có số điện thoại (%j): khối người nhận không có dòng trống và Sao chép bỏ dòng số', async (phone) => {
    mocks.getWasteRequest.mockResolvedValue(MAIL({ point: makeWarehouseContact({ phone }) }));
    renderPage();
    await screen.findByText('Ghi mã này lên kiện, mỗi kiện một yêu cầu');
    const block = document.querySelector('[data-recipient]') as HTMLElement;
    expect(block.children).toHaveLength(3);
    expect(block).not.toHaveTextContent('null');
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép' }));
    expect(mocks.copyText).toHaveBeenCalledWith('Kho Tubu TP.HCM\n99 Nguyễn Văn Linh, Phường Tân Phong, TP.HCM');
  });
  it('"Đã gửi" khoá tới khi có Hãng và Mã vận đơn; gửi PUT tracking rồi làm mới khoá', async () => {
    mocks.getWasteRequest.mockResolvedValue(MAIL());
    mocks.setWasteTracking.mockResolvedValue(MAIL({ status: 'IN_TRANSIT', carrier: 'GHN', trackingCode: 'GHN123' }));
    renderPage();
    const sent = await screen.findByRole('button', { name: 'Đã gửi' });
    expect(sent).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Hãng'), { target: { value: ' GHN ' } });
    fireEvent.change(screen.getByLabelText('Mã vận đơn'), { target: { value: 'GHN123' } });
    fireEvent.click(sent);
    await waitFor(() => expect(mocks.setWasteTracking).toHaveBeenCalledWith('req-1', { carrier: 'GHN', trackingCode: 'GHN123' }));
    expect(mocks.invalidate).toHaveBeenCalled();
  });
  it('đã nhập mã vận đơn: thẻ Vận chuyển hiện hãng + mã và nút "Sửa"', async () => {
    mocks.getWasteRequest.mockResolvedValue(MAIL({ status: 'IN_TRANSIT', carrier: 'GHN', trackingCode: 'GHN123', editable: false }));
    renderPage();
    const card = (await screen.findByText('Vận chuyển', { selector: 'h2' })).closest('section') as HTMLElement;
    expect(within(card).getByText('GHN · GHN123')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Sửa' }));
    expect(screen.getByLabelText('Mã vận đơn')).toHaveValue('GHN123');
  });
  it('chương trình tắt vẫn nhập được mã vận đơn và huỷ (§15.1)', async () => {
    mocks.publicConfig.waste = { enabled: false, dropoff: false, mailin: false, pickup: false };
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ programmeEnabled: false }));
    mocks.getWasteRequest.mockResolvedValue(MAIL());
    renderPage();
    expect(await screen.findByRole('button', { name: 'Đã gửi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Huỷ yêu cầu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sửa món' })).toBeNull();
  });
  it('khách bị khoá vẫn nhập được mã vận đơn và huỷ (§15.1)', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ blocked: true }));
    mocks.getWasteRequest.mockResolvedValue(MAIL());
    renderPage();
    expect(await screen.findByRole('button', { name: 'Đã gửi' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mã vận đơn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Huỷ yêu cầu' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Sửa món' })).toBeNull();
  });
  it('Gửi về kho còn sửa được → có "Sửa món" (§7.4: mọi cách giao)', async () => {
    mocks.getWasteRequest.mockResolvedValue(MAIL());
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa món' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/req-1/edit');
  });
});

describe('/recycle/r/:id — Thu kèm đơn mua (§4.5b, §15.6)', () => {
  it('chưa gắn đơn: "Ghi mã này lên túi" + dòng gắn đơn + nút đi mua hàng', async () => {
    mocks.getWasteRequest.mockResolvedValue(PICKUP());
    renderPage();
    expect(await screen.findByText('Ghi mã này lên túi')).toBeInTheDocument();
    expect(screen.getByText('Gắn yêu cầu này vào đơn mua kế tiếp ở bước thanh toán')).toBeInTheDocument();
    expect(screen.getByText('Chờ gắn vào đơn')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đi mua hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });
  it.each([
    ['khoá đường kho', () => mocks.getWasteMe.mockResolvedValue(makeWasteMe({ shipLockedAt: '2026-10-01T00:00:00.000Z' })), 'Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH. Yêu cầu hết hạn ngày 25/10.'],
    ['bị khoá chương trình', () => mocks.getWasteMe.mockResolvedValue(makeWasteMe({ blocked: true })), 'Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree. Yêu cầu hết hạn ngày 25/10.'],
    ['cờ pickup tắt', () => { mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: false }; }, 'Thu kèm đơn đang tạm dừng. Yêu cầu hết hạn ngày 25/10.'],
    ['chương trình tắt khi cấu hình công khai cũ vẫn bật pickup', () => mocks.getWasteMe.mockResolvedValue(makeWasteMe({ programmeEnabled: false })), 'Chương trình đang tạm dừng. Yêu cầu hết hạn ngày 25/10.'],
  ])('%s → câu đúng lý do + "Huỷ yêu cầu", không có nút đi mua hàng', async (_n, arrange, note) => {
    arrange();
    mocks.getWasteRequest.mockResolvedValue(PICKUP());
    renderPage();
    expect(await screen.findByText(note)).toBeInTheDocument();
    expect(screen.getByText('Yêu cầu này chưa gắn được vào đơn lúc này và sẽ tự hết hạn ngày 25/10')).toBeInTheDocument();
    expect(screen.queryByText('Gắn yêu cầu này vào đơn mua kế tiếp ở bước thanh toán')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đi mua hàng' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Huỷ yêu cầu' })).toBeInTheDocument();
    expect(screen.getByText('Đang tạm dừng')).toBeInTheDocument();
    expect(screen.queryByText('Chờ gắn vào đơn')).toBeNull();
  });
  it('đã gắn đơn: "Đã gắn vào đơn TUBU123", timeline ở "Chờ kho nhận"', async () => {
    mocks.getWasteRequest.mockResolvedValue(PICKUP({ orderCode: 'TUBU123', orderId: 'ord-1', editable: false }));
    renderPage();
    expect(await screen.findByText('Đã gắn vào đơn TUBU123')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Tiến độ yêu cầu' })).getByText('Chờ kho nhận').closest('li')).toHaveAttribute('aria-current', 'step');
  });
});

describe('/recycle/r/:id — trạng thái đóng và kết quả (§4.6)', () => {
  it('REJECTED: nhãn + lý do thay timeline, có liên kết hỗ trợ', async () => {
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ status: 'REJECTED', rejectionReason: 'WET', rejectionNote: 'thùng ướt', editable: false, cancellable: false }));
    renderPage();
    expect(await screen.findByText('Bị từ chối')).toBeInTheDocument();
    expect(screen.getByText('Ướt: thùng ướt')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Tiến độ yêu cầu' })).toBeNull();
    expect(screen.queryByText('Cần hỗ trợ? Nhắn Tubu Tree')).toBeNull();
    expect(screen.queryAllByText(/Cần hỗ trợ/)).toHaveLength(0);
    expect(screen.getByTestId('support-contact')).toBeInTheDocument();
  });
  it('COMPLETED: bảng có số đếm và lý do nhận thiếu; liên kết tới /recycle/done/:id', async () => {
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ status: 'COMPLETED', pointsAwarded: 3000, editable: false, cancellable: false, lines: [{ ...makeRequestDetail().lines[0]!, receivedQty: 3, shortfallReason: 'WET', pointsAwarded: 3000 }] }));
    renderPage();
    const row = within(await screen.findByRole('table', { name: 'Đã khai và đã đếm' })).getByRole('row', { name: /Thùng carton/ });
    expect(row).toHaveTextContent('3 thùng');
    expect(row).toHaveTextContent('Ướt');
    fireEvent.click(screen.getByRole('button', { name: 'Xem kết quả cộng điểm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/done/req-1');
  });
  it('404 → trạng thái rỗng, dẫn về Yêu cầu của tôi', async () => {
    mocks.getWasteRequest.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem yêu cầu của tôi' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/requests', { replace: true });
  });
  it('khách (chưa đăng nhập) → về /recycle thay vì skeleton mãi', async () => {
    mocks.auth.status = 'idle';
    renderPage();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/recycle', { replace: true }));
    expect(mocks.getWasteRequest).not.toHaveBeenCalled();
  });
  it('một PageHeader, không lồng nút', async () => {
    mocks.getWasteRequest.mockResolvedValue(MAIL());
    const { container } = renderPage();
    await screen.findByRole('list', { name: 'Tiến độ yêu cầu' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });
});

describe('/recycle/r/:id — trạng thái, ước tính, tiêu đề (F2, F10)', () => {
  it('Mang tới + OPEN: nhãn trạng thái, bước 2 ghi điểm nhận, địa chỉ và hạn; dòng "Ước tính"', async () => {
    renderPage();
    const tl = await screen.findByRole('list', { name: 'Tiến độ yêu cầu' });
    const step = within(tl).getByText('Mang tới điểm').closest('li') as HTMLElement;
    expect(step).toHaveTextContent('Mang tới Đại lý Cô Ba trước 25/10');
    expect(step).toHaveTextContent('12 Lê Lợi');
    expect(screen.getByText('Chờ bạn mang tới')).toBeInTheDocument();
    expect(screen.getByText('Ước tính 5.000 điểm')).toBeInTheDocument();
  });
  it('điểm nhận tạm ngừng: bước 2 không dặn mang tới điểm đó', async () => {
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ pointAvailable: false }));
    renderPage();
    const tl = await screen.findByRole('list', { name: 'Tiến độ yêu cầu' });
    expect(within(tl).getByText('Mang tới điểm').closest('li')).not.toHaveTextContent('Mang tới Đại lý Cô Ba');
  });
  it('điểm hết hạn mức tháng: bước 2 không dặn mang tới điểm đó', async () => {
    const r = makeRequestDetail();
    mocks.getWasteRequest.mockResolvedValue(r);
    mocks.getWastePoints.mockResolvedValue([makeWastePoint({ id: r.point!.id, quotaFull: true })]);
    renderPage();
    await screen.findByText('Điểm này tạm hết hạn mức tháng này, hãy chọn điểm khác');
    const tl = screen.getByRole('list', { name: 'Tiến độ yêu cầu' });
    expect(within(tl).getByText('Mang tới điểm').closest('li')).not.toHaveTextContent('Mang tới Đại lý Cô Ba');
  });
  it('chương trình tạm dừng: bước 2 không dặn mang tới điểm', async () => {
    mocks.publicConfig.waste = { enabled: false, dropoff: false, mailin: false, pickup: false };
    renderPage();
    await screen.findByText('Chương trình đang tạm dừng. Yêu cầu hết hạn ngày 25/10.');
    const tl = screen.getByRole('list', { name: 'Tiến độ yêu cầu' });
    expect(within(tl).getByText('Mang tới điểm').closest('li')).not.toHaveTextContent('Mang tới Đại lý Cô Ba');
  });
  it('REJECTED và COMPLETED: không còn dòng "Ước tính" (chỉ yêu cầu đang chạy mới ước tính)', async () => {
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ status: 'REJECTED', rejectionReason: 'WET', editable: false, cancellable: false }));
    const first = renderPage();
    await screen.findByText('Bị từ chối');
    expect(screen.queryByText(/Ước tính/)).toBeNull();
    first.unmount();
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ status: 'COMPLETED', pointsAwarded: 2000, editable: false, cancellable: false }));
    renderPage();
    await screen.findByRole('button', { name: 'Xem kết quả cộng điểm' });
    expect(screen.queryByText(/Ước tính/)).toBeNull();
  });
  it('Gửi về kho + OPEN: có dòng "Ước tính", số điện thoại người nhận nhóm 4-3-3, tiêu đề trang không lặp mã', async () => {
    mocks.getWasteRequest.mockResolvedValue(MAIL({ point: makeWarehouseContact({ phone: '0984606774' }) }));
    renderPage();
    await screen.findByText('Ghi mã này lên kiện, mỗi kiện một yêu cầu');
    expect(screen.getByText('Ước tính 5.000 điểm')).toBeInTheDocument();
    expect(screen.getByText('0984 606 774')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Yêu cầu đổi rác');
    expect(screen.getAllByText('TR-8K2M9')).toHaveLength(1);
  });
  it('Thu kèm đơn + OPEN: tiêu đề trang không lặp mã; Mang tới giữ mã ở tiêu đề', async () => {
    mocks.getWasteRequest.mockResolvedValue(PICKUP());
    const first = renderPage();
    await screen.findByText('Ghi mã này lên túi');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Yêu cầu đổi rác');
    first.unmount();
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail());
    renderPage();
    await screen.findByRole('list', { name: 'Tiến độ yêu cầu' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('TR-8K2M9');
  });
});


describe('/recycle/r/:id — theo dõi (B-83)', () => {
  it('mở mã QR thì hỏi lại trạng thái mỗi 5 giây; thấy COMPLETED thì đóng tấm mã và sang màn kết quả', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Xem mã QR' }));
      await screen.findByRole('dialog');
      const calls = mocks.getWasteRequest.mock.calls.length;
      mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ status: 'COMPLETED', pointsAwarded: 5000 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });
      await waitFor(() => expect(mocks.getWasteRequest.mock.calls.length).toBeGreaterThan(calls));
      await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/recycle/done/req-1', { replace: true }));
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it('chưa mở mã QR thì không hỏi lại theo chu kỳ', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();
      await screen.findByRole('button', { name: 'Xem mã QR' });
      const calls = mocks.getWasteRequest.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_000);
      });
      expect(mocks.getWasteRequest.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });
  it('giờ mở cửa của điểm nhận hiện ở bước Mang tới điểm và trong tấm mã (từ openingHours)', async () => {
    mocks.getWasteRequest.mockResolvedValue(makeRequestDetail({ point: { ...makeRequestDetail().point!, openingHours: { MON: [{ open: '08:00', close: '18:00' }], TUE: [{ open: '08:00', close: '18:00' }], WED: [{ open: '08:00', close: '18:00' }], THU: [{ open: '08:00', close: '18:00' }], FRI: [{ open: '08:00', close: '18:00' }], SAT: [{ open: '08:00', close: '18:00' }], SUN: [{ open: '08:00', close: '18:00' }] } } }));
    renderPage();
    expect((await screen.findAllByText(/Hôm nay 8:00–18:00/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Xem mã QR' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/Hôm nay 8:00–18:00/)).toBeInTheDocument();
  });
  it('chương trình tạm dừng: nhãn màu cảnh báo, nói hạn hết hiệu lực', async () => {
    mocks.publicConfig.waste = { enabled: false, dropoff: false, mailin: false, pickup: false };
    renderPage();
    const badge = await screen.findByText('Đang tạm dừng');
    expect(badge.closest('span')?.getAttribute('style') ?? '').toContain('--color-status-warning');
    expect(screen.getByText(/Yêu cầu hết hạn ngày 25\/10\./)).toBeInTheDocument();
    expect(screen.queryByText(/nếu chương trình chưa mở lại/)).toBeNull();
  });
  it('tấm xác nhận huỷ nói rõ hậu quả', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ yêu cầu' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Mã TR-8K2M9 sẽ hết hiệu lực. Bạn có thể tạo yêu cầu mới bất cứ lúc nào.')).toBeInTheDocument();
  });
});
