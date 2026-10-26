import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: '',
  authStatus: 'authenticated' as string,
  cloudinary: false,
  getThread: vi.fn(),
  send: vi.fn(),
  markRead: vi.fn(),
  summary: vi.fn(),
  login: vi.fn(),
  openSnackbar: vi.fn(),
  fetchContact: vi.fn(),
  upload: vi.fn(),
  getPage: vi.fn(),
  fetchOrders: vi.fn(),
  callPhone: vi.fn(),
  copyText: vi.fn(),
  hasOA: false,
  openOAChat: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/chat', search: mocks.search, state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/support-chat-api', () => ({
  supportChatQueryOptions: () => ({ queryKey: ['support-chat'], queryFn: mocks.getThread }),
  supportChatSummaryQueryOptions: () => ({ queryKey: ['support-chat-summary'], queryFn: mocks.summary }),
  sendSupportChat: mocks.send,
  getSupportChatPage: mocks.getPage,
  markSupportChatRead: mocks.markRead,
}));
vi.mock('../store/auth', () => {
  const state = () => ({ status: mocks.authStatus, login: mocks.login, restore: vi.fn() });
  return { useAuthStore: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: state }) };
});
vi.mock('../components/image-upload', () => ({
  isCloudinaryConfigured: () => mocks.cloudinary,
  uploadToCloudinary: mocks.upload,
  MAX_IMAGE_BYTES: 20 * 1024 * 1024,
}));
vi.mock('./about-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSupportContact: mocks.fetchContact,
}));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrders: mocks.fetchOrders,
}));
vi.mock('../services/zmp-bridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callPhone: mocks.callPhone,
  openOAChat: mocks.openOAChat,
  get hasOA() {
    return mocks.hasOA;
  },
}));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { LivePathnameContext } from '../hooks/use-live-pathname';
import SupportChatPage from './support-chat';

const msg = (over: Record<string, unknown>) => ({
  id: 'm', sender: 'CUSTOMER', body: 'x', imageUrl: null, context: null, clientMsgId: null, createdAt: '2026-10-23T03:04:00.000Z', ...over,
});
const thread = (over: Record<string, unknown> = {}) => ({
  code: 'K7Q3', blocked: false, enabled: true, slow: false, hasMore: false, messages: [], ...over,
});

let qc: QueryClient;
function renderPage() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupportChatPage />
    </QueryClientProvider>,
  );
}
/** Mã các bong bóng thật; lời chào phía client (msg-greeting) không tính. */
const msgIds = () => screen.getAllByTestId(/^msg-/).map((e) => e.getAttribute('data-testid')).filter((id) => id !== 'msg-greeting');
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const typeAndSend = (text: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi' }));
};
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { isHttpError: true, response: { status, data: { message } } });

describe('Màn chat với Tubu Tree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = '';
    mocks.authStatus = 'authenticated';
    mocks.cloudinary = false;
    mocks.fetchContact.mockResolvedValue({ hotline: '0984 606 774', email: null, zaloOaName: null, hours: '8:00–21:00 mỗi ngày' });
    mocks.fetchOrders.mockResolvedValue({ data: [], meta: { page: 1, limit: 1, total: 0 } });
    mocks.copyText.mockResolvedValue(true);
    mocks.hasOA = false;
    mocks.getThread.mockResolvedValue(thread());
    mocks.markRead.mockResolvedValue({ ok: true });
    mocks.summary.mockResolvedValue({ unreadCount: 0 });
    let n = 0;
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `cid-${++n}` as `${string}-${string}-${string}-${string}-${string}`);
  });
  afterEach(() => vi.restoreAllMocks());

  it('chưa đăng nhập: không gọi API chat, mời đăng nhập', () => {
    mocks.authStatus = 'idle';
    renderPage();
    expect(mocks.getThread).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('tin hiện cũ → mới; khách bên phải, Tubu Tree bên trái kèm tên, tin hệ thống ở giữa không có tên', async () => {
    mocks.getThread.mockResolvedValue(
      thread({
        messages: [
          msg({ id: 'm1', body: 'Cho mình hỏi' }),
          msg({ id: 'm2', sender: 'STAFF', body: 'Dạ chào bạn' }),
          msg({ id: 'm3', sender: 'SYSTEM', body: 'Tubu Tree trả lời từ 8:00 đến 21:00. Tin của bạn đã được ghi lại.' }),
        ],
      }),
    );
    renderPage();
    const mine = await screen.findByTestId('msg-m1');
    const staff = screen.getByTestId('msg-m2');
    const system = screen.getByTestId('msg-m3');
    expect(mine).toHaveAttribute('data-sender', 'CUSTOMER');
    expect(staff).toHaveAttribute('data-sender', 'STAFF');
    expect(within(staff).getByText('Tubu Tree')).toBeInTheDocument();
    expect(within(mine).queryByText('Tubu Tree')).toBeNull();
    expect(within(system).queryByText('Tubu Tree')).toBeNull();
    expect(system).toHaveAttribute('data-sender', 'SYSTEM');
    const order = msgIds();
    expect(order).toEqual(['msg-m1', 'msg-m2', 'msg-m3']);
  });

  it('gửi: hiện ngay "Đang gửi", API trả về thì "Đã gửi" và làm mới hội thoại', async () => {
    let resolve!: (v: unknown) => void;
    mocks.send.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();
    await screen.findByRole('textbox');
    typeAndSend('Xin chào');
    const bubble = await screen.findByTestId('msg-cid-1');
    expect(within(bubble).getByText('Xin chào')).toBeInTheDocument();
    expect(within(bubble).getByText('Đang gửi')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(mocks.send.mock.calls[0]![0].source).toBe('MINIAPP');
    const calls = mocks.getThread.mock.calls.length;
    resolve(msg({ id: 'srv1', body: 'Xin chào', clientMsgId: 'cid-1' }));
    await waitFor(() => expect(within(screen.getByTestId('msg-cid-1')).getByText('Đã gửi')).toBeInTheDocument());
    await waitFor(() => expect(mocks.getThread.mock.calls.length).toBeGreaterThan(calls));
  });

  it('lỗi mạng: hiện "Gửi lại", bấm lại dùng đúng clientMsgId cũ', async () => {
    mocks.send.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(msg({ id: 'srv1', clientMsgId: 'cid-1' }));
    renderPage();
    await screen.findByRole('textbox');
    typeAndSend('Xin chào');
    fireEvent.click(await screen.findByRole('button', { name: 'Gửi lại' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[0]![0].clientMsgId).toBe('cid-1');
    expect(mocks.send.mock.calls[1]![0].clientMsgId).toBe('cid-1');
    expect(mocks.send.mock.calls[1]![0].body).toBe('Xin chào');
    await waitFor(() => expect(within(screen.getByTestId('msg-cid-1')).getByText('Đã gửi')).toBeInTheDocument());
  });

  it('409/403: hiện câu của máy chủ, không có nút "Gửi lại"', async () => {
    const m = 'Bạn tạm thời không gửi được tin. Cần hỗ trợ, gọi hotline.';
    mocks.send.mockRejectedValue(httpError(403, m));
    renderPage();
    await screen.findByRole('textbox');
    typeAndSend('Xin chào');
    expect(await screen.findByText(m)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gửi lại' })).toBeNull();
  });

  it('?order=TT12345: thẻ "Về đơn TT12345"; tin đầu kèm context, tin sau thì không', async () => {
    mocks.search = '?order=TT12345';
    mocks.send.mockImplementation(async (input: { clientMsgId: string }) => msg({ id: `s-${input.clientMsgId}`, clientMsgId: input.clientMsgId }));
    renderPage();
    expect(await screen.findByText('Về đơn TT12345')).toBeInTheDocument();
    typeAndSend('Một');
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send.mock.calls[0]![0].context).toEqual({ orderCode: 'TT12345' });
    await waitFor(() => expect(screen.queryByText('Về đơn TT12345')).toBeNull());
    typeAndSend('Hai');
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[1]![0].context).toBeUndefined();
  });

  it('?product=<slug>: thẻ "Về sản phẩm <tên>" khi đã có trong bộ nhớ, không thì dùng slug; tin đầu kèm productSlug', async () => {
    mocks.search = '?product=xa-bong-thao-moc';
    mocks.send.mockResolvedValue(msg({ id: 's1', clientMsgId: 'cid-1' }));
    renderPage();
    expect(await screen.findByText('Về sản phẩm xa-bong-thao-moc')).toBeInTheDocument();
    typeAndSend('Còn hàng không');
    await waitFor(() => expect(mocks.send).toHaveBeenCalled());
    expect(mocks.send.mock.calls[0]![0].context).toEqual({ productSlug: 'xa-bong-thao-moc' });
  });

  it('slow: dòng báo chậm kèm hotline', async () => {
    mocks.getThread.mockResolvedValue(thread({ slow: true }));
    renderPage();
    expect(await screen.findByText('Nhân viên có thể trả lời chậm. Cần gấp, gọi hotline 0984 606 774')).toBeInTheDocument();
  });

  it('blocked: ẩn ô nhập, hiện câu của hợp đồng', async () => {
    mocks.getThread.mockResolvedValue(thread({ blocked: true }));
    renderPage();
    expect(await screen.findByText('Bạn tạm thời không gửi được tin. Cần hỗ trợ, gọi hotline.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('enabled=false: không có ô nhập, hiện số hotline to và nút gọi', async () => {
    mocks.getThread.mockResolvedValue(thread({ enabled: false }));
    renderPage();
    expect(await screen.findByText('Chat đang tạm đóng')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Giờ trực: 8:00–21:00 mỗi ngày')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gọi 0984 606 774' }));
    expect(mocks.callPhone).toHaveBeenCalledWith('0984 606 774');
  });

  it('enabled=false: chạm số để sao chép; không có OA thì không có nút Nhắn OA', async () => {
    mocks.getThread.mockResolvedValue(thread({ enabled: false }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /0984 606 774\. Chạm vào số để sao chép/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('0984 606 774'));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép số hotline', type: 'success' });
    expect(screen.queryByRole('button', { name: 'Nhắn OA' })).toBeNull();
  });

  it('enabled=false: có tên Zalo OA và OA gắn sẵn thì hiện nút Nhắn OA; có email thì hiện email', async () => {
    mocks.hasOA = true;
    mocks.fetchContact.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: 'Tubu Tree', hours: null });
    mocks.getThread.mockResolvedValue(thread({ enabled: false }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Nhắn OA' }));
    expect(mocks.openOAChat).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'tubutree@gmail.com' })).toBeInTheDocument();
    expect(screen.queryByText(/Giờ trực/)).toBeNull();
  });

  it('chat bật, chưa có tin: lời chào kèm giờ trực và các câu hỏi nhanh; chạm là gửi câu đó', async () => {
    mocks.send.mockResolvedValue({});
    renderPage();
    expect(await screen.findByText('Tubu Tree hỗ trợ 8:00–21:00 mỗi ngày. Bạn cần hỏi gì ạ?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đơn của tôi đang ở đâu?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đổi trả hàng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Hỏi về đơn/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Đổi trả hàng' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ body: 'Mình muốn hỏi về đổi trả hàng.', source: 'MINIAPP' })));
    expect(screen.queryByRole('button', { name: 'Cách dùng sản phẩm' })).toBeNull();
  });

  it('có đơn đang giao: thêm nút "Hỏi về đơn {mã}", gửi kèm mã đơn làm ngữ cảnh', async () => {
    mocks.send.mockResolvedValue({});
    mocks.fetchOrders.mockResolvedValue({ data: [{ code: 'TUBU99' }], meta: { page: 1, limit: 1, total: 1 } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Hỏi về đơn TUBU99' }));
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ body: 'Mình muốn hỏi về đơn TUBU99.', context: { orderCode: 'TUBU99' } })),
    );
  });

  it('đã có tin: lời chào vẫn ở đầu cuộc trò chuyện, câu hỏi nhanh thì hết', async () => {
    mocks.getThread.mockResolvedValue(thread({ messages: [msg({ id: 'a', body: 'xin chào' })] }));
    renderPage();
    expect(await screen.findByText('xin chào')).toBeInTheDocument();
    const ids = screen.getAllByTestId(/^msg-/).map((e) => e.getAttribute('data-testid'));
    expect(ids).toEqual(['msg-greeting', 'msg-a']);
    expect(screen.queryByRole('button', { name: 'Đổi trả hàng' })).toBeNull();
  });

  it('còn tin cũ hơn để tải: chưa tới đầu cuộc trò chuyện nên chưa hiện lời chào', async () => {
    mocks.getThread.mockResolvedValue(thread({ hasMore: true, messages: [msg({ id: 'a', body: 'xin chào' })] }));
    renderPage();
    expect(await screen.findByText('xin chào')).toBeInTheDocument();
    expect(screen.queryByTestId('msg-greeting')).toBeNull();
  });

  it('câu hỏi nhanh chỉ hiện khi truy vấn đơn đang giao đã xong, để nút "Hỏi về đơn" không chèn muộn', async () => {
    let finish: (v: unknown) => void = () => {};
    mocks.fetchOrders.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();
    await screen.findByRole('textbox');
    expect(screen.queryByRole('button', { name: 'Đổi trả hàng' })).toBeNull();
    await act(async () => finish({ data: [{ code: 'TUBU99' }], meta: { page: 1, limit: 1, total: 1 } }));
    const buttons = (await screen.findAllByRole('button', { name: /Hỏi về đơn|Đổi trả hàng|Đơn của tôi/ })).map((b) => b.textContent);
    expect(buttons[0]).toBe('Hỏi về đơn TUBU99');
  });

  it('truy vấn đơn đang giao lỗi: vẫn hiện ba câu hỏi nhanh', async () => {
    mocks.fetchOrders.mockRejectedValue(new Error('x'));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Đổi trả hàng' })).toBeInTheDocument();
  });

  it('chat tắt mà còn lịch sử: vẫn đọc được tin, đánh dấu đã đọc đúng tin STAFF hiện ra, không có ô nhập, liên hệ thay chỗ ô nhập', async () => {
    mocks.getThread.mockResolvedValue(
      thread({ enabled: false, messages: [msg({ id: 's1', sender: 'STAFF', body: 'Đơn đã giao nhé' }), msg({ id: 'c1', sender: 'CUSTOMER', body: 'Cảm ơn' })] }),
    );
    mocks.markRead.mockResolvedValue({});
    renderPage();
    expect(await screen.findByText('Đơn đã giao nhé')).toBeInTheDocument();
    expect(screen.getByText('Cảm ơn')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByTestId('msg-greeting')).toBeNull();
    expect(screen.getByText('Chat đang tạm đóng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gọi 0984 606 774' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith(['s1']));
  });

  it('chat tắt và chưa có tin nào: không gọi báo đã đọc', async () => {
    mocks.getThread.mockResolvedValue(thread({ enabled: false }));
    renderPage();
    expect(await screen.findByText('Chat đang tạm đóng')).toBeInTheDocument();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('nút ảnh chỉ có khi bản build có Cloudinary', async () => {
    renderPage();
    await screen.findByRole('textbox');
    expect(screen.queryByRole('button', { name: 'Đính kèm ảnh' })).toBeNull();
    qc.clear();
    mocks.cloudinary = true;
    renderPage();
    expect(await screen.findByRole('button', { name: 'Đính kèm ảnh' })).toBeInTheDocument();
  });

  it('ô nhập chặn ở 1.000 ký tự', async () => {
    renderPage();
    expect(await screen.findByRole('textbox')).toHaveAttribute('maxlength', '1000');
  });

  it('mở màn thì đánh dấu đã đọc rồi làm mới số chưa đọc', async () => {
    mocks.getThread.mockResolvedValue(thread({ messages: [msg({ id: 'm1', sender: 'STAFF' })] }));
    renderPage();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith(['m1']));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['support-chat-summary'] }));
  });

  it('hỏi tin mới mỗi 5 giây, ngừng khi mất focus và hỏi lại ngay khi quay lại', async () => {
    vi.useFakeTimers();
    try {
      renderPage();
      await advance(10);
      expect(mocks.getThread).toHaveBeenCalledTimes(1);
      await advance(5000);
      expect(mocks.getThread).toHaveBeenCalledTimes(2);
      act(() => focusManager.setFocused(false));
      await advance(15000);
      expect(mocks.getThread).toHaveBeenCalledTimes(2);
      act(() => focusManager.setFocused(true));
      await advance(10);
      expect(mocks.getThread).toHaveBeenCalledTimes(3);
      await advance(5000);
      expect(mocks.getThread).toHaveBeenCalledTimes(4);
    } finally {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });

  it('vẫn hỏi tin mới khi chat tắt hoặc bị chặn (nhân viên có thể trả lời tin cũ)', async () => {
    vi.useFakeTimers();
    try {
      mocks.getThread.mockResolvedValue(thread({ blocked: true }));
      renderPage();
      await advance(10);
      await advance(5000);
      expect(mocks.getThread).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('chọn ảnh (đang tải lên) rồi gửi chữ: chỉ tin đầu tiên được gửi mang context', async () => {
    mocks.search = '?order=TT12345';
    mocks.cloudinary = true;
    let finishUpload!: (url: string) => void;
    mocks.upload.mockReturnValue(new Promise((r) => (finishUpload = r)));
    mocks.send.mockImplementation(async (input: { clientMsgId: string }) => msg({ id: `s-${input.clientMsgId}`, clientMsgId: input.clientMsgId }));
    const { container } = renderPage();
    await screen.findByRole('textbox');
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } });
    typeAndSend('Chữ gửi lúc đang tải ảnh');
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    finishUpload('https://img.example/a.jpg');
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[0]![0].context).toEqual({ orderCode: 'TT12345' });
    expect(mocks.send.mock.calls[1]![0].imageUrl).toBe('https://img.example/a.jpg');
    expect(mocks.send.mock.calls[1]![0].context).toBeUndefined();
  });

  it('rời màn khi ảnh còn đang tải lên: tải xong cũng không gửi tin', async () => {
    mocks.cloudinary = true;
    let finishUpload!: (url: string) => void;
    mocks.upload.mockReturnValue(new Promise((r) => (finishUpload = r)));
    const { container, unmount } = renderPage();
    await screen.findByRole('textbox');
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => finishUpload('https://img.example/a.jpg'));
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('ảnh tải xong khi router đã sang trang khác (trang cũ còn mount lúc hiệu ứng thoát): không gửi tin', async () => {
    mocks.cloudinary = true;
    let finishUpload!: (url: string) => void;
    mocks.upload.mockReturnValue(new Promise((r) => (finishUpload = r)));
    const live = { current: '/chat' };
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <LivePathnameContext.Provider value={live}>
          <SupportChatPage />
        </LivePathnameContext.Provider>
      </QueryClientProvider>,
    );
    await screen.findByRole('textbox');
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    live.current = '/orders';
    await act(async () => finishUpload('https://img.example/a.jpg'));
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('ảnh quá 20MB: báo lỗi, không tải lên', async () => {
    mocks.cloudinary = true;
    const { container } = renderPage();
    await screen.findByRole('textbox');
    const big = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [big] } });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Ảnh quá lớn (tối đa 20MB). Hãy chọn ảnh khác nhé.', type: 'error' }));
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('429: hiện câu "thao tác hơi nhanh" và vẫn cho "Gửi lại"', async () => {
    mocks.send.mockRejectedValue(httpError(429, 'ThrottlerException: Too Many Requests'));
    renderPage();
    await screen.findByRole('textbox');
    typeAndSend('Xin chào');
    expect(await screen.findByText('Bạn thao tác hơi nhanh, đợi vài giây rồi thử lại nhé.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi lại' })).toBeInTheDocument();
  });

  it('429 CHAT_DAILY_LIMIT: hiện câu của máy chủ, không có "Gửi lại"', async () => {
    const m = 'Bạn đã gửi quá nhiều tin hôm nay. Cần hỗ trợ, gọi hotline.';
    mocks.send.mockRejectedValue(Object.assign(new Error(m), { isHttpError: true, response: { status: 429, data: { code: 'CHAT_DAILY_LIMIT', message: m } } }));
    renderPage();
    await screen.findByRole('textbox');
    typeAndSend('Xin chào');
    expect(await screen.findByText(m)).toBeInTheDocument();
    expect(screen.queryByText(/thao tác hơi nhanh/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gửi lại' })).toBeNull();
  });

  it('401/403 thô của Nest không lộ ra: khi gửi và khi tải hội thoại', async () => {
    mocks.send.mockRejectedValue(httpError(403, 'Forbidden'));
    renderPage();
    await screen.findByRole('textbox');
    typeAndSend('Xin chào');
    expect(await screen.findByText(/Phiên đăng nhập đã hết hạn/)).toBeInTheDocument();
    expect(screen.queryByText('Forbidden')).toBeNull();
  });

  it('tải hội thoại báo 401 "Unauthorized": hiện câu phiên hết hạn', async () => {
    mocks.getThread.mockRejectedValue(httpError(401, 'Unauthorized'));
    renderPage();
    expect(await screen.findByText(/Phiên đăng nhập đã hết hạn/)).toBeInTheDocument();
    expect(screen.queryByText('Unauthorized')).toBeNull();
  });

  it('400: báo lỗi của máy chủ, không có "Gửi lại"', async () => {
    mocks.send.mockRejectedValue(httpError(400, 'Tin nhắn trống'));
    renderPage();
    await screen.findByRole('textbox');
    typeAndSend('Xin chào');
    expect(await screen.findByText('Tin nhắn trống')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gửi lại' })).toBeNull();
  });

  it('lỗi 5xx: "Gửi lại"', async () => {
    mocks.send.mockRejectedValue(httpError(503, 'down'));
    renderPage();
    await screen.findByRole('textbox');
    typeAndSend('Xin chào');
    expect(await screen.findByRole('button', { name: 'Gửi lại' })).toBeInTheDocument();
  });

  describe('đánh dấu đã đọc', () => {
    const setVisibility = (v: 'visible' | 'hidden') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    afterEach(() => setVisibility('visible'));

    it('chưa có tin nào thì chưa gọi', async () => {
      renderPage();
      await screen.findByRole('textbox');
      expect(mocks.markRead).not.toHaveBeenCalled();
    });

    const m = (id: string, sender: string, at: number) => msg({ id, sender, createdAt: `2026-10-23T03:${String(at).padStart(2, '0')}:00.000Z` });
    const refetchThread = () => act(async () => { await qc.invalidateQueries({ queryKey: ['support-chat'] }); });

    it('báo đúng id các tin STAFF/SYSTEM đã hiển thị (không gồm tin của khách)', async () => {
      mocks.getThread.mockResolvedValue(thread({ messages: [m('m1', 'STAFF', 1), m('m2', 'CUSTOMER', 2), m('m3', 'SYSTEM', 3)] }));
      renderPage();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
      expect(mocks.markRead).toHaveBeenCalledWith(['m1', 'm3']);
    });

    it('trả lời commit muộn nằm TRƯỚC tin cuối (lastId không đổi): vẫn báo id của nó', async () => {
      mocks.getThread.mockResolvedValueOnce(thread({ messages: [m('m1', 'STAFF', 1), m('m9', 'CUSTOMER', 9)] }));
      renderPage();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith(['m1']));
      mocks.getThread.mockResolvedValue(thread({ messages: [m('m1', 'STAFF', 1), m('m5', 'STAFF', 5), m('m9', 'CUSTOMER', 9)] }));
      await refetchThread();
      await waitFor(() => expect(mocks.markRead).toHaveBeenLastCalledWith(['m5']));
      expect(mocks.markRead).toHaveBeenCalledTimes(2);
    });

    it('tập tin hiển thị không đổi: không gọi lại', async () => {
      mocks.getThread.mockResolvedValue(thread({ messages: [m('m1', 'STAFF', 1)] }));
      renderPage();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
      await refetchThread();
      await refetchThread();
      expect(mocks.markRead).toHaveBeenCalledTimes(1);
    });

    it('gọi thất bại thì không coi là đã báo: id cũ được gửi lại (không bị coi là đã báo)', async () => {
      mocks.markRead.mockRejectedValueOnce(new Error('mạng'));
      mocks.getThread.mockResolvedValueOnce(thread({ messages: [m('m1', 'STAFF', 1)] }));
      renderPage();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      mocks.getThread.mockResolvedValue(thread({ messages: [m('m1', 'STAFF', 1), m('m2', 'STAFF', 2)] }));
      await refetchThread();
      await waitFor(() => expect(mocks.markRead.mock.calls.flatMap((c) => c[0] as string[])).toContain('m2'));
      expect(mocks.markRead.mock.calls.flatMap((c) => c[0] as string[]).filter((id) => id === 'm1').length).toBeGreaterThanOrEqual(2);
    });

    it('tin cũ tải bằng "Xem tin cũ hơn" cũng được báo', async () => {
      mocks.getThread.mockResolvedValue(thread({ hasMore: true, messages: [m('m5', 'STAFF', 5)] }));
      mocks.getPage.mockResolvedValue({ hasMore: false, messages: [m('m3', 'STAFF', 3)] });
      renderPage();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith(['m5']));
      fireEvent.click(await screen.findByRole('button', { name: 'Xem tin cũ hơn' }));
      await waitFor(() => expect(mocks.markRead).toHaveBeenLastCalledWith(['m3']));
    });

    it('báo lỗi một lần rồi thread tải lại với dữ liệu y hệt: gửi lại đúng các id đó; thành công rồi thì không gửi nữa', async () => {
      mocks.markRead.mockRejectedValueOnce(new Error('mạng'));
      mocks.getThread.mockResolvedValue(thread({ messages: [m('m1', 'STAFF', 1)] }));
      renderPage();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      await refetchThread();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(2));
      expect(mocks.markRead).toHaveBeenLastCalledWith(['m1']);
      await refetchThread();
      await refetchThread();
      expect(mocks.markRead).toHaveBeenCalledTimes(2);
    });

    it('quá 100 id thì tách thành nhiều lần gọi', async () => {
      const many = Array.from({ length: 150 }, (_, i) => m(`s${String(i).padStart(3, '0')}`, 'STAFF', 1 + (i % 50)));
      mocks.getThread.mockResolvedValue(thread({ messages: many }));
      renderPage();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(2));
      expect(mocks.markRead.mock.calls.map((c) => (c[0] as string[]).length).sort((a, b) => a - b)).toEqual([50, 100]);
    });

    it('đang ẩn thì không gọi; hiện lại thì gọi', async () => {
      setVisibility('hidden');
      mocks.getThread.mockResolvedValue(thread({ messages: [msg({ id: 'm1', sender: 'STAFF' })] }));
      renderPage();
      await screen.findByTestId('msg-m1');
      expect(mocks.markRead).not.toHaveBeenCalled();
      setVisibility('visible');
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
    });
  });

  describe('tin cũ hơn', () => {
    it('hasMore: có nút "Xem tin cũ hơn", bấm thì tin cũ chèn lên đầu theo id cũ nhất', async () => {
      mocks.getThread.mockResolvedValue(thread({ hasMore: true, messages: [msg({ id: 'm5', body: 'mới' })] }));
      mocks.getPage.mockResolvedValue({ hasMore: false, messages: [msg({ id: 'm3', body: 'cũ' })] });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Xem tin cũ hơn' }));
      await screen.findByTestId('msg-m3');
      expect(mocks.getPage).toHaveBeenCalledWith({ before: 'm5' });
      expect(msgIds()).toEqual(['msg-m3', 'msg-m5']);
      expect(screen.queryByRole('button', { name: 'Xem tin cũ hơn' })).toBeNull();
    });

    it('poll làm cửa sổ trượt đi: tin đã tải vẫn còn đủ, đúng thứ tự, không trùng; tin cập nhật thì lấy bản mới (ghi đè theo id)', async () => {
      const m = (n: number, over: Record<string, unknown> = {}) =>
        msg({ id: `m${String(n).padStart(2, '0')}`, body: `tin ${n}`, createdAt: `2026-10-23T03:${String(n).padStart(2, '0')}:00.000Z`, ...over });
      const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => m(a + i));
      mocks.getThread.mockResolvedValueOnce(thread({ hasMore: true, messages: range(11, 60) }));
      mocks.getPage.mockResolvedValue({ hasMore: false, messages: range(1, 10) });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Xem tin cũ hơn' }));
      await screen.findByTestId('msg-m01');
      expect(mocks.getPage).toHaveBeenCalledWith({ before: 'm11' });
      mocks.getThread.mockResolvedValue(thread({ hasMore: true, messages: [...range(12, 60).map((x) => (x.id === 'm12' ? m(12, { body: 'tin 12 đã sửa' }) : x)), m(61)] }));
      await act(async () => {
        await qc.invalidateQueries({ queryKey: ['support-chat'] });
      });
      await screen.findByTestId('msg-m61');
      const ids = msgIds();
      expect(ids).toEqual(range(1, 61).map((x) => `msg-${x.id}`));
      expect(within(screen.getByTestId('msg-m12')).getByText('tin 12 đã sửa')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Xem tin cũ hơn' })).toBeNull();
    });

    it('tin bị thu hồi (không còn trong cửa sổ poll) biến mất; tin chỉ có ở trang cũ thì giữ', async () => {
      const m = (n: number) => msg({ id: `m${n}`, body: `tin ${n}`, createdAt: `2026-10-23T03:0${n}:00.000Z` });
      mocks.getThread.mockResolvedValueOnce(thread({ hasMore: true, messages: [m(3), m(4), m(5), m(6)] }));
      mocks.getPage.mockResolvedValue({ hasMore: false, messages: [m(1), m(2)] });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Xem tin cũ hơn' }));
      await screen.findByTestId('msg-m1');
      mocks.getThread.mockResolvedValue(thread({ hasMore: true, messages: [m(3), m(5), m(6)] }));
      await act(async () => {
        await qc.invalidateQueries({ queryKey: ['support-chat'] });
      });
      await waitFor(() => expect(screen.queryByTestId('msg-m4')).toBeNull());
      expect(msgIds()).toEqual(['msg-m1', 'msg-m2', 'msg-m3', 'msg-m5', 'msg-m6']);
    });

    it('hasMore=false: tin thu hồi nằm trước tin đầu cửa sổ cũng biến mất', async () => {
      const m = (n: number) => msg({ id: `m${n}`, body: `tin ${n}`, createdAt: `2026-10-23T03:0${n}:00.000Z` });
      mocks.getThread.mockResolvedValueOnce(thread({ hasMore: false, messages: [m(1), m(2), m(3)] }));
      renderPage();
      await screen.findByTestId('msg-m1');
      mocks.getThread.mockResolvedValue(thread({ hasMore: false, messages: [m(2), m(3)] }));
      await act(async () => {
        await qc.invalidateQueries({ queryKey: ['support-chat'] });
      });
      await waitFor(() => expect(screen.queryByTestId('msg-m1')).toBeNull());
      expect(msgIds()).toEqual(['msg-m2', 'msg-m3']);
    });

    it('cửa sổ rỗng và hết tin: xoá hết tin đã thấy', async () => {
      mocks.getThread.mockResolvedValueOnce(thread({ messages: [msg({ id: 'm1', sender: 'STAFF' })] }));
      renderPage();
      await screen.findByTestId('msg-m1');
      mocks.getThread.mockResolvedValue(thread({ messages: [] }));
      await act(async () => {
        await qc.invalidateQueries({ queryKey: ['support-chat'] });
      });
      await waitFor(() => expect(screen.queryByTestId('msg-m1')).toBeNull());
    });

    it('hasMore=false: không có nút', async () => {
      mocks.getThread.mockResolvedValue(thread({ messages: [msg({ id: 'm1' })] }));
      renderPage();
      await screen.findByTestId('msg-m1');
      expect(screen.queryByRole('button', { name: 'Xem tin cũ hơn' })).toBeNull();
    });
  });
});
