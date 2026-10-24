// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, focusManager, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { flush } from '@/test-utils/dom';

// Cùng các ca với support-chat.spec.tsx của Mini App: thứ tự tin, gửi và gửi lại, context đơn/sản phẩm, chậm/chặn/tắt,
// ảnh, đã đọc, hỏi tin mới mỗi 5 giây, xem tin cũ hơn và thu hồi. Thêm ca khách chưa đăng nhập của web.

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading' | 'unavailable',
  search: '',
  cloudinary: false,
  getThread: vi.fn(),
  getPage: vi.fn(),
  summary: vi.fn(),
  send: vi.fn(),
  markRead: vi.fn(),
  contact: vi.fn(),
  product: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: (path: string, opts?: { query?: Record<string, string> }) => {
      if (path === '/me/support-chat') return mocks.getThread();
      if (path === '/me/support-chat/messages') return mocks.getPage(opts?.query);
      if (path === '/me/support-chat/summary') return mocks.summary();
      if (path === '/config/public') return mocks.contact();
      if (path.startsWith('/products/')) return mocks.product(path);
      return Promise.reject(new Error(`chưa mock ${path}`));
    },
    post: (path: string, body?: unknown) => (path === '/me/support-chat/read' ? mocks.markRead(body) : mocks.send(body)),
  },
}));
vi.mock('@/components/account/cloudinary-upload', () => ({
  isCloudinaryConfigured: () => mocks.cloudinary,
  uploadToCloudinary: mocks.upload,
  MAX_IMAGE_BYTES: 20 * 1024 * 1024,
}));

import SupportChatPage from './page';

const msg = (over: Record<string, unknown>) => ({
  id: 'm', sender: 'CUSTOMER', body: 'x', imageUrl: null, context: null, clientMsgId: null, createdAt: '2026-10-23T03:04:00.000Z', ...over,
});
const thread = (over: Record<string, unknown> = {}) => ({
  code: 'K7Q3', blocked: false, enabled: true, slow: false, hasMore: false, messages: [], ...over,
});
const statusError = (status: number, message: string, code: string | null = null) => Object.assign(new Error(message), { status, code });

let qc: QueryClient;
let unmounts: (() => void)[] = [];
function mount(el: ReactElement = <SupportChatPage />) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  qc = createQueryClient();
  act(() => {
    root.render(<QueryClientProvider client={qc}>{el}</QueryClientProvider>);
  });
  unmounts.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const textbox = (c: HTMLElement) => c.querySelector('textarea') as HTMLTextAreaElement | null;
const buttonByName = (c: HTMLElement, name: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === name) ?? null;
const click = (el: Element | null) => {
  if (!el) throw new Error('không thấy phần tử để bấm');
  act(() => (el as HTMLElement).click());
};
const typeText = (c: HTMLElement, text: string) => {
  const t = textbox(c)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(t, text);
    t.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const typeAndSend = (c: HTMLElement, text: string) => {
  typeText(c, text);
  click(buttonByName(c, 'Gửi'));
};
const msgIds = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-testid^="msg-"]')).map((e) => e.getAttribute('data-testid'));
const bubble = (c: HTMLElement, key: string) => c.querySelector(`[data-testid="msg-${key}"]`) as HTMLElement | null;
// Chờ trong act, mỗi vòng nhả một nhịp trước khi kiểm: promise của lệnh gửi vừa bấm xong phải chạy trong act chứ không rơi ra ngoài.
const waitFor = async (check: () => void, tries = 40) => {
  let err: unknown;
  for (let i = 0; i < tries; i++) {
    await flush(1);
    try {
      check();
      return;
    } catch (e) {
      err = e;
    }
  }
  throw err;
};
const pickFile = (c: HTMLElement, file: File) => {
  const input = c.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.phase = 'authenticated';
  mocks.search = '';
  mocks.cloudinary = false;
  mocks.contact.mockResolvedValue({ support: { hotline: '0984 606 774', email: null, zaloOaName: null } });
  mocks.getThread.mockResolvedValue(thread());
  mocks.markRead.mockResolvedValue({ ok: true });
  mocks.summary.mockResolvedValue({ unreadCount: 0 });
  mocks.product.mockRejectedValue(new Error('404'));
  let n = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `cid-${++n}` as `${string}-${string}-${string}-${string}-${string}`);
});
afterEach(() => {
  unmounts.forEach((u) => u());
  unmounts = [];
  vi.restoreAllMocks();
});

describe('/ho-tro/chat — Chat với Tubu Tree', () => {
  it('khách chưa đăng nhập: mời đăng nhập và quay lại đúng trang, không gọi API chat', async () => {
    mocks.phase = 'guest';
    const c = mount();
    await flush(3);
    expect(c.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fho-tro%2Fchat');
    expect(textbox(c)).toBeNull();
    expect(mocks.getThread).not.toHaveBeenCalled();
  });

  it('đang khôi phục phiên: hiện đang tải, không gọi API; phiên chập chờn: nói mất kết nối, không mời đăng nhập', async () => {
    mocks.phase = 'loading';
    const loading = mount();
    await flush(2);
    expect(loading.textContent).toContain('Đang tải');
    mocks.phase = 'unavailable';
    const down = mount();
    await flush(2);
    expect(down.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(down.querySelector('a[href^="/dang-nhap"]')).toBeNull();
    expect(mocks.getThread).not.toHaveBeenCalled();
  });

  it('khách chưa đăng nhập vào từ đơn hoặc sản phẩm: đăng nhập xong quay lại đúng chat đó', async () => {
    mocks.phase = 'guest';
    mocks.search = 'order=TT12345';
    const order = mount();
    await flush(3);
    expect(order.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fho-tro%2Fchat%3Forder%3DTT12345');
    mocks.search = 'product=xa-bong';
    const product = mount();
    await flush(3);
    expect(product.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fho-tro%2Fchat%3Fproduct%3Dxa-bong');
  });

  it('có đúng một h1 "Chat với Tubu Tree"', async () => {
    const c = mount();
    await flush(3);
    expect(Array.from(c.querySelectorAll('h1')).map((h) => h.textContent)).toEqual(['Chat với Tubu Tree']);
  });

  it('tin hiện cũ → mới; khách bên phải, Tubu Tree bên trái kèm tên, tin hệ thống ở giữa không có tên', async () => {
    mocks.getThread.mockResolvedValue(
      thread({
        messages: [
          msg({ id: 'm3', sender: 'SYSTEM', body: 'Tubu Tree trả lời từ 8:00 đến 21:00. Tin của bạn đã được ghi lại.', createdAt: '2026-10-23T03:06:00.000Z' }),
          msg({ id: 'm1', body: 'Cho mình hỏi', createdAt: '2026-10-23T03:04:00.000Z' }),
          msg({ id: 'm2', sender: 'STAFF', body: 'Dạ chào bạn', createdAt: '2026-10-23T03:05:00.000Z' }),
        ],
      }),
    );
    const c = mount();
    await flush(4);
    const mine = bubble(c, 'm1')!;
    const staff = bubble(c, 'm2')!;
    const system = bubble(c, 'm3')!;
    expect(mine.getAttribute('data-sender')).toBe('CUSTOMER');
    expect(staff.getAttribute('data-sender')).toBe('STAFF');
    expect(system.getAttribute('data-sender')).toBe('SYSTEM');
    expect(staff.textContent).toContain('Tubu Tree');
    expect(mine.textContent).not.toContain('Tubu Tree');
    expect(system.textContent).toBe('Tubu Tree trả lời từ 8:00 đến 21:00. Tin của bạn đã được ghi lại.');
    expect(system.querySelectorAll('span')).toHaveLength(1);
    expect(msgIds(c)).toEqual(['msg-m1', 'msg-m2', 'msg-m3']);
  });

  it('gửi: hiện ngay "Đang gửi", API trả về thì "Đã gửi" và làm mới hội thoại', async () => {
    let resolve!: (v: unknown) => void;
    mocks.send.mockReturnValue(new Promise((r) => (resolve = r)));
    const c = mount();
    await flush(3);
    typeAndSend(c, 'Xin chào');
    await flush(1);
    const b = bubble(c, 'cid-1')!;
    expect(b.textContent).toContain('Xin chào');
    expect(b.textContent).toContain('Đang gửi');
    expect(textbox(c)!.value).toBe('');
    expect(mocks.send.mock.calls[0]![0].source).toBe('WEB');
    const calls = mocks.getThread.mock.calls.length;
    resolve(msg({ id: 'srv1', body: 'Xin chào', clientMsgId: 'cid-1' }));
    await waitFor(() => expect(bubble(c, 'cid-1')!.textContent).toContain('Đã gửi'));
    await waitFor(() => expect(mocks.getThread.mock.calls.length).toBeGreaterThan(calls));
  });

  it('lỗi mạng: hiện "Gửi lại", bấm lại dùng đúng clientMsgId cũ', async () => {
    mocks.send.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(msg({ id: 'srv1', clientMsgId: 'cid-1' }));
    const c = mount();
    await flush(3);
    typeAndSend(c, 'Xin chào');
    await waitFor(() => expect(buttonByName(c, 'Gửi lại')).not.toBeNull());
    click(buttonByName(c, 'Gửi lại'));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[0]![0].clientMsgId).toBe('cid-1');
    expect(mocks.send.mock.calls[1]![0].clientMsgId).toBe('cid-1');
    expect(mocks.send.mock.calls[1]![0].body).toBe('Xin chào');
    await waitFor(() => expect(bubble(c, 'cid-1')!.textContent).toContain('Đã gửi'));
  });

  it('409/403: hiện câu của máy chủ, không có nút "Gửi lại"', async () => {
    const m = 'Bạn tạm thời không gửi được tin. Cần hỗ trợ, gọi hotline.';
    mocks.send.mockRejectedValue(statusError(403, m));
    const c = mount();
    await flush(3);
    typeAndSend(c, 'Xin chào');
    await waitFor(() => expect(c.textContent).toContain(m));
    expect(buttonByName(c, 'Gửi lại')).toBeNull();
  });

  it('409 CHAT_DISABLED khi gửi: hiện câu của máy chủ, không có "Gửi lại"', async () => {
    const m = 'Chat với Tubu Tree đang tạm đóng. Cần hỗ trợ, gọi hotline.';
    mocks.send.mockRejectedValue(statusError(409, m));
    const c = mount();
    await flush(3);
    typeAndSend(c, 'Xin chào');
    await waitFor(() => expect(bubble(c, 'cid-1')!.textContent).toContain(m));
    expect(buttonByName(c, 'Gửi lại')).toBeNull();
  });

  it('429: hiện câu "thao tác hơi nhanh" và vẫn cho "Gửi lại"', async () => {
    mocks.send.mockRejectedValue(statusError(429, 'ThrottlerException: Too Many Requests'));
    const c = mount();
    await flush(3);
    typeAndSend(c, 'Xin chào');
    await waitFor(() => expect(c.textContent).toContain('Bạn thao tác hơi nhanh, đợi vài giây rồi thử lại nhé.'));
    expect(c.textContent).not.toContain('Throttler');
    expect(buttonByName(c, 'Gửi lại')).not.toBeNull();
  });

  it('429 CHAT_DAILY_LIMIT: hiện câu của máy chủ, không có "Gửi lại"', async () => {
    const m = 'Bạn đã gửi quá nhiều tin hôm nay. Cần hỗ trợ, gọi hotline.';
    mocks.send.mockRejectedValue(statusError(429, m, 'CHAT_DAILY_LIMIT'));
    const c = mount();
    await flush(3);
    typeAndSend(c, 'Xin chào');
    await waitFor(() => expect(c.textContent).toContain(m));
    expect(c.textContent).not.toContain('thao tác hơi nhanh');
    expect(buttonByName(c, 'Gửi lại')).toBeNull();
  });

  it('401/403 thô của Nest ("Unauthorized"/"Forbidden") không lộ ra: khi gửi và khi tải hội thoại', async () => {
    mocks.send.mockRejectedValue(statusError(403, 'Forbidden'));
    const c = mount();
    await flush(3);
    typeAndSend(c, 'Xin chào');
    await waitFor(() => expect(c.textContent).toContain('Tài khoản này không có quyền xem nội dung này.'));
    expect(c.textContent).not.toContain('Forbidden');

    mocks.getThread.mockRejectedValue(statusError(401, 'Unauthorized'));
    const down = mount();
    // QueryClient của web thử lại một lần sau 1 giây trước khi báo lỗi.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1300));
    });
    await waitFor(() => expect(down.textContent).toContain('Phiên đăng nhập đã hết hạn'));
    expect(down.textContent).not.toContain('Unauthorized');
  });

  it('400: báo lỗi của máy chủ, không có "Gửi lại"', async () => {
    mocks.send.mockRejectedValue(statusError(400, 'Tin nhắn trống'));
    const c = mount();
    await flush(3);
    typeAndSend(c, 'Xin chào');
    await waitFor(() => expect(c.textContent).toContain('Tin nhắn trống'));
    expect(buttonByName(c, 'Gửi lại')).toBeNull();
  });

  it('lỗi 5xx: "Gửi lại"', async () => {
    mocks.send.mockRejectedValue(statusError(503, 'down'));
    const c = mount();
    await flush(3);
    typeAndSend(c, 'Xin chào');
    await waitFor(() => expect(buttonByName(c, 'Gửi lại')).not.toBeNull());
  });

  it('?order=TT12345: thẻ "Về đơn TT12345"; tin đầu kèm context, tin sau thì không', async () => {
    mocks.search = 'order=TT12345';
    mocks.send.mockImplementation(async (input: { clientMsgId: string }) => msg({ id: `s-${input.clientMsgId}`, clientMsgId: input.clientMsgId }));
    const c = mount();
    await waitFor(() => expect(c.textContent).toContain('Về đơn TT12345'));
    typeAndSend(c, 'Một');
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send.mock.calls[0]![0].context).toEqual({ orderCode: 'TT12345' });
    await waitFor(() => expect(c.textContent).not.toContain('Về đơn TT12345'));
    typeAndSend(c, 'Hai');
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[1]![0].context).toBeUndefined();
  });

  it('gửi lại sau lỗi mạng giữ context ban đầu của tin đó', async () => {
    mocks.search = 'order=TT12345';
    mocks.send.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(msg({ id: 'srv1', clientMsgId: 'cid-1' }));
    const c = mount();
    await waitFor(() => expect(c.textContent).toContain('Về đơn TT12345'));
    typeAndSend(c, 'Một');
    await waitFor(() => expect(buttonByName(c, 'Gửi lại')).not.toBeNull());
    click(buttonByName(c, 'Gửi lại'));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[1]![0].context).toEqual({ orderCode: 'TT12345' });
  });

  it('?product=<slug>: thẻ "Về sản phẩm <tên>" khi đọc được tên, không thì dùng slug; tin đầu kèm productSlug', async () => {
    mocks.search = 'product=xa-bong-thao-moc';
    mocks.send.mockResolvedValue(msg({ id: 's1', clientMsgId: 'cid-1' }));
    const c = mount();
    await waitFor(() => expect(c.textContent).toContain('Về sản phẩm xa-bong-thao-moc'));
    typeAndSend(c, 'Còn hàng không');
    await waitFor(() => expect(mocks.send).toHaveBeenCalled());
    expect(mocks.send.mock.calls[0]![0].context).toEqual({ productSlug: 'xa-bong-thao-moc' });

    mocks.product.mockResolvedValue({ name: 'Xà bông thảo mộc' });
    const named = mount();
    await waitFor(() => expect(named.textContent).toContain('Về sản phẩm Xà bông thảo mộc'));
  });

  it('slug bắt đầu bằng gạch nối vẫn được tra tên sản phẩm, không hiện nguyên chuỗi', async () => {
    mocks.search = 'product=-abc123';
    mocks.product.mockResolvedValue({ name: 'Nước rửa chén' });
    const c = mount();
    await waitFor(() => expect(c.textContent).toContain('Về sản phẩm Nước rửa chén'));
    expect(mocks.product).toHaveBeenCalledWith('/products/-abc123');
  });

  it('slug lạ như ../auth/me: không gọi API sản phẩm, thẻ dùng nguyên chuỗi đó', async () => {
    mocks.search = `product=${encodeURIComponent('../auth/me')}`;
    const c = mount();
    await waitFor(() => expect(c.textContent).toContain('Về sản phẩm ../auth/me'));
    expect(mocks.product).not.toHaveBeenCalled();
  });

  it('slow: dòng báo chậm kèm hotline', async () => {
    mocks.getThread.mockResolvedValue(thread({ slow: true }));
    const c = mount();
    await waitFor(() => expect(c.textContent).toContain('Nhân viên có thể trả lời chậm. Cần gấp, gọi hotline 0984 606 774'));
  });

  it('blocked: ẩn ô nhập, hiện câu của hợp đồng', async () => {
    mocks.getThread.mockResolvedValue(thread({ blocked: true }));
    const c = mount();
    await waitFor(() => expect(c.textContent).toContain('Bạn tạm thời không gửi được tin. Cần hỗ trợ, gọi hotline.'));
    expect(textbox(c)).toBeNull();
  });

  it('enabled=false: ẩn ô nhập, hiện câu CHAT_DISABLED', async () => {
    mocks.getThread.mockResolvedValue(thread({ enabled: false }));
    const c = mount();
    await waitFor(() => expect(c.textContent).toContain('Chat với Tubu Tree đang tạm đóng. Cần hỗ trợ, gọi hotline.'));
    expect(textbox(c)).toBeNull();
  });

  it('nút ảnh chỉ có khi bản build có Cloudinary', async () => {
    const without = mount();
    await flush(3);
    expect(textbox(without)).not.toBeNull();
    expect(buttonByName(without, 'Đính kèm ảnh')).toBeNull();
    mocks.cloudinary = true;
    const withCloud = mount();
    await waitFor(() => expect(buttonByName(withCloud, 'Đính kèm ảnh')).not.toBeNull());
  });

  it('ô nhập chặn ở 1.000 ký tự', async () => {
    const c = mount();
    await flush(3);
    expect(textbox(c)!.getAttribute('maxlength')).toBe('1000');
  });

  it('chọn ảnh (đang tải lên) rồi gửi chữ: chỉ tin đầu tiên được gửi mang context', async () => {
    mocks.search = 'order=TT12345';
    mocks.cloudinary = true;
    let finishUpload!: (url: string) => void;
    mocks.upload.mockReturnValue(new Promise((r) => (finishUpload = r)));
    mocks.send.mockImplementation(async (input: { clientMsgId: string }) => msg({ id: `s-${input.clientMsgId}`, clientMsgId: input.clientMsgId }));
    const c = mount();
    await waitFor(() => expect(textbox(c)).not.toBeNull());
    pickFile(c, new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    typeAndSend(c, 'Chữ gửi lúc đang tải ảnh');
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await act(async () => finishUpload('https://img.example/a.jpg'));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[0]![0].context).toEqual({ orderCode: 'TT12345' });
    expect(mocks.send.mock.calls[1]![0].imageUrl).toBe('https://img.example/a.jpg');
    expect(mocks.send.mock.calls[1]![0].context).toBeUndefined();
  });

  it('rời màn khi ảnh còn đang tải lên: tải xong cũng không gửi tin', async () => {
    mocks.cloudinary = true;
    let finishUpload!: (url: string) => void;
    mocks.upload.mockReturnValue(new Promise((r) => (finishUpload = r)));
    const c = mount();
    await waitFor(() => expect(textbox(c)).not.toBeNull());
    pickFile(c, new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    unmounts[unmounts.length - 1]!();
    await act(async () => finishUpload('https://img.example/a.jpg'));
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('ảnh quá 20MB: báo lỗi, không tải lên', async () => {
    mocks.cloudinary = true;
    const c = mount();
    await waitFor(() => expect(textbox(c)).not.toBeNull());
    const big = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    pickFile(c, big);
    await waitFor(() => expect(c.textContent).toContain('Ảnh quá lớn (tối đa 20MB). Hãy chọn ảnh khác nhé.'));
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('tải ảnh thất bại: báo lỗi, không gửi', async () => {
    mocks.cloudinary = true;
    mocks.upload.mockResolvedValue(null);
    const c = mount();
    await waitFor(() => expect(textbox(c)).not.toBeNull());
    pickFile(c, new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(c.textContent).toContain('Tải ảnh thất bại. Hãy chọn lại ảnh khác.'));
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('mở màn thì đánh dấu đã đọc rồi làm mới số chưa đọc', async () => {
    mocks.getThread.mockResolvedValue(thread({ messages: [msg({ id: 'm1', sender: 'STAFF' })] }));
    const c = mount();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith({ ids: ['m1'] }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['support-chat-summary'] }));
    expect(c.textContent).toContain('Tubu Tree');
  });

  describe('đánh dấu đã đọc theo hiển thị', () => {
    const setVisibility = (v: 'visible' | 'hidden') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    afterEach(() => setVisibility('visible'));

    it('chưa có tin nào thì chưa gọi', async () => {
      const c = mount();
      await flush(4);
      expect(textbox(c)).not.toBeNull();
      expect(mocks.markRead).not.toHaveBeenCalled();
    });

    const m = (id: string, sender: string, at: number) => msg({ id, sender, createdAt: `2026-10-23T03:${String(at).padStart(2, '0')}:00.000Z` });
    const refetchThread = () => act(async () => { await qc.invalidateQueries({ queryKey: ['support-chat'] }); });

    it('báo đúng id các tin STAFF/SYSTEM đã hiển thị (không gồm tin của khách)', async () => {
      mocks.getThread.mockResolvedValue(thread({ messages: [m('m1', 'STAFF', 1), m('m2', 'CUSTOMER', 2), m('m3', 'SYSTEM', 3)] }));
      mount();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
      expect(mocks.markRead).toHaveBeenCalledWith({ ids: ['m1', 'm3'] });
    });

    it('trả lời commit muộn nằm TRƯỚC tin cuối (lastId không đổi): vẫn báo id của nó', async () => {
      mocks.getThread.mockResolvedValueOnce(thread({ messages: [m('m1', 'STAFF', 1), m('m9', 'CUSTOMER', 9)] }));
      mount();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith({ ids: ['m1'] }));
      mocks.getThread.mockResolvedValue(thread({ messages: [m('m1', 'STAFF', 1), m('m5', 'STAFF', 5), m('m9', 'CUSTOMER', 9)] }));
      await refetchThread();
      await waitFor(() => expect(mocks.markRead).toHaveBeenLastCalledWith({ ids: ['m5'] }));
      expect(mocks.markRead).toHaveBeenCalledTimes(2);
    });

    it('tập tin hiển thị không đổi: không gọi lại', async () => {
      mocks.getThread.mockResolvedValue(thread({ messages: [m('m1', 'STAFF', 1)] }));
      mount();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
      await refetchThread();
      await refetchThread();
      expect(mocks.markRead).toHaveBeenCalledTimes(1);
    });

    it('gọi thất bại thì không coi là đã báo: id cũ được gửi lại (không bị coi là đã báo)', async () => {
      mocks.markRead.mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(new Error('mạng')), 30)));
      mocks.getThread.mockResolvedValueOnce(thread({ messages: [m('m1', 'STAFF', 1)] }));
      mount();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      mocks.getThread.mockResolvedValue(thread({ messages: [m('m1', 'STAFF', 1), m('m2', 'STAFF', 2)] }));
      await refetchThread();
      await waitFor(() => expect(mocks.markRead.mock.calls.flatMap((c) => (c[0] as { ids: string[] }).ids)).toContain('m2'));
      expect(mocks.markRead.mock.calls.flatMap((c) => (c[0] as { ids: string[] }).ids).filter((id) => id === 'm1').length).toBeGreaterThanOrEqual(2);
    });

    it('báo lỗi một lần rồi thread tải lại với dữ liệu y hệt: gửi lại đúng các id đó; thành công rồi thì không gửi nữa', async () => {
      mocks.markRead.mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(new Error('mạng')), 30)));
      mocks.getThread.mockResolvedValue(thread({ messages: [m('m1', 'STAFF', 1)] }));
      mount();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      await refetchThread();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(2));
      expect(mocks.markRead).toHaveBeenLastCalledWith({ ids: ['m1'] });
      await refetchThread();
      await refetchThread();
      expect(mocks.markRead).toHaveBeenCalledTimes(2);
    });

    it('quá 100 id thì tách thành nhiều lần gọi', async () => {
      const many = Array.from({ length: 150 }, (_, i) => m(`s${String(i).padStart(3, '0')}`, 'STAFF', 1 + (i % 50)));
      mocks.getThread.mockResolvedValue(thread({ messages: many }));
      mount();
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(2));
      expect(mocks.markRead.mock.calls.map((c) => (c[0] as { ids: string[] }).ids.length).sort((a, b) => a - b)).toEqual([50, 100]);
    });

    it('đang ẩn thì không gọi; hiện lại thì gọi', async () => {
      setVisibility('hidden');
      mocks.getThread.mockResolvedValue(thread({ messages: [msg({ id: 'm1', sender: 'STAFF' })] }));
      const c = mount();
      await waitFor(() => expect(bubble(c, 'm1')).not.toBeNull());
      expect(mocks.markRead).not.toHaveBeenCalled();
      setVisibility('visible');
      await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
    });
  });

  describe('khung tin ở màn rộng', () => {
    const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const intoView = vi.fn();
    beforeEach(() => {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 900 });
      Element.prototype.scrollIntoView = intoView;
      intoView.mockClear();
    });
    afterEach(() => {
      if (scrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeight);
      else delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      delete (window as { matchMedia?: unknown }).matchMedia;
    });
    const media = (matches: boolean) => {
      window.matchMedia = ((q: string) => ({ matches, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
    };

    it('từ md: cuộn chính khung tin xuống cuối, không cuộn cả trang; ô nhập nằm ngoài khung cuộn', async () => {
      media(true);
      mocks.getThread.mockResolvedValue(thread({ messages: [msg({ id: 'm1' })] }));
      const c = mount();
      await waitFor(() => expect(bubble(c, 'm1')).not.toBeNull());
      const pane = c.querySelector<HTMLElement>('[data-chat-pane]')!;
      expect(pane.scrollTop).toBe(900);
      expect(intoView).not.toHaveBeenCalled();
      expect(pane.contains(bubble(c, 'm1'))).toBe(true);
      expect(pane.contains(textbox(c))).toBe(false);
    });

    it('khổ điện thoại: vẫn cuộn trang tới tin cuối như Mini App', async () => {
      media(false);
      mocks.getThread.mockResolvedValue(thread({ messages: [msg({ id: 'm1' })] }));
      const c = mount();
      await waitFor(() => expect(bubble(c, 'm1')).not.toBeNull());
      expect(intoView).toHaveBeenCalled();
      expect(c.querySelector<HTMLElement>('[data-chat-pane]')!.scrollTop).toBe(0);
    });
  });

  describe('hỏi tin mới', () => {
    afterEach(() => {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    });

    it('mỗi 5 giây, ngừng khi mất focus và hỏi lại ngay khi quay lại (QueryClient thật của web tắt focus mặc định)', async () => {
      vi.useFakeTimers();
      mount();
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
    });

    it('vẫn hỏi khi chat tắt hoặc bị chặn (nhân viên có thể trả lời tin cũ)', async () => {
      vi.useFakeTimers();
      mocks.getThread.mockResolvedValue(thread({ blocked: true }));
      mount();
      await advance(10);
      await advance(5000);
      expect(mocks.getThread).toHaveBeenCalledTimes(2);
    });
  });

  describe('tin cũ hơn', () => {
    const m = (n: number, over: Record<string, unknown> = {}) =>
      msg({ id: `m${String(n).padStart(2, '0')}`, body: `tin ${n}`, createdAt: `2026-10-23T03:${String(n).padStart(2, '0')}:00.000Z`, ...over });
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => m(a + i));
    const refetch = () => act(async () => { await qc.invalidateQueries({ queryKey: ['support-chat'] }); });

    it('hasMore: có nút "Xem tin cũ hơn", bấm thì tin cũ chèn lên đầu theo id cũ nhất', async () => {
      mocks.getThread.mockResolvedValue(thread({ hasMore: true, messages: [m(5)] }));
      mocks.getPage.mockResolvedValue({ hasMore: false, messages: [m(3)] });
      const c = mount();
      await waitFor(() => expect(buttonByName(c, 'Xem tin cũ hơn')).not.toBeNull());
      click(buttonByName(c, 'Xem tin cũ hơn'));
      await waitFor(() => expect(bubble(c, 'm03')).not.toBeNull());
      expect(mocks.getPage).toHaveBeenCalledWith({ before: 'm05' });
      expect(msgIds(c)).toEqual(['msg-m03', 'msg-m05']);
      expect(buttonByName(c, 'Xem tin cũ hơn')).toBeNull();
    });

    it('poll làm cửa sổ trượt đi: tin đã tải vẫn còn đủ, đúng thứ tự, không trùng; tin cập nhật lấy bản mới', async () => {
      mocks.getThread.mockResolvedValueOnce(thread({ hasMore: true, messages: range(11, 50) }));
      mocks.getPage.mockResolvedValue({ hasMore: false, messages: range(1, 10) });
      const c = mount();
      await waitFor(() => expect(buttonByName(c, 'Xem tin cũ hơn')).not.toBeNull());
      click(buttonByName(c, 'Xem tin cũ hơn'));
      await waitFor(() => expect(bubble(c, 'm01')).not.toBeNull());
      mocks.getThread.mockResolvedValue(
        thread({ hasMore: true, messages: [...range(12, 50).map((x) => (x.id === 'm12' ? m(12, { body: 'tin 12 đã sửa' }) : x)), m(51)] }),
      );
      await refetch();
      await waitFor(() => expect(bubble(c, 'm51')).not.toBeNull());
      expect(msgIds(c)).toEqual(range(1, 51).map((x) => `msg-${x.id}`));
      expect(bubble(c, 'm12')!.textContent).toContain('tin 12 đã sửa');
      expect(buttonByName(c, 'Xem tin cũ hơn')).toBeNull();
    });

    it('tin bị thu hồi (không còn trong cửa sổ poll) biến mất; tin chỉ có ở trang cũ thì giữ', async () => {
      mocks.getThread.mockResolvedValueOnce(thread({ hasMore: true, messages: [m(3), m(4), m(5), m(6)] }));
      mocks.getPage.mockResolvedValue({ hasMore: false, messages: [m(1), m(2)] });
      const c = mount();
      await waitFor(() => expect(buttonByName(c, 'Xem tin cũ hơn')).not.toBeNull());
      click(buttonByName(c, 'Xem tin cũ hơn'));
      await waitFor(() => expect(bubble(c, 'm01')).not.toBeNull());
      mocks.getThread.mockResolvedValue(thread({ hasMore: true, messages: [m(3), m(5), m(6)] }));
      await refetch();
      await waitFor(() => expect(bubble(c, 'm04')).toBeNull());
      expect(msgIds(c)).toEqual(['msg-m01', 'msg-m02', 'msg-m03', 'msg-m05', 'msg-m06']);
    });

    it('hết tin (hasMore=false) mà cửa sổ chỉ còn một phần: bỏ cả tin cũ đã tải trước đó', async () => {
      mocks.getThread.mockResolvedValueOnce(thread({ hasMore: true, messages: [m(3), m(4)] }));
      mocks.getPage.mockResolvedValue({ hasMore: false, messages: [m(1), m(2)] });
      const c = mount();
      await waitFor(() => expect(buttonByName(c, 'Xem tin cũ hơn')).not.toBeNull());
      click(buttonByName(c, 'Xem tin cũ hơn'));
      await waitFor(() => expect(bubble(c, 'm01')).not.toBeNull());
      mocks.getThread.mockResolvedValue(thread({ hasMore: false, messages: [m(4)] }));
      await refetch();
      await waitFor(() => expect(msgIds(c)).toEqual(['msg-m04']));
    });

    it('cửa sổ rỗng và hết tin: xoá hết tin đã thấy', async () => {
      mocks.getThread.mockResolvedValueOnce(thread({ messages: [msg({ id: 'm1', sender: 'STAFF' })] }));
      const c = mount();
      await waitFor(() => expect(bubble(c, 'm1')).not.toBeNull());
      mocks.getThread.mockResolvedValue(thread({ messages: [] }));
      await refetch();
      await waitFor(() => expect(bubble(c, 'm1')).toBeNull());
    });

    it('chat đang đóng: xem tin cũ hơn lỗi vẫn hiện thông báo', async () => {
      mocks.getThread.mockResolvedValue(thread({ blocked: true, hasMore: true, messages: [m(5)] }));
      mocks.getPage.mockRejectedValue(new Error('Mất kết nối. Vui lòng kiểm tra mạng rồi thử lại.'));
      const c = mount();
      await waitFor(() => expect(buttonByName(c, 'Xem tin cũ hơn')).not.toBeNull());
      click(buttonByName(c, 'Xem tin cũ hơn'));
      await waitFor(() => expect(c.querySelector('[role="alert"]')?.textContent).toContain('Mất kết nối'));
      expect(textbox(c)).toBeNull();
    });

    it('hasMore=false: không có nút', async () => {
      mocks.getThread.mockResolvedValue(thread({ messages: [msg({ id: 'm1' })] }));
      const c = mount();
      await waitFor(() => expect(bubble(c, 'm1')).not.toBeNull());
      expect(buttonByName(c, 'Xem tin cũ hơn')).toBeNull();
    });
  });
});
