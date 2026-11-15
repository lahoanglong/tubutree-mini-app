import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  location: { pathname: '/recycle/r/req-1', search: '', state: null as unknown },
  auth: { status: 'authenticated' as const },
  publicConfig: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } },
  getWasteRequest: vi.fn(),
  getWasteMe: vi.fn(),
  getWastePoints: vi.fn(),
  cancelWasteRequest: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div data-testid="zaui-sheet">{children}</div> : null),
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location,
  useParams: () => ({ id: 'req-1' }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, login: vi.fn(), ensurePhone: vi.fn() };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.publicConfig }));
vi.mock('../services/waste-api', async (orig) => ({
  ...(await orig<object>()),
  getWasteRequest: mocks.getWasteRequest,
  getWasteMe: mocks.getWasteMe,
  getWastePoints: mocks.getWastePoints,
  cancelWasteRequest: mocks.cancelWasteRequest,
  invalidateAfterWasteWrite: mocks.invalidate,
}));
vi.mock('../components/support-contact', () => ({ SupportContact: () => <div data-testid="support-contact" /> }));

import RecycleRequestPage from './recycle-request';
import { HttpError } from '../services/http';
import { makeWasteMe, makeWastePoint } from '../services/waste-test-fixtures';
import { makeHomePickup, makeHomePickupRequest } from '../services/waste-home-pickup-fixtures';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><RecycleRequestPage /></QueryClientProvider>);
}

const TIMELINE = [
  { at: '2026-10-17T03:00:00.000Z', text: 'Đã tạo đơn thu gom' },
  { at: '2026-10-17T05:30:00.000Z', text: 'Bưu tá đã lấy rác' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: true };
  mocks.getWasteMe.mockResolvedValue(makeWasteMe());
  mocks.getWastePoints.mockResolvedValue([makeWastePoint()]);
  mocks.getWasteRequest.mockResolvedValue(makeHomePickupRequest());
  mocks.invalidate.mockResolvedValue(undefined);
});

describe('/recycle/r/:id: đơn Shipper lấy tận nhà', () => {
  it('dải tiến độ 4 bước của thu gom tận nhà, bước "Bưu tá lấy rác" đang diễn ra, mốc "Đã tạo đơn" có giờ', async () => {
    renderPage();
    const tl = await screen.findByRole('list', { name: 'Tiến độ yêu cầu' });
    expect(within(tl).getAllByRole('listitem')).toHaveLength(4);
    expect(within(tl).getByText('Bưu tá lấy rác').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(within(tl).getByText('Đã tạo đơn').closest('li')).toHaveTextContent('10:00');
  });

  it('đã lấy rác: mốc của máy chủ chuyển sang bước tương ứng, bước kho nhận kèm câu của máy chủ', async () => {
    mocks.getWasteRequest.mockResolvedValue(
      makeHomePickupRequest({
        status: 'RECEIVED',
        homePickup: makeHomePickup({
          gomdonStatus: '7',
          timeline: [...TIMELINE, { at: '2026-10-17T08:00:00.000Z', text: 'Đã giao tới kho Tubu' }, { at: '2026-10-17T09:00:00.000Z', text: 'Kho Tubu đã nhận rác, đang đếm' }],
        }),
        cancellable: false,
      }),
    );
    renderPage();
    const tl = await screen.findByRole('list', { name: 'Tiến độ yêu cầu' });
    expect(within(tl).getByText('Bưu tá lấy rác').closest('li')).toHaveTextContent('12:30');
    expect(within(tl).getByText('Cộng điểm').closest('li')).toHaveTextContent('Kho Tubu đã nhận rác, đang đếm');
  });

  it('chi tiết: địa chỉ lấy rác, cân nặng, phí shipper, điểm đã trừ; không có dòng thu hộ / COD', async () => {
    renderPage();
    const detail = await screen.findByTestId('home-pickup-detail');
    expect(detail).toHaveTextContent('Địa chỉ lấy rác');
    expect(detail).toHaveTextContent('12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh');
    expect(detail).toHaveTextContent('Cân nặng ước tính');
    expect(detail).toHaveTextContent('2 kg');
    expect(detail).toHaveTextContent('Phí shipper');
    expect(detail).toHaveTextContent('25.000đ');
    expect(detail).toHaveTextContent('Đã trừ Điểm Xanh');
    expect(detail).toHaveTextContent('25.000 điểm');
    expect(detail.textContent).not.toMatch(/thu hộ|COD|tiền mặt/i);
  });

  it('không có nút Sửa món / Xem mã QR / Đổi điểm nhận của đơn mang tới điểm (editable:false)', async () => {
    renderPage();
    await screen.findByTestId('home-pickup-detail');
    expect(screen.queryByRole('button', { name: 'Sửa món' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xem mã QR' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đổi điểm nhận' })).toBeNull();
  });

  it('cancellable:false thì không có nút huỷ', async () => {
    mocks.getWasteRequest.mockResolvedValue(makeHomePickupRequest({ cancellable: false }));
    renderPage();
    await screen.findByTestId('home-pickup-detail');
    expect(screen.queryByRole('button', { name: 'Huỷ đơn thu gom' })).toBeNull();
  });

  it('huỷ: một hộp xác nhận nêu điểm sẽ hoàn, gọi huỷ một lần, báo số điểm đã hoàn', async () => {
    mocks.cancelWasteRequest.mockResolvedValue(
      makeHomePickupRequest({ status: 'CANCELLED', cancellable: false, homePickup: makeHomePickup({ shipFeePointsRefunded: 25_000 }) }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn thu gom' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('heading', { level: 2, name: 'Huỷ đơn thu gom?' })).toBeInTheDocument();
    expect(sheet).toHaveTextContent('25.000 điểm đã trừ phí ship sẽ được hoàn lại');
    const confirm = within(sheet).getByRole('button', { name: 'Xác nhận huỷ' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã huỷ đơn thu gom, hoàn 25.000 điểm', type: 'success' })));
    expect(mocks.cancelWasteRequest).toHaveBeenCalledTimes(1);
    expect(mocks.cancelWasteRequest).toHaveBeenCalledWith('req-1');
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it('huỷ bị từ chối 409 (bưu tá đã lấy rác): hiện đúng câu của máy chủ, tải lại đơn và đóng hộp xác nhận', async () => {
    const message = 'Bưu tá đã lấy rác nên không huỷ được nữa, bạn liên hệ CSKH nếu cần hỗ trợ';
    mocks.cancelWasteRequest.mockRejectedValueOnce(new HttpError(message, undefined, { status: 409, data: { message } } as never));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn thu gom' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Xác nhận huỷ' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: message, type: 'error' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.cancelWasteRequest).toHaveBeenCalledTimes(1);
  });

  it('huỷ gặp 503 (chưa gửi được tới đơn vị vận chuyển): hiện đúng câu của máy chủ, hộp xác nhận vẫn mở để bấm lại', async () => {
    const message = 'Chưa gửi được yêu cầu huỷ tới đơn vị vận chuyển, bạn thử lại sau ít phút nhé';
    mocks.cancelWasteRequest.mockRejectedValueOnce(new HttpError(message, undefined, { status: 503, data: { message } } as never));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn thu gom' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Xác nhận huỷ' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: message, type: 'error' })));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận huỷ' })).toBeEnabled());
  });

  it('chưa trừ điểm: hộp huỷ không nhắc hoàn điểm', async () => {
    mocks.getWasteRequest.mockResolvedValue(makeHomePickupRequest({ homePickup: makeHomePickup({ shipFeePointsUsed: 0 }) }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn thu gom' }));
    expect(await screen.findByRole('dialog')).not.toHaveTextContent('hoàn lại');
  });
});
