import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  markSupportChatRead: mocks.markRead,
}));
vi.mock('../store/auth', () => {
  const state = () => ({ status: mocks.authStatus, login: mocks.login, restore: vi.fn() });
  return { useAuthStore: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: state }) };
});
vi.mock('../components/image-upload', () => ({
  isCloudinaryConfigured: () => mocks.cloudinary,
  uploadToCloudinary: vi.fn(),
}));
vi.mock('./about-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSupportContact: mocks.fetchContact,
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import SupportChatPage, { chatRefetchInterval } from './support-chat';

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
    mocks.fetchContact.mockResolvedValue({ hotline: '0984 606 774', email: null, zaloOaName: null });
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
    const order = screen.getAllByTestId(/^msg-/).map((e) => e.getAttribute('data-testid'));
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

  it('enabled=false: ẩn ô nhập, hiện câu CHAT_DISABLED', async () => {
    mocks.getThread.mockResolvedValue(thread({ enabled: false }));
    renderPage();
    expect(await screen.findByText('Chat với Tubu Tree đang tạm đóng. Cần hỗ trợ, gọi hotline.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
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
    renderPage();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalled());
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['support-chat-summary'] }));
  });

  it('hỏi tin mới mỗi 5 giây khi màn đang hiện, dừng khi ẩn', async () => {
    renderPage();
    await screen.findByRole('textbox');
    const interval = (qc.getQueryCache().find({ queryKey: ['support-chat'] })!.options as { refetchInterval?: unknown }).refetchInterval;
    expect(interval).toBe(chatRefetchInterval);
    const vis = vi.spyOn(document, 'visibilityState', 'get');
    vis.mockReturnValue('visible');
    expect(chatRefetchInterval()).toBe(5000);
    vis.mockReturnValue('hidden');
    expect(chatRefetchInterval()).toBe(false);
  });
});
