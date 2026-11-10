import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getNotifications: vi.fn(),
  getSummary: vi.fn(),
  paths: [] as string[],
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  trackEvent: vi.fn(),
  getSubscriptions: vi.fn(),
  fetchPurchasedItems: vi.fn(),
  authStatus: 'authenticated' as string,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/notifications', search: '', state: null }),
}));
// Trang đọc danh sách qua coreHttp của app-core (cùng hợp đồng với web): getNotifications nhận query của lời gọi.
vi.mock('../services/core-http', () => ({
  coreHttp: {
    get: (path: string, opts?: { query?: Record<string, unknown> }) => {
      mocks.paths.push(path);
      if (path === '/me/notifications') return mocks.getNotifications(opts?.query);
      if (path === '/me/summary') return mocks.getSummary() ?? Promise.reject(new Error('chưa mock summary'));
      return Promise.reject(new Error(`không mock ${path}`));
    },
  },
}));
vi.mock('../services/account-api', () => ({
  markNotificationRead: mocks.markNotificationRead,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
}));
vi.mock('../services/subscriptions-api', () => ({ getSubscriptions: mocks.getSubscriptions }));
vi.mock('../services/analytics', () => ({ trackEvent: mocks.trackEvent }));
vi.mock('../services/shop-api', () => ({ fetchPurchasedItems: mocks.fetchPurchasedItems }));
vi.mock('../services/buy-flow-events', () => ({ trackReorderReminderCta: vi.fn() }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.authStatus }),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/reorder/reorder-sheet', () => ({
  ReorderSheet: ({ target }: { target: { line: { productName: string } } | null }) =>
    target ? <div data-testid="reorder-sheet">{target.line.productName}</div> : null,
}));

import NotificationsPage from './notifications';
import { TubuQueryClient } from '../services/query-client';

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

const summaryOf = (unreadNotifications: number) => ({
  orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: 0 },
  unreadNotifications,
  activeSubscriptions: 0,
});

function renderPage() {
  const qc = new TubuQueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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

  it('chạm tin "Tubu Tree trả lời bạn": đánh dấu đã đọc và vào thẳng màn chat, không mở chi tiết', async () => {
    mocks.getNotifications.mockResolvedValue([
      { id: 'n3', templateCode: 'SUPPORT_CHAT_REPLY', payload: { body: 'Tubu Tree đã trả lời bạn: Dạ shop kiểm tra ạ', data: { route: '/chat' } }, status: 'SENT', sentAt: SENT_AT },
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Dạ shop kiểm tra ạ/ }));
    expect(mocks.trackEvent).toHaveBeenCalledWith('notification_opened', 'miniapp', { notificationId: 'n3', templateCode: 'SUPPORT_CHAT_REPLY' });
    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledWith('n3'));
    expect(mocks.navigate).toHaveBeenCalledWith('/chat');
    expect(screen.queryByRole('dialog', { name: 'Chi tiết thông báo' })).toBeNull();
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
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TT001', expect.objectContaining({ replace: true }));
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

  it('có tin chưa đọc: bấm "Đọc tất cả" gọi API một lần, tin chuyển sang đã đọc ngay trong cache', async () => {
    renderPage();
    await screen.findByText('Đơn TT001 đã được xác nhận');
    fireEvent.click(await screen.findByRole('button', { name: 'Đọc tất cả' }));
    await waitFor(() => expect(mocks.markAllNotificationsRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đọc tất cả' })).not.toBeInTheDocument());
    expect(mocks.getNotifications).toHaveBeenCalledTimes(1);
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

describe('E-83: đi tiếp từ chi tiết tin thay mục lịch sử notifDetail, lùi một lần là về danh sách tin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getNotifications.mockResolvedValue([ORDER_UNREAD, POINTS_READ]);
    mocks.markNotificationRead.mockResolvedValue({ ok: true });
  });

  const openRow = async (text: string) => {
    fireEvent.click((await screen.findByText(text)).closest('[role="button"]') as HTMLElement);
    return screen.findByRole('dialog', { name: 'Chi tiết thông báo' });
  };

  it('mở chi tiết đẩy mục lịch sử; bấm nút đích gọi navigate với replace: true', async () => {
    renderPage();
    const dialog = await openRow('Đơn TT001 đã được xác nhận');
    expect(window.history.state).toMatchObject({ notifDetail: true });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xem chi tiết đơn hàng' }));
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TT001', { replace: true, state: undefined });
  });

  it('không có mục notifDetail (lớp phủ không đẩy lịch sử) thì navigate thường, không replace', async () => {
    renderPage();
    const dialog = await openRow('Đơn TT001 đã được xác nhận');
    window.history.replaceState(null, '');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xem chi tiết đơn hàng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TT001');
  });

  it('nhắc mua lại chuyển hướng dự phòng cũng replace', async () => {
    mocks.getNotifications.mockResolvedValue([
      { id: 'n9', templateCode: 'REORDER_REMINDER', payload: { body: 'Dầu gội sắp hết', data: { product_slug: 'dau-goi' } }, status: 'READ', sentAt: SENT_AT },
    ]);
    renderPage();
    const dialog = await openRow('Dầu gội sắp hết');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mua lại ngay' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/product/dau-goi', { replace: true, state: undefined }));
  });
});

describe('E-83: nhắc mua lại mở sheet ngay trên trang tin', () => {
  const REMINDER = {
    id: 'n9', templateCode: 'REORDER_REMINDER', payload: { body: 'Dầu gội sắp hết', data: { variation_id: 'v1', product_slug: 'dau-goi' } },
    status: 'READ' as const, sentAt: SENT_AT,
  };
  const ITEM = {
    variationId: 'v1', productId: 'p1', slug: 'dau-goi', productName: 'Dầu gội', variationName: '500ml', brand: 'Tubu', thumbnail: null,
    price: 90000, salePrice: null, stock: 10, inStock: true, timesBought: 2, lastPurchasedAt: SENT_AT,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getNotifications.mockResolvedValue([REMINDER]);
    mocks.markNotificationRead.mockResolvedValue({ ok: true });
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [ITEM], nextCursor: null });
  });

  const openAndReorder = async () => {
    renderPage();
    fireEvent.click((await screen.findByText('Dầu gội sắp hết')).closest('[role="button"]') as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết thông báo' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mua lại ngay' }));
    await screen.findByTestId('reorder-sheet');
  };

  it('mở sheet thì gỡ mục lịch sử notifDetail (history.back) để đóng sheet xong lùi một lần là rời trang Thông báo', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    await openAndReorder();
    expect(window.history.state).toMatchObject({ notifDetail: true });
    expect(back).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Chi tiết thông báo' })).toBeNull();
    back.mockRestore();
  });

  it('không có mục notifDetail thì không lùi lịch sử', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    renderPage();
    fireEvent.click((await screen.findByText('Dầu gội sắp hết')).closest('[role="button"]') as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết thông báo' });
    window.history.replaceState(null, '');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mua lại ngay' }));
    await screen.findByTestId('reorder-sheet');
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
  });
});

describe('E-32: tin mời đánh giá', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.markNotificationRead.mockResolvedValue({ ok: true });
  });
  const REVIEW = (data: Record<string, string>) => ({ id: 'n7', templateCode: 'REVIEW_REQUEST', payload: { body: 'Đơn TT001 đã đến tay bạn.', data }, status: 'READ' as const, sentAt: SENT_AT });
  const open = async () => {
    renderPage();
    fireEvent.click((await screen.findByText('Đơn TT001 đã đến tay bạn.')).closest('[role="button"]') as HTMLElement);
    return screen.findByRole('dialog', { name: 'Chi tiết thông báo' });
  };

  it('tin mới (có order_id): nút "Viết đánh giá" mở trang sản phẩm kèm state reviewOrderId, tiêu đề "Mời đánh giá"', async () => {
    mocks.getNotifications.mockResolvedValue([REVIEW({ order_code: 'TT001', order_id: 'o1', product_slug: 'sua-tam' })]);
    const dialog = await open();
    expect(within(dialog).getByText('Mời đánh giá')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Xem chi tiết đơn hàng' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Viết đánh giá' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/sua-tam', { replace: true, state: { reviewOrderId: 'o1' } });
  });

  it('tin cũ (thiếu order_id): "Viết đánh giá" tới chi tiết đơn', async () => {
    mocks.getNotifications.mockResolvedValue([REVIEW({ order_code: 'TT001', product_slug: 'sua-tam' })]);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Viết đánh giá' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TT001', expect.objectContaining({ replace: true }));
  });
});

describe('E-4: tin cho chủ gian hàng ở Mini App', () => {
  it('không có nút mở đơn; chi tiết có câu chỉ dẫn sang web, không có liên kết', async () => {
    mocks.getNotifications.mockResolvedValue([
      { id: 'm1', templateCode: 'MERCHANT_ORDER_NEW', payload: { body: 'Gian hàng của bạn có đơn mới TB1', data: { order_code: 'TB1' } }, status: 'READ' as const, sentAt: SENT_AT },
    ]);
    const { container } = renderPage();
    fireEvent.click((await screen.findByText('Gian hàng của bạn có đơn mới TB1')).closest('[role="button"]') as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết thông báo' });
    expect(within(dialog).getByText('Gian hàng đối tác')).toBeInTheDocument();
    expect(within(dialog).getByText('Mở trang Đối tác trên web Tubu Tree để xử lý đơn.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /đơn hàng|Mở đơn/ })).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});

describe('E-71: tin gói định kỳ', () => {
  const SUB = { id: 'n8', templateCode: 'SUBSCRIPTION_PAUSED', payload: { body: 'Lịch đặt định kỳ đã tạm dừng' }, status: 'READ' as const, sentAt: SENT_AT };
  const open = async () => {
    mocks.getNotifications.mockResolvedValue([SUB]);
    renderPage();
    fireEvent.click((await screen.findByText('Lịch đặt định kỳ đã tạm dừng')).closest('[role="button"]') as HTMLElement);
    return screen.findByRole('dialog', { name: 'Chi tiết thông báo' });
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
  });

  it('khách có gói đang chạy hoặc tạm dừng: có nút "Xem gói" mở tab Định kỳ', async () => {
    mocks.getSubscriptions.mockResolvedValue([{ id: 's1', status: 'PAUSED' }]);
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Xem gói' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/orders?tab=subscriptions', expect.objectContaining({ replace: true }));
  });

  it('khách không có gói (hoặc chỉ gói đã huỷ): không có nút', async () => {
    mocks.getSubscriptions.mockResolvedValue([{ id: 's1', status: 'CANCELLED' }]);
    const dialog = await open();
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalled());
    expect(within(dialog).queryByRole('button', { name: 'Xem gói' })).toBeNull();
  });

  it('tin loại khác không tra gói', async () => {
    mocks.getNotifications.mockResolvedValue([ORDER_UNREAD]);
    renderPage();
    await screen.findByText('Đơn TT001 đã được xác nhận');
    expect(mocks.getSubscriptions).not.toHaveBeenCalled();
  });
});

describe('E-84: tải thêm tin', () => {
  const rows = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${from + i}`, templateCode: 'POINTS_EARNED', payload: { body: `Tin số ${from + i}` }, status: 'READ' as const, sentAt: new Date(Date.UTC(2026, 9, 28, 3, 0, 0) - (from + i) * 1000).toISOString(),
    }));
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
  });

  it('trang đầu xin 20 tin; đủ 20 thì có "Xem thêm", bấm nạp trang 2 theo con trỏ của tin cuối, hết thì ẩn nút', async () => {
    const first = rows(0, 20);
    mocks.getNotifications.mockResolvedValueOnce(first).mockResolvedValueOnce(rows(20, 5));
    renderPage();
    await screen.findByText('Tin số 0');
    expect(mocks.getNotifications).toHaveBeenNthCalledWith(1, { limit: 20 });
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
    expect(await screen.findByText('Tin số 24')).toBeInTheDocument();
    expect(mocks.getNotifications).toHaveBeenNthCalledWith(2, { before: first[19]!.sentAt, beforeId: 'p19', limit: 20 });
    expect(screen.getByText('Tin số 0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  });

  it('trang đầu ít hơn 20 tin: không có "Xem thêm"', async () => {
    mocks.getNotifications.mockResolvedValue(rows(0, 3));
    renderPage();
    await screen.findByText('Tin số 0');
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  });
});

describe('Đếm chưa đọc của cả hộp thư và lỗi "Xem thêm"', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`, templateCode: 'POINTS_EARNED', payload: { body: `Tin số ${i}` }, status: 'READ' as const, sentAt: new Date(Date.UTC(2026, 9, 28, 3, 0, 0) - i * 1000).toISOString(),
    }));
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSummary.mockReset();
    mocks.paths.length = 0;
    mocks.authStatus = 'authenticated';
    mocks.markAllNotificationsRead.mockResolvedValue({ ok: true, count: 3 });
  });

  it('số chưa đọc đến từ /me/summary: một lời gọi, không còn gọi /me/notifications/unread-count', async () => {
    mocks.getNotifications.mockResolvedValue(rows(20));
    mocks.getSummary.mockResolvedValue(summaryOf(3));
    renderPage();
    await screen.findByRole('button', { name: 'Đọc tất cả' });
    expect(mocks.paths.filter((p) => p === '/me/summary')).toHaveLength(1);
    expect(mocks.paths).not.toContain('/me/notifications/unread-count');
  });

  it('đọc một tin: summary được làm mới và số giảm về 0 ngay (nút "Đọc tất cả" biến mất)', async () => {
    mocks.getNotifications.mockResolvedValue([ORDER_UNREAD, POINTS_READ]);
    mocks.markNotificationRead.mockResolvedValue({ ok: true });
    mocks.getSummary.mockResolvedValueOnce(summaryOf(1)).mockResolvedValue(summaryOf(0));
    renderPage();
    await screen.findByRole('button', { name: 'Đọc tất cả' });
    fireEvent.click((await screen.findByText('Đơn TT001 đã được xác nhận')).closest('[role="button"]') as HTMLElement);
    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledWith('n1'));
    await waitFor(() => expect(mocks.getSummary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đọc tất cả' })).toBeNull());
  });

  it('"Đọc tất cả": summary được làm mới và số về 0', async () => {
    mocks.getNotifications.mockResolvedValue(rows(20));
    mocks.getSummary.mockResolvedValueOnce(summaryOf(3)).mockResolvedValue(summaryOf(0));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đọc tất cả' }));
    await waitFor(() => expect(mocks.getSummary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đọc tất cả' })).toBeNull());
  });

  it('summary trong cache còn tươi (Trang chủ vừa tải, staleTime 10 giây) vẫn tải lại khi mở trang: tin mới chưa đọc hiện "Đọc tất cả"', async () => {
    mocks.getNotifications.mockResolvedValue([ORDER_UNREAD, POINTS_READ]);
    mocks.getSummary.mockResolvedValue(summaryOf(1));
    const qc = new TubuQueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 }, mutations: { retry: false } } });
    qc.setQueryData(['me-summary'], summaryOf(0));
    render(
      <QueryClientProvider client={qc}>
        <NotificationsPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(mocks.getSummary).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Đọc tất cả' })).toBeInTheDocument();
  });

  it('summary lỗi: không hiện số sai, lùi về đếm trong danh sách đã tải', async () => {
    mocks.getSummary.mockRejectedValue(new Error('boom'));
    mocks.getNotifications.mockResolvedValue(rows(20));
    const allRead = renderPage();
    await screen.findByText('Tin số 0');
    await waitFor(() => expect(mocks.getSummary).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Đọc tất cả' })).toBeNull();
    allRead.unmount();

    mocks.getNotifications.mockResolvedValue([ORDER_UNREAD, POINTS_READ]);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Đọc tất cả' })).toBeInTheDocument();
  });

  it('20 tin trang đầu đều đã đọc nhưng máy chủ báo còn 3 tin chưa đọc: vẫn có "Đọc tất cả", bấm thì gọi đọc hết', async () => {
    mocks.getNotifications.mockResolvedValue(rows(20));
    mocks.getSummary.mockResolvedValue(summaryOf(3));
    renderPage();
    await screen.findByText('Tin số 0');
    fireEvent.click(await screen.findByRole('button', { name: 'Đọc tất cả' }));
    await waitFor(() => expect(mocks.markAllNotificationsRead).toHaveBeenCalledTimes(1));
  });

  it('máy chủ báo 0 chưa đọc: ẩn nút', async () => {
    mocks.getNotifications.mockResolvedValue(rows(20));
    mocks.getSummary.mockResolvedValue(summaryOf(0));
    renderPage();
    await screen.findByText('Tin số 0');
    await waitFor(() => expect(mocks.getSummary).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Đọc tất cả' })).toBeNull();
  });

  it('"Xem thêm" lỗi: báo bằng role=alert, giữ danh sách và nút để thử lại', async () => {
    mocks.getNotifications.mockResolvedValueOnce(rows(20)).mockRejectedValueOnce(new Error('mạng'));
    renderPage();
    await screen.findByText('Tin số 0');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải thêm được thông báo. Bạn thử lại nhé.');
    expect(screen.getByText('Tin số 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xem thêm' })).toBeInTheDocument();
  });
});

describe('F10: đánh dấu đã đọc không nạp lại mọi trang đã cuộn', () => {
  const page = (from: number, unreadAt?: number) =>
    Array.from({ length: 20 }, (_, i) => ({
      id: `q${from + i}`,
      templateCode: 'POINTS_EARNED',
      payload: { body: `Tin số ${from + i}` },
      status: (from + i === unreadAt ? 'SENT' : 'READ') as 'SENT' | 'READ',
      sentAt: new Date(Date.UTC(2026, 9, 28, 3, 0, 0) - (from + i) * 1000).toISOString(),
    }));
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSummary.mockReset();
    mocks.paths.length = 0;
    mocks.authStatus = 'authenticated';
    mocks.getSummary.mockResolvedValueOnce(summaryOf(1)).mockResolvedValue(summaryOf(0));
    mocks.markNotificationRead.mockResolvedValue({ ok: true });
    mocks.markAllNotificationsRead.mockResolvedValue({ ok: true, count: 1 });
    mocks.getNotifications.mockImplementation(async (q?: { beforeId?: string }) => {
      if (!q?.beforeId) return page(0);
      return q.beforeId === 'q19' ? page(20) : page(40, 45);
    });
  });

  async function scrollThreePages() {
    renderPage();
    await screen.findByText('Tin số 0');
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
    await screen.findByText('Tin số 20');
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
    await screen.findByText('Tin số 45');
    await waitFor(() => expect(mocks.getSummary).toHaveBeenCalled());
    mocks.paths.length = 0;
  }

  it('đọc một tin ở trang 3: không gọi lại /me/notifications, tin chuyển sang đã đọc, summary làm mới', async () => {
    await scrollThreePages();
    fireEvent.click(screen.getByText('Tin số 45').closest('[role="button"]') as HTMLElement);
    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledWith('q45'));
    await waitFor(() => expect(mocks.paths.filter((p) => p === '/me/summary')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.paths.filter((p) => p === '/me/notifications')).toHaveLength(0);
    expect(mocks.paths.length).toBeLessThanOrEqual(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đọc tất cả' })).toBeNull());
  }, 30_000);

  it('"Đọc tất cả": không gọi lại /me/notifications', async () => {
    await scrollThreePages();
    fireEvent.click(await screen.findByRole('button', { name: 'Đọc tất cả' }));
    await waitFor(() => expect(mocks.markAllNotificationsRead).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.paths.filter((p) => p === '/me/notifications')).toHaveLength(0);
    expect(mocks.paths.length).toBeLessThanOrEqual(1);
  }, 30_000);
});

describe('F10: đọc tin lúc đang nạp thêm trang', () => {
  it('có lần nạp đang chạy khi mutation xong thì danh sách được nạp lại, không để bản cũ ghi đè tin vừa đọc', async () => {
    vi.clearAllMocks();
    mocks.getSummary.mockReset();
    mocks.authStatus = 'authenticated';
    mocks.getSummary.mockResolvedValue(summaryOf(1));
    mocks.markNotificationRead.mockResolvedValue({ ok: true });
    const first = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`,
      templateCode: i === 0 ? 'ORDER_CONFIRMED' : 'POINTS_EARNED',
      payload: { body: `Tin r${i}`, ...(i === 0 ? { data: { order_code: 'TT009' } } : {}) },
      status: (i === 0 ? 'SENT' : 'READ') as 'SENT' | 'READ',
      sentAt: new Date(Date.UTC(2026, 9, 28, 3, 0, 0) - i * 1000).toISOString(),
    }));
    let release: (v: unknown[]) => void = () => undefined;
    let firstPageCalls = 0;
    mocks.getNotifications.mockImplementation((q?: { beforeId?: string }) => {
      if (q?.beforeId) return new Promise((r) => (release = r));
      firstPageCalls += 1;
      return Promise.resolve(firstPageCalls === 1 ? first : first.map((n) => ({ ...n, status: 'READ' as const })));
    });
    renderPage();
    await screen.findByText('Tin r1');
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
    fireEvent.click(screen.getByText('Tin r0').closest('[role="button"]') as HTMLElement);
    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledWith('r0'));
    await waitFor(() => expect(firstPageCalls).toBeGreaterThanOrEqual(2));
    release([]);
  });
});

describe('W68A: "Đọc tất cả" khoá đồng bộ, lỗi tại chỗ, khung chờ, số đều', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    // Không có summary thì số chưa đọc đếm từ danh sách đã tải (các ca trên để lại mockResolvedValue(summaryOf(1)) làm nút không biến mất).
    mocks.getSummary.mockReset();
    mocks.getNotifications.mockReset().mockResolvedValue([ORDER_UNREAD, POINTS_READ]);
    mocks.markNotificationRead.mockReset().mockResolvedValue({ ok: true });
    mocks.markAllNotificationsRead.mockReset().mockResolvedValue({ ok: true, count: 1 });
  });

  const readAllButton = () => screen.findByRole('button', { name: 'Đọc tất cả' });

  it('chạm đúp trong cùng một nhịp vẽ: chỉ một lời gọi API; đang gửi thì nút báo bận', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.markAllNotificationsRead.mockReturnValue(new Promise((r) => (release = r)));
    renderPage();
    await screen.findByText('Đơn TT001 đã được xác nhận');
    const btn = await readAllButton();
    act(() => {
      btn.click();
      btn.click();
    });
    await waitFor(() => expect(mocks.markAllNotificationsRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đọc tất cả' })).toHaveAttribute('aria-busy', 'true'));
    await act(async () => {
      btn.click();
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.markAllNotificationsRead).toHaveBeenCalledTimes(1);
    await act(async () => release({ ok: true, count: 1 }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đọc tất cả' })).not.toBeInTheDocument());
  });

  it('đọc tất cả lỗi: báo tại chỗ bằng role=alert, giữ danh sách; "Thử lại" (nút 44px) gọi lại và xoá báo lỗi khi xong', async () => {
    mocks.markAllNotificationsRead.mockRejectedValueOnce(new Error('mạng')).mockResolvedValue({ ok: true, count: 1 });
    renderPage();
    await screen.findByText('Đơn TT001 đã được xác nhận');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(await readAllButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Có chút trục trặc, thử lại nhé');
    expect(screen.getByText('Đơn TT001 đã được xác nhận')).toBeInTheDocument();
    const retry = within(alert).getByRole('button', { name: 'Thử lại đánh dấu đã đọc' });
    expect(retry.style.minHeight).toBe('44px');
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.markAllNotificationsRead).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Đọc tất cả' })).not.toBeInTheDocument();
  });

  it('lỗi rồi bấm "Thử lại": báo lỗi đứng yên, nút báo bận và không nhận lần chạm thứ hai', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.markAllNotificationsRead
      .mockRejectedValueOnce(new Error('mạng'))
      .mockReturnValue(new Promise((r) => (release = r)));
    renderPage();
    await screen.findByText('Đơn TT001 đã được xác nhận');
    fireEvent.click(await readAllButton());
    const retry = within(await screen.findByRole('alert')).getByRole('button', { name: 'Thử lại đánh dấu đã đọc' });
    act(() => {
      retry.click();
      retry.click();
    });
    await waitFor(() => expect(mocks.markAllNotificationsRead).toHaveBeenCalledTimes(2));
    const busy = within(screen.getByRole('alert')).getByRole('button', { name: 'Thử lại đánh dấu đã đọc' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.markAllNotificationsRead).toHaveBeenCalledTimes(2);
    await act(async () => release({ ok: true, count: 1 }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('thất bại rồi thành công ở lần bấm sau: khoá đã nhả, API được gọi lại đúng một lần mỗi lần bấm', async () => {
    mocks.markAllNotificationsRead.mockRejectedValueOnce(new Error('mạng')).mockResolvedValueOnce({ ok: true, count: 1 });
    renderPage();
    await screen.findByText('Đơn TT001 đã được xác nhận');
    fireEvent.click(await readAllButton());
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Đọc tất cả' }));
    await waitFor(() => expect(mocks.markAllNotificationsRead).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.markAllNotificationsRead).toHaveBeenCalledTimes(2);
  });

  it('lỗi lặp lại cùng một câu: khối alert đứng yên (nút giữ focus) nhưng dòng chữ dựng lại để trình đọc màn hình đọc lại', async () => {
    mocks.markAllNotificationsRead.mockRejectedValue(new Error('mạng'));
    renderPage();
    await screen.findByText('Đơn TT001 đã được xác nhận');
    fireEvent.click(await readAllButton());
    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', { name: 'Thử lại đánh dấu đã đọc' });
    const firstLine = within(alert).getByText('Có chút trục trặc, thử lại nhé');
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.markAllNotificationsRead).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(alert).getByText('Có chút trục trặc, thử lại nhé')).not.toBe(firstLine));
    expect(screen.getByRole('alert')).toBe(alert);
    expect(within(alert).getByRole('button', { name: 'Thử lại đánh dấu đã đọc' })).toBe(retry);
    expect(document.activeElement).toBe(retry);
  });

  it('hết tin chưa đọc sau lỗi (đọc lẻ từng tin): khối báo lỗi biến mất, không để nút "Thử lại" mồ côi', async () => {
    mocks.getNotifications.mockResolvedValue([ORDER_UNREAD]);
    mocks.markAllNotificationsRead.mockRejectedValue(new Error('mạng'));
    renderPage();
    const row = (await screen.findByText('Đơn TT001 đã được xác nhận')).closest('[role="button"]') as HTMLElement;
    fireEvent.click(await readAllButton());
    await screen.findByRole('alert');
    fireEvent.click(row);
    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledWith('n1'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Đọc tất cả' })).not.toBeInTheDocument();
  });

  it('danh sách tải lỗi nhưng số chưa đọc vẫn có: hai nút "Thử lại" cùng hiện thì khác tên (tải lại danh sách / đánh dấu đã đọc)', async () => {
    mocks.getNotifications.mockRejectedValue(new Error('boom'));
    mocks.getSummary.mockResolvedValue(summaryOf(2));
    mocks.markAllNotificationsRead.mockRejectedValue(new Error('mạng'));
    renderPage();
    fireEvent.click(await readAllButton());
    const alert = await screen.findByRole('alert');
    const names = screen.getAllByRole('button', { name: /^Thử lại/ }).map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(within(alert).getByRole('button', { name: 'Thử lại đánh dấu đã đọc' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('nút "Đọc tất cả" là nút 44px', async () => {
    renderPage();
    expect((await readAllButton()).style.minHeight).toBe('44px');
  });

  it('khung chờ báo aria-busy: lúc tải danh sách và lúc chờ đăng nhập xong', async () => {
    mocks.getNotifications.mockReturnValue(new Promise(() => undefined));
    const first = renderPage();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    first.unmount();
    mocks.authStatus = 'loading';
    renderPage();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('khung chờ biến mất khi có danh sách: không còn phần tử nào aria-busy', async () => {
    renderPage();
    await screen.findByText('Đơn TT001 đã được xác nhận');
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('số đều (tabular-nums): danh sách tin và lớp chi tiết đều nằm trong .tubu-nums', async () => {
    renderPage();
    const row = (await screen.findByText('Đơn TT001 đã được xác nhận')).closest('[role="button"]') as HTMLElement;
    expect(row.closest('.tubu-nums')).not.toBeNull();
    fireEvent.click(row);
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết thông báo' });
    expect(dialog.classList.contains('tubu-nums')).toBe(true);
  });
});

describe('W78A: đánh dấu đã đọc từng tin khoá đồng bộ theo id tin', () => {
  const ORDER_UNREAD_2 = {
    id: 'n4',
    templateCode: 'ORDER_SHIPPING',
    payload: { body: 'Đơn TT002 đang giao', data: { order_code: 'TT002' } },
    status: 'SENT' as const,
    sentAt: SENT_AT,
  };
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const rowOf = async (text: string) => (await screen.findByText(text)).closest('[role="button"]') as HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getSummary.mockReset();
    mocks.getNotifications.mockReset().mockResolvedValue([ORDER_UNREAD, ORDER_UNREAD_2, POINTS_READ]);
    mocks.markNotificationRead.mockReset().mockResolvedValue({ ok: true });
    mocks.markAllNotificationsRead.mockReset().mockResolvedValue({ ok: true, count: 2 });
  });

  it('chạm đúp cùng một tin chưa đọc trong cùng một khung hình chỉ gửi một lệnh đọc; xong tin chuyển sang đã đọc', async () => {
    const d = deferred();
    mocks.markNotificationRead.mockReturnValue(d.promise);
    renderPage();
    const row = await rowOf('Đơn TT001 đã được xác nhận');
    expect(within(row).getByLabelText('chưa đọc')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(row);
      fireEvent.click(row);
    });
    expect(mocks.markNotificationRead).toHaveBeenCalledTimes(1);
    expect(mocks.markNotificationRead).toHaveBeenCalledWith('n1');
    await act(async () => d.resolve({ ok: true }));
    await waitFor(() => expect(within(row).queryByLabelText('chưa đọc')).toBeNull());
    expect(mocks.markNotificationRead).toHaveBeenCalledTimes(1);
  });

  it('hai tin chưa đọc khác nhau chạm trong cùng một khung hình: cả hai đều gửi lệnh đọc (khoá theo id)', async () => {
    const a = deferred();
    const b = deferred();
    mocks.markNotificationRead.mockImplementation((id: string) => (id === 'n1' ? a.promise : b.promise));
    renderPage();
    const first = await rowOf('Đơn TT001 đã được xác nhận');
    const second = await rowOf('Đơn TT002 đang giao');
    await act(async () => {
      fireEvent.click(first);
      fireEvent.click(second);
    });
    expect(mocks.markNotificationRead).toHaveBeenCalledTimes(2);
    expect(mocks.markNotificationRead.mock.calls.map(([id]) => id).sort()).toEqual(['n1', 'n4']);
    await act(async () => {
      a.resolve({ ok: true });
      b.resolve({ ok: true });
    });
    await waitFor(() => expect(within(first).queryByLabelText('chưa đọc')).toBeNull());
    await waitFor(() => expect(within(second).queryByLabelText('chưa đọc')).toBeNull());
  });

  it('lỗi thì nhả khoá, chạm lại tin đó gọi lần hai; tin vẫn chưa đọc cho tới khi lần hai xong', async () => {
    const d = deferred();
    mocks.markNotificationRead.mockReturnValueOnce(d.promise);
    renderPage();
    const row = await rowOf('Đơn TT001 đã được xác nhận');
    await act(async () => {
      fireEvent.click(row);
      fireEvent.click(row);
    });
    expect(mocks.markNotificationRead).toHaveBeenCalledTimes(1);
    await act(async () => d.reject(new Error('mạng')));
    await waitFor(() => expect(mocks.getNotifications).toHaveBeenCalledTimes(2));
    expect(row.isConnected).toBe(true);
    expect(within(row).getByLabelText('chưa đọc')).toBeInTheDocument();

    fireEvent.click(row);
    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(row).queryByLabelText('chưa đọc')).toBeNull());
  });
});

describe('W85A: "Xem thêm" của danh sách thông báo khoá đồng bộ', () => {
  const rows = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${from + i}`, templateCode: 'POINTS_EARNED', payload: { body: `Tin số ${from + i}` }, status: 'READ' as const, sentAt: new Date(Date.UTC(2026, 9, 28, 3, 0, 0) - (from + i) * 1000).toISOString(),
    }));
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getSummary.mockReset();
    mocks.getNotifications.mockReset();
  });

  it('chạm đúp "Xem thêm" trong cùng một nhịp vẽ: chỉ một lần nạp trang 2', async () => {
    const page2 = deferred();
    mocks.getNotifications.mockResolvedValueOnce(rows(0, 20)).mockReturnValueOnce(page2.promise);
    renderPage();
    await screen.findByText('Tin số 0');
    const more = await screen.findByRole('button', { name: 'Xem thêm' });
    await act(async () => {
      fireEvent.click(more);
      fireEvent.click(more);
    });
    expect(mocks.getNotifications).toHaveBeenCalledTimes(2);
    await act(async () => page2.resolve(rows(20, 5)));
    expect(await screen.findByText('Tin số 24')).toBeInTheDocument();
    expect(mocks.getNotifications).toHaveBeenCalledTimes(2);
  });

  it('hai lần chạm "Xem thêm" cách nhau một microtask: vẫn một lần nạp', async () => {
    const page2 = deferred();
    mocks.getNotifications.mockResolvedValueOnce(rows(0, 20)).mockReturnValueOnce(page2.promise);
    renderPage();
    await screen.findByText('Tin số 0');
    const more = await screen.findByRole('button', { name: 'Xem thêm' });
    await act(async () => {
      fireEvent.click(more);
      await Promise.resolve();
      fireEvent.click(more);
    });
    expect(mocks.getNotifications).toHaveBeenCalledTimes(2);
    await act(async () => page2.resolve(rows(20, 5)));
    expect(await screen.findByText('Tin số 24')).toBeInTheDocument();
  });
});
