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
  getLoyaltyRewards: vi.fn(),
  getWasteCatalogue: vi.fn(),
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
vi.mock('../services/waste-api', async (orig) => ({ ...(await orig<object>()), getWasteMe: mocks.getWasteMe, getWasteCatalogue: mocks.getWasteCatalogue }));
vi.mock('../services/account-api', () => ({ getLoyaltyRewards: mocks.getLoyaltyRewards }));

import RecyclePage from './recycle';
import { makeWasteMe, makeRewardCatalog, makeRequestSummary, ITEM_CARTON, ITEM_MILK } from '../services/waste-test-fixtures';
import { findNestedInteractive, describeNested } from '../components/ui/nested-interactive';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <RecyclePage />
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.status = 'authenticated';
  mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: false };
  mocks.getWasteMe.mockResolvedValue(makeWasteMe({ balance: { pointsBalance: 9000, pointsConvertedBalance: 5000, redeemablePoints: 14_000 } }));
  mocks.getLoyaltyRewards.mockResolvedValue(makeRewardCatalog({ redeemablePoints: 14_000 }));
  mocks.getWasteCatalogue.mockResolvedValue([ITEM_CARTON, { ...ITEM_MILK, warehouseOnly: true }]);
});

describe('/recycle trang vào (§4.1)', () => {
  it('thẻ đầu trang: nhãn "Điểm Xanh của bạn", tổng hai lô, quy ra tiền, nút "Đổi rác ngay"', async () => {
    renderPage();
    expect(await screen.findByText('Điểm Xanh của bạn')).toBeInTheDocument();
    expect(screen.getByText('14.000 điểm')).toBeInTheDocument();
    expect(screen.getByText(/14\.000đ/)).toBeInTheDocument();
    expect(screen.queryByText(/từ đổi rác/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Đổi rác ngay' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/new');
  });
  it('tiến độ tới quà kế tiếp theo redeemablePoints của máy chủ + tương đương đơn vị món', async () => {
    renderPage();
    expect(await screen.findByText('Còn 6.000 điểm tới mã Miễn phí vận chuyển')).toBeInTheDocument();
    expect(screen.getByText('tương đương khoảng 6 thùng carton')).toBeInTheDocument();
    expect(screen.getByTestId('progress-fill')).toHaveStyle({ width: '70%' });
  });
  it('dòng tác động chỉ khi impactGrams khác null', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ impactGrams: 1940 }));
    renderPage();
    expect(await screen.findByText('Bạn đã gửi khoảng 1,9 kg bao bì cho Tubu')).toBeInTheDocument();
    expect(screen.getByText('Ước tính theo khối lượng trung bình')).toBeInTheDocument();
  });
  it('tác động dưới 50 g làm tròn về 0 kg → không có dòng; từ 50 g thì hiện số trang thật in', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ impactGrams: 30 }));
    const { unmount } = renderPage();
    await screen.findByText('Điểm Xanh của bạn');
    expect(screen.queryByText(/kg bao bì/)).toBeNull();
    expect(screen.queryByText('Ước tính theo khối lượng trung bình')).toBeNull();
    unmount();
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ impactGrams: 100 }));
    renderPage();
    expect(await screen.findByText('Bạn đã gửi khoảng 0,1 kg bao bì cho Tubu')).toBeInTheDocument();
  });
  it('ranh giới 50 g: đúng 50 g hiện 0,1 kg, 49 g không có dòng', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ impactGrams: 50 }));
    const { unmount } = renderPage();
    expect(await screen.findByText('Bạn đã gửi khoảng 0,1 kg bao bì cho Tubu')).toBeInTheDocument();
    unmount();
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ impactGrams: 49 }));
    renderPage();
    await screen.findByText('Điểm Xanh của bạn');
    expect(screen.queryByText(/kg bao bì/)).toBeNull();
  });
  it('impactGrams 0 → không có dòng tác động', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ impactGrams: 0 }));
    renderPage();
    await screen.findByText('Điểm Xanh của bạn');
    expect(screen.queryByText(/kg bao bì/)).toBeNull();
  });
  it('không có impactGrams → không có dòng tác động', async () => {
    renderPage();
    await screen.findByText('Điểm Xanh của bạn');
    expect(screen.queryByText(/kg bao bì/)).toBeNull();
  });
  it('ba cách đổi: chỉ cách đang bật ở /config/public; khoá đường kho ẩn Gửi về kho và Thu kèm đơn', async () => {
    mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: true };
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true }, shipLockedAt: '2026-10-01T00:00:00.000Z' }));
    renderPage();
    expect(await screen.findByText('Mang tới điểm nhận')).toBeInTheDocument();
    expect(screen.queryByText('Gửi về kho Tubu HCM')).toBeNull();
    expect(screen.queryByText('Thu kèm đơn mua')).toBeNull();
  });
  it('không cách giao nào mở với khách này → ẩn "Đổi rác ngay" nhưng vẫn hiện số dư', async () => {
    mocks.publicConfig.waste = { enabled: true, dropoff: false, mailin: false, pickup: false };
    renderPage();
    await screen.findByText('Điểm Xanh của bạn');
    expect(screen.queryByRole('button', { name: 'Đổi rác ngay' })).toBeNull();
  });
  it('tiêu đề khối cách đổi không đếm số thẻ', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Cách đổi' })).toBeInTheDocument();
    expect(screen.queryByText('Ba cách đổi')).toBeNull();
  });
  it('cờ pickup tắt → không có thẻ Thu kèm đơn', async () => {
    renderPage();
    expect(await screen.findByText('Gửi về kho Tubu HCM')).toBeInTheDocument();
    expect(screen.queryByText('Thu kèm đơn mua')).toBeNull();
  });
  it('danh sách món: quy tắc + chuẩn bị; món sắp nhận mờ, nhãn "Sắp nhận"', async () => {
    renderPage();
    expect(await screen.findByText('1 thùng = 1.000 điểm')).toBeInTheDocument();
    expect(screen.getByText('5 vỏ = 1.000 điểm')).toBeInTheDocument();
    expect(screen.getByText('Gấp phẳng, bỏ băng keo')).toBeInTheDocument();
    const battery = screen.getByText('Pin đã dùng').closest('[data-item]') as HTMLElement;
    expect(battery).toHaveAttribute('data-status', 'COMING_SOON');
    expect(within(battery).getByText('Sắp nhận')).toBeInTheDocument();
  });
  it('món sắp nhận không làm mờ cả khối bằng opacity (chữ phải đạt 4,5:1) và báo aria-disabled; món đang nhận thì không', async () => {
    renderPage();
    await screen.findByText('1 thùng = 1.000 điểm');
    const battery = screen.getByText('Pin đã dùng').closest('[data-item]') as HTMLElement;
    expect(battery.style.opacity).toBe('');
    expect(battery).toHaveAttribute('aria-disabled', 'true');
    const active = document.querySelector('[data-item][data-status="ACTIVE"]') as HTMLElement;
    expect(active).not.toBeNull();
    expect(active.style.opacity).toBe('');
    expect(active).not.toHaveAttribute('aria-disabled');
  });
  it('yêu cầu đang xử lý: mã, cách giao, mini timeline; bấm tới /recycle/r/:id; biểu tượng lịch sử tới /recycle/requests', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ openRequests: [makeRequestSummary({ method: 'MAIL_IN', status: 'IN_TRANSIT', pointName: 'Kho Tubu TP.HCM' })] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /TR-8K2M9/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/req-1');
    expect(screen.getByRole('list', { name: 'Tiến độ TR-8K2M9' })).toBeInTheDocument();
    expect(screen.getByText('Đang vận chuyển')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu của tôi' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/requests');
  });
  it('thẻ yêu cầu liệt kê từng món dạng "Tên món: số lượng đơn vị", không lặp danh từ đơn vị', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ openRequests: [makeRequestSummary({ lines: [
      { itemName: 'Thùng carton cũ', unitLabel: 'thùng', declaredQty: 3 },
      { itemName: 'Vỏ hộp sữa sạch', unitLabel: 'vỏ', declaredQty: 5 },
    ] })] }));
    renderPage();
    expect(await screen.findByText('Thùng carton cũ: 3 thùng, Vỏ hộp sữa sạch: 5 vỏ')).toBeInTheDocument();
  });
  it('hàng quà dẫn tới /rewards; lối vào đại lý chỉ khi có deskPoints', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ deskPoints: [{ id: 'pt-1', name: 'Đại lý Cô Ba', kind: 'PARTNER' }] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Kho quà/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/rewards');
    fireEvent.click(screen.getByRole('button', { name: /Nhận hàng tại điểm/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/desk');
  });
  it('không có deskPoints → không có lối vào đại lý', async () => {
    renderPage();
    await screen.findByText('Điểm Xanh của bạn');
    expect(screen.queryByText(/Nhận hàng tại điểm/)).toBeNull();
  });
  it.each([
    ['chương trình tạm dừng', { programmeEnabled: false }],
    ['khách bị khoá', { blocked: true }],
  ] as const)('%s + có deskPoints → vẫn có lối vào /recycle/desk', async (_label, over) => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ ...over, deskPoints: [{ id: 'pt-1', name: 'Kho Tubu TP.HCM', kind: 'WAREHOUSE' }] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nhận hàng tại điểm/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/desk');
  });
  it.each([
    ['chương trình tạm dừng', { programmeEnabled: false }],
    ['khách bị khoá', { blocked: true }],
  ] as const)('%s + không có deskPoints → không có lối vào điểm', async (_label, over) => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ ...over, deskPoints: [] }));
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.getByText(/Chương trình đang tạm dừng|Tài khoản của bạn tạm không tham gia/)).toBeInTheDocument());
    expect(screen.queryByText(/Nhận hàng tại điểm/)).toBeNull();
  });
  it('liên kết Thể lệ', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Thể lệ/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/rules');
  });
});

describe('/recycle thẻ trạng thái và thứ tự ưu tiên (§4.1)', () => {
  it('chương trình tắt: ẩn thẻ đầu, ba cách, món, quà; hiện "Chương trình đang tạm dừng" và yêu cầu đang đi', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ programmeEnabled: false, openRequests: [makeRequestSummary()] }));
    renderPage();
    expect(await screen.findByText('Chương trình đang tạm dừng')).toBeInTheDocument();
    for (const t of ['Điểm Xanh của bạn', 'Đổi rác ngay', 'Mang tới điểm nhận', 'Thùng carton']) expect(screen.queryByText(t)).toBeNull();
    expect(screen.getByRole('button', { name: /TR-8K2M9/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kho quà/ })).toBeInTheDocument();
  });
  it('chương trình tắt: yêu cầu Mang tới và Thu kèm đơn chưa gắn đọc "Đang tạm dừng", Gửi về kho giữ nhãn cũ', async () => {
    mocks.getWasteMe.mockResolvedValue(
      makeWasteMe({
        programmeEnabled: false,
        openRequests: [
          makeRequestSummary({ id: 'r-d', code: 'TR-DROP1' }),
          makeRequestSummary({ id: 'r-p', code: 'TR-PICK1', method: 'PICKUP' }),
          makeRequestSummary({ id: 'r-m', code: 'TR-MAIL1', method: 'MAIL_IN' }),
        ],
      }),
    );
    mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: true };
    renderPage();
    await screen.findByText('Chương trình đang tạm dừng');
    expect(screen.getAllByText('Đang tạm dừng')).toHaveLength(2);
    expect(screen.getByText('Chờ bạn gửi kiện')).toBeInTheDocument();
    expect(screen.queryByText('Chờ bạn mang tới')).toBeNull();
    expect(screen.queryByText('Chờ gắn vào đơn')).toBeNull();
  });
  it('khách bị khoá: yêu cầu Mang tới đọc "Đang tạm dừng"', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ blocked: true, openRequests: [makeRequestSummary()] }));
    renderPage();
    await screen.findByText('Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree');
    expect(screen.getByText('Đang tạm dừng')).toBeInTheDocument();
    expect(screen.queryByText('Chờ bạn mang tới')).toBeNull();
  });
  it('chương trình bật: Mang tới đọc "Chờ bạn mang tới"; Thu kèm đơn tạm dừng khi cờ pickup tắt', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ openRequests: [makeRequestSummary(), makeRequestSummary({ id: 'r-p', code: 'TR-PICK1', method: 'PICKUP' })] }));
    mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: true };
    const first = renderPage();
    expect(await screen.findByText('Chờ bạn mang tới')).toBeInTheDocument();
    expect(screen.getByText('Chờ gắn vào đơn')).toBeInTheDocument();
    first.unmount();
    mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: false };
    renderPage();
    expect(await screen.findByText('Chờ bạn mang tới')).toBeInTheDocument();
    expect(screen.getByText('Đang tạm dừng')).toBeInTheDocument();
    expect(screen.queryByText('Chờ gắn vào đơn')).toBeNull();
  });
  it('khách bị khoá: thẻ khoá, yêu cầu RECEIVED ghi "Đang chờ Tubu xem lại"', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ blocked: true, openRequests: [makeRequestSummary({ method: 'MAIL_IN', status: 'RECEIVED' })] }));
    renderPage();
    expect(await screen.findByText('Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree')).toBeInTheDocument();
    expect(screen.getByText('Đang chờ Tubu xem lại')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đổi rác ngay' })).toBeNull();
  });
  it.each(['GUEST', 'NEED_PHONE'] as const)('eligibility %s: xem chương trình trước, nút đăng nhập ở thanh dưới; xin được số → làm mới [waste]', async (eligibility) => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ eligibility, balance: null, monthUsage: null }));
    mocks.ensurePhone.mockResolvedValue('0901234567');
    const { qc } = renderPage();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    expect(await screen.findByText('Cần số điện thoại để cộng Điểm Xanh đúng tài khoản của bạn.')).toBeInTheDocument();
    expect(screen.getByText('Tubu nhận những món này')).toBeInTheDocument();
    expect(screen.queryByText('Điểm Xanh của bạn')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Yêu cầu của tôi' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập để đổi rác' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['waste'] }));
    expect(mocks.login).not.toHaveBeenCalled();
  });
  it('NEED_PHONE + danh mục món rỗng: không hiện tiêu đề món với danh sách trống, vẫn có nút đăng nhập', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ eligibility: 'NEED_PHONE', balance: null, monthUsage: null, items: [] }));
    renderPage();
    expect(await screen.findByText('Cần số điện thoại để cộng Điểm Xanh đúng tài khoản của bạn.')).toBeInTheDocument();
    expect(screen.queryByText('Tubu nhận những món này')).toBeNull();
    expect(screen.getByRole('button', { name: 'Đăng nhập để đổi rác' })).toBeInTheDocument();
  });
  it('NEED_PHONE + chương trình bật + có deskPoints: thẻ xin số kèm lối vào /recycle/desk', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ eligibility: 'NEED_PHONE', balance: null, monthUsage: null, deskPoints: [{ id: 'pt-1', name: 'Đại lý Cô Ba', kind: 'PARTNER' }] }));
    renderPage();
    expect(await screen.findByText('Cần số điện thoại để cộng Điểm Xanh đúng tài khoản của bạn.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Nhận hàng tại điểm/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/desk');
  });
  it('NEED_PHONE + không có deskPoints: chỉ thẻ xin số', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ eligibility: 'NEED_PHONE', balance: null, monthUsage: null, deskPoints: [] }));
    renderPage();
    expect(await screen.findByText('Cần số điện thoại để cộng Điểm Xanh đúng tài khoản của bạn.')).toBeInTheDocument();
    expect(screen.queryByText(/Nhận hàng tại điểm/)).toBeNull();
  });
  it('NEED_PHONE + chương trình tắt: chỉ thẻ tạm dừng, không có thẻ đăng nhập', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ programmeEnabled: false, eligibility: 'NEED_PHONE', balance: null, monthUsage: null }));
    renderPage();
    expect(await screen.findByText('Chương trình đang tạm dừng')).toBeInTheDocument();
    expect(screen.queryByText('Cần số điện thoại để cộng Điểm Xanh đúng tài khoản của bạn.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đăng nhập để đổi rác' })).toBeNull();
    expect(mocks.ensurePhone).not.toHaveBeenCalled();
  });
  it('khách vãng lai + chương trình tắt: chỉ thẻ tạm dừng, không bị xin số, không gọi /waste/me', async () => {
    mocks.auth.status = 'idle';
    mocks.publicConfig.waste = { enabled: false, dropoff: false, mailin: false, pickup: false };
    renderPage();
    expect(await screen.findByText('Chương trình đang tạm dừng')).toBeInTheDocument();
    expect(screen.queryByText(/chia sẻ số điện thoại/)).toBeNull();
    expect(mocks.getWasteMe).not.toHaveBeenCalled();
  });
  it('khách vãng lai + chương trình bật: thấy món, mức điểm, các bước, link Thể lệ; nút đăng nhập gọi login rồi ensurePhone', async () => {
    mocks.auth.status = 'idle';
    mocks.login.mockResolvedValue(undefined);
    mocks.ensurePhone.mockResolvedValue('0901234567');
    renderPage();
    expect(await screen.findByText('Thùng carton')).toBeInTheDocument();
    expect(screen.getByText('Cách đổi')).toBeInTheDocument();
    expect(screen.getAllByText('Chỉ kho TP.HCM nhận')).toHaveLength(1);
    expect(screen.getByText('Cần số điện thoại để cộng Điểm Xanh đúng tài khoản của bạn.')).toBeInTheDocument();
    expect(mocks.getWasteMe).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Xem Thể lệ chương trình/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/rules');
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập để đổi rác' }));
    await waitFor(() => expect(mocks.ensurePhone).toHaveBeenCalled());
    expect(mocks.login.mock.invocationCallOrder[0]!).toBeLessThan(mocks.ensurePhone.mock.invocationCallOrder[0]!);
  });
  it('phiên lỗi mạng → SessionUnavailable, không vẽ trang trống', async () => {
    mocks.auth.status = 'error';
    renderPage();
    expect(await screen.findByText(/kết nối/i)).toBeInTheDocument();
  });
  it('một PageHeader, không lồng nút', async () => {
    const { container } = renderPage();
    await screen.findByText('Điểm Xanh của bạn');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });
});

describe('/recycle bố cục (B-35, B-83, B-36)', () => {
  it('nhân viên có điểm nhận: lối vào quầy nằm TRÊN thẻ điểm, không còn ở cuối trang', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ deskPoints: [{ id: 'pt-1', name: 'Đại lý Cô Ba', kind: 'PARTNER' }] }));
    renderPage();
    const desk = await screen.findByRole('button', { name: /Nhận hàng tại điểm/ });
    const card = screen.getByText('Điểm Xanh của bạn');
    expect(desk.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Nhận hàng tại điểm/ })).toHaveLength(1);
  });
  it('khách mới (0 điểm) không có dòng "Dùng như 0đ"', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ balance: { pointsBalance: 0, pointsConvertedBalance: 0, redeemablePoints: 0 } }));
    renderPage();
    await screen.findByText('Điểm Xanh của bạn');
    expect(screen.queryByText(/Dùng như/)).toBeNull();
  });
  it('thẻ yêu cầu đang xử lý: dải tiến độ có chữ "Bước 2/4: Mang tới điểm"; thẻ Cách đổi không phải thẻ viền', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ openRequests: [makeRequestSummary()] }));
    renderPage();
    expect(await screen.findByText('Bước 2/4: Mang tới điểm')).toBeInTheDocument();
    const how = screen.getByText('Cách đổi').closest('section') as HTMLElement;
    expect(how.querySelector('[class*="card"], [data-variant="outline"]')).toBeNull();
  });
  it('danh sách món: món chỉ kho nhận có nhãn "Chỉ kho TP.HCM nhận"', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ items: [ITEM_CARTON, { ...ITEM_MILK, warehouseOnly: true }] }));
    renderPage();
    const milk = (await screen.findByText('Vỏ hộp sữa')).closest('[data-item]') as HTMLElement;
    expect(within(milk).getByText('Chỉ kho TP.HCM nhận')).toBeInTheDocument();
    expect(within(screen.getByText('Thùng carton').closest('[data-item]') as HTMLElement).queryByText('Chỉ kho TP.HCM nhận')).toBeNull();
  });
});
