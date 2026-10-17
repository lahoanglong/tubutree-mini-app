import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  trackEvent: vi.fn(),
  authStatus: 'authenticated' as string,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/notifications', search: '', state: null }),
}));
vi.mock('../services/account-api', () => ({
  getNotifications: mocks.getNotifications,
  markNotificationRead: mocks.markNotificationRead,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
}));
vi.mock('../services/analytics', () => ({ trackEvent: mocks.trackEvent }));
vi.mock('../services/shop-api', () => ({ fetchPurchasedItems: vi.fn() }));
vi.mock('../services/buy-flow-events', () => ({ trackReorderReminderCta: vi.fn() }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.authStatus }),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/reorder/reorder-sheet', () => ({ ReorderSheet: () => null }));

import NotificationsPage from './notifications';

const SENT_AT = new Date(Date.now() - 5 * 60_000).toISOString();
const ORDER_UNREAD = {
  id: 'n1',
  templateCode: 'ORDER_CONFIRMED',
  payload: { body: 'Đơn TT001 đã được xác nhận', data: { order_code: 'TT001' } },
  status: 'SENT' as const,
  sentAt: SENT_AT,
};
const POINTS_READ = {
  id: 'n2',
  templateCode: 'POINTS_EARNED',
  payload: { body: 'Bạn nhận thêm 50 điểm Xanh' },
  status: 'READ' as const,
  sentAt: SENT_AT,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationsPage />
    </QueryClientProvider>,
  );
}

describe('Trang Thông báo: khung DS v2 (C-076, C-114)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getNotifications.mockResolvedValue([ORDER_UNREAD, POINTS_READ]);
    mocks.markNotificationRead.mockResolvedValue({ ok: true });
  });

  it('đúng một h1 "Thông báo" ở mọi trạng thái: đang tải, có tin, trống, lỗi', async () => {
    mocks.getNotifications.mockReturnValue(new Promise(() => undefined));
    const loading = renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Thông báo');
    expect(loading.container.querySelectorAll('.tubu-skeleton').length).toBeGreaterThan(0);
    loading.unmount();

    mocks.getNotifications.mockResolvedValue([ORDER_UNREAD]);
    const list = renderPage();
    await screen.findByText('Đơn TT001 đã được xác nhận');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    list.unmount();

    mocks.getNotifications.mockResolvedValue([]);
    const empty = renderPage();
    await screen.findByText('Chưa có thông báo nào');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    empty.unmount();

    mocks.getNotifications.mockRejectedValue(new Error('boom'));
    renderPage();
    await screen.findByRole('button', { name: 'Thử lại' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('chưa đăng nhập xong thì chưa gọi API (mở từ push của Zalo)', () => {
    mocks.authStatus = 'loading';
    renderPage();
    expect(mocks.getNotifications).not.toHaveBeenCalled();
  });

  it('lỗi tải: "Thử lại" gọi lại API', async () => {
    mocks.getNotifications.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([POINTS_READ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.getNotifications).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Bạn nhận thêm 50 điểm Xanh')).toBeInTheDocument();
  });

  it('mỗi tin là một hàng role=button; chỉ tin chưa đọc có dấu "chưa đọc"', async () => {
    renderPage();
    const unreadRow = (await screen.findByText('Đơn TT001 đã được xác nhận')).closest('[role="button"]') as HTMLElement;
    const readRow = screen.getByText('Bạn nhận thêm 50 điểm Xanh').closest('[role="button"]') as HTMLElement;
    expect(unreadRow).not.toBeNull();
    expect(readRow).not.toBeNull();
    expect(within(unreadRow).getByLabelText('chưa đọc')).toBeInTheDocument();
    expect(within(readRow).queryByLabelText('chưa đọc')).toBeNull();
  });

  it('hàng tin mở được bằng bàn phím (Tab + Enter)', async () => {
    renderPage();
    const row = (await screen.findByText('Đơn TT001 đã được xác nhận')).closest('[role="button"]') as HTMLElement;
    expect(row.tabIndex).toBe(0);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: 'Chi tiết thông báo' })).toBeInTheDocument();
  });
});

describe('Trang Thông báo: chi tiết thông báo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getNotifications.mockResolvedValue([ORDER_UNREAD, POINTS_READ]);
    mocks.markNotificationRead.mockResolvedValue({ ok: true });
  });

  const openRow = async (text: string) => {
    const row = (await screen.findByText(text)).closest('[role="button"]') as HTMLElement;
    fireEvent.click(row);
    return screen.findByRole('dialog', { name: 'Chi tiết thông báo' });
  };

  it('chạm tin chưa đọc: ghi nhận sự kiện, đánh dấu đã đọc và mở chi tiết', async () => {
    renderPage();
    const dialog = await openRow('Đơn TT001 đã được xác nhận');
    expect(mocks.trackEvent).toHaveBeenCalledWith('notification_opened', 'miniapp', {
      notificationId: 'n1',
      templateCode: 'ORDER_CONFIRMED',
    });
    expect(mocks.markNotificationRead).toHaveBeenCalledWith('n1');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Chi tiết thông báo' })).toBeInTheDocument();
    expect(within(dialog).getByText('Đơn đã xác nhận')).toBeInTheDocument();
  });

  it('chạm tin đã đọc: không gọi đánh dấu đã đọc', async () => {
    renderPage();
    await openRow('Bạn nhận thêm 50 điểm Xanh');
    expect(mocks.markNotificationRead).not.toHaveBeenCalled();
  });

  it('nút Quay lại trong chi tiết là nút 44px; bấm thì đóng chi tiết', async () => {
    renderPage();
    const dialog = await openRow('Đơn TT001 đã được xác nhận');
    const back = within(dialog).getByRole('button', { name: 'Quay lại' });
    expect(back.style.minHeight).toBe('44px');
    expect(back.style.minWidth).toBe('44px');
    fireEvent.click(back);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chi tiết thông báo' })).toBeNull());
  });

  it('nút hành động của tin đơn hàng đóng chi tiết và mở /order/<mã>', async () => {
    renderPage();
    const dialog = await openRow('Đơn TT001 đã được xác nhận');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xem chi tiết đơn hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TT001');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chi tiết thông báo' })).toBeNull());
  });
});

describe('Trang Thông báo: Đọc tất cả (R6-BUYER-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getNotifications.mockResolvedValue([ORDER_UNREAD, POINTS_READ]);
    mocks.markAllNotificationsRead.mockResolvedValue({ ok: true, count: 1 });
  });

  it('có tin chưa đọc: bấm "Đọc tất cả" gọi API một lần rồi nạp lại danh sách', async () => {
    renderPage();
    await screen.findByText('Đơn TT001 đã được xác nhận');
    fireEvent.click(await screen.findByRole('button', { name: 'Đọc tất cả' }));
    await waitFor(() => expect(mocks.markAllNotificationsRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.getNotifications).toHaveBeenCalledTimes(2));
  });

  it('không còn tin chưa đọc: ẩn nút', async () => {
    mocks.getNotifications.mockResolvedValue([POINTS_READ]);
    renderPage();
    await screen.findByText('Bạn nhận thêm 50 điểm Xanh');
    expect(screen.queryByRole('button', { name: 'Đọc tất cả' })).not.toBeInTheDocument();
  });

  it('danh sách trống: không có nút', async () => {
    mocks.getNotifications.mockResolvedValue([]);
    renderPage();
    await screen.findByText('Chưa có thông báo nào');
    expect(screen.queryByRole('button', { name: 'Đọc tất cả' })).not.toBeInTheDocument();
  });
});
