import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FeedComment, FeedItem } from '../services/feed-api';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  login: vi.fn(),
  haptic: vi.fn(),
  getPost: vi.fn(),
  getComments: vi.fn(),
  addComment: vi.fn(),
  setBestAnswer: vi.fn(),
  deletePost: vi.fn(),
  editPost: vi.fn(),
  reactPost: vi.fn(),
  reportContent: vi.fn(),
  removeComment: vi.fn(),
  adminPin: vi.fn(),
  auth: { status: 'authenticated' as 'loading' | 'authenticated' | 'anonymous', role: 'CUSTOMER' as string },
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useParams: () => ({ id: 'p1' }),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/feed/p1', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/feed-api', () => ({
  getPost: mocks.getPost,
  getComments: mocks.getComments,
  addComment: mocks.addComment,
  setBestAnswer: mocks.setBestAnswer,
  deletePost: mocks.deletePost,
  editPost: mocks.editPost,
  reactPost: mocks.reactPost,
  reportContent: mocks.reportContent,
  removeComment: mocks.removeComment,
  adminPin: mocks.adminPin,
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
  getLoadErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
  apiMediaUrl: (src: string) => (src.startsWith('/') && !src.startsWith('//') ? `https://api.test${src}` : src),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, user: { role: mocks.auth.role }, login: mocks.login };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));

import PostDetailPage from './post-detail';

const POST = (over: Partial<FeedItem> = {}): FeedItem => ({
  id: 'p1',
  kind: 'TIP',
  status: 'APPROVED',
  title: null,
  body: 'Mẹo rửa bình sữa bằng nước rửa chén sinh học.',
  images: [],
  meta: null,
  createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  author: 'Lan Anh',
  badge: null,
  authorLevel: 1,
  category: { id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null },
  productTags: [],
  tags: [],
  isPinned: false,
  likeCount: 5,
  commentCount: 2,
  liked: false,
  bestCommentId: null,
  isOwner: false,
  ...over,
});

const COMMENT = (id: string, author: string, over: Partial<FeedComment> = {}): FeedComment => ({
  id,
  body: `Trả lời của ${author}`,
  author,
  badge: null,
  authorLevel: 1,
  isAccepted: false,
  createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
  isOwner: false,
  ...over,
});

const COMMENTS = [COMMENT('c1', 'Bình'), COMMENT('c2', 'Hạnh', { isAccepted: true }), COMMENT('c3', 'Tôi', { isOwner: true })];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PostDetailPage />
    </QueryClientProvider>,
  );
}

function stub(post: FeedItem = POST(), comments: FeedComment[] = COMMENTS) {
  mocks.getPost.mockResolvedValue(post);
  mocks.getComments.mockResolvedValue({ items: comments, nextCursor: null });
}


const btn = (name: string | RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.status = 'authenticated';
  mocks.auth.role = 'CUSTOMER';
  mocks.reactPost.mockResolvedValue({ liked: true });
  mocks.addComment.mockResolvedValue({ id: 'c9' });
  mocks.setBestAnswer.mockResolvedValue({ ok: true });
  mocks.deletePost.mockResolvedValue({ ok: true });
  mocks.editPost.mockResolvedValue({});
  mocks.reportContent.mockResolvedValue({ ok: true });
  mocks.removeComment.mockResolvedValue({ ok: true });
  mocks.adminPin.mockResolvedValue({});
  stub();
});

describe('PostDetailPage — hiển thị (hành vi giữ nguyên khi chuyển DS v2)', () => {
  it('hiện bài viết, số like/bình luận, câu trả lời; câu trả lời hay nhất được đưa lên đầu', async () => {
    renderPage();
    expect(await screen.findByText('Mẹo rửa bình sữa bằng nước rửa chén sinh học.')).toBeInTheDocument();
    expect(screen.getByText('Lan Anh')).toBeInTheDocument();
    expect(screen.getByText(/2 giờ trước · .*Nhà bếp/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('5')).toBeNull();
    expect(screen.getByText('Trả lời (3)')).toBeInTheDocument();
    const bodies = (await screen.findAllByText(/^Trả lời của /)).map((el) => el.textContent);
    expect(bodies).toEqual(['Trả lời của Hạnh', 'Trả lời của Bình', 'Trả lời của Tôi']);
    expect(screen.getByText(/Câu trả lời hay nhất/)).toBeInTheDocument();
    expect(mocks.getPost).toHaveBeenCalledWith('p1');
  });

  it('câu hỏi hiện tiêu đề câu hỏi; bài chờ duyệt của chủ bài và bài đã ghim hiện nhãn tương ứng', async () => {
    stub(POST({ kind: 'QUESTION', title: 'Rửa bình sữa thế nào?', isOwner: true, status: 'PENDING', isPinned: true }));
    renderPage();
    expect(await screen.findByText('Rửa bình sữa thế nào?')).toBeInTheDocument();
    const pending = screen.getByText(/Chờ duyệt/);
    expect(pending.textContent).toBe('Chờ duyệt');
    expect(pending.querySelector('svg')).not.toBeNull();
    expect(screen.getByText(/Đã ghim/)).toBeInTheDocument();
  });

  it('ảnh bài: đường dẫn do API phục vụ được ghép gốc API, URL https và data URL (API cũ) giữ nguyên', async () => {
    const v = 'c'.repeat(32);
    stub(POST({ images: [`/feed/posts/p1/images/0?v=${v}`, 'https://res.cloudinary.com/demo/a.jpg', 'data:image/jpeg;base64,QUJD'], imageCount: 3 }));
    const { container } = renderPage();
    await screen.findByText('Mẹo rửa bình sữa bằng nước rửa chén sinh học.');
    expect([...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      `https://api.test/feed/posts/p1/images/0?v=${v}`,
      'https://res.cloudinary.com/demo/a.jpg',
      'data:image/jpeg;base64,QUJD',
    ]);
  });

  it('chưa đăng nhập: cổng đăng nhập, bấm nút gọi login, không tải bài', () => {
    mocks.auth.status = 'anonymous';
    renderPage();
    expect(screen.getByText('Đăng nhập để xem cộng đồng')).toBeInTheDocument();
    fireEvent.click(btn('Tiếp tục với Zalo'));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.getPost).not.toHaveBeenCalled();
  });

  it('lỗi tải bài: báo lỗi, Thử lại tải lại', async () => {
    mocks.getPost.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue(POST());
    renderPage();
    expect(await screen.findByText('mất mạng')).toBeInTheDocument();
    fireEvent.click(btn('Thử lại'));
    expect(await screen.findByText('Lan Anh')).toBeInTheDocument();
  });

  it('không có câu trả lời → chữ trống, không mời chia sẻ', async () => {
    stub(POST(), []);
    renderPage();
    expect(await screen.findByText('Chưa có trả lời')).toBeInTheDocument();
    expect(screen.queryByText(/người đầu tiên/)).toBeNull();
  });

  it('có trang kế → "Xem thêm trả lời" nạp bằng cursor', async () => {
    mocks.getComments
      .mockResolvedValueOnce({ items: [COMMENT('c1', 'Bình')], nextCursor: 'cur-2' })
      .mockResolvedValue({ items: [COMMENT('c4', 'Mai')], nextCursor: null });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm trả lời' }));
    expect(await screen.findByText('Trả lời của Mai')).toBeInTheDocument();
    expect(mocks.getComments).toHaveBeenLastCalledWith('p1', 'cur-2');
  });

  it('thẻ sản phẩm gắn kèm mở /product/:slug; bài Trải nghiệm có nút "Mua sản phẩm này"', async () => {
    stub(
      POST({
        kind: 'SHOWCASE',
        productTags: [{ slug: 'nuoc-rua-chen', name: 'Nước rửa chén', thumbnail: null, salePrice: null, basePrice: 89_000 }],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByText('Nước rửa chén'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen');
    expect(screen.getByText('89.000đ')).toBeInTheDocument();
    mocks.navigate.mockClear();
    fireEvent.click(btn('Mua sản phẩm này'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen');
  });
});

describe('PostDetailPage — chỉ đọc theo chính sách Zalo (4.6)', () => {
  it('không có nút thích, ô trả lời, Gửi, sửa, xoá, ghim, chọn hay nhất, ẩn bình luận, kể cả chủ bài và quản trị', async () => {
    mocks.auth.role = 'ADMIN';
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    renderPage();
    await screen.findByText('Trả lời của Bình');
    expect(screen.queryByPlaceholderText('Viết trả lời…')).toBeNull();
    for (const name of ['Gửi', 'Sửa', 'Xoá', 'Ghim', 'Bỏ ghim', 'Chọn hay nhất', 'Ẩn nội dung']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByText('5')).toBeNull();
    expect(screen.queryByRole('button', { name: /thích/i })).toBeNull();
  });

  it('người khác báo cáo bài: sheet Báo cáo gửi targetType POST kèm lý do đã trim', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    const reason = await screen.findByPlaceholderText('Lý do báo cáo…');
    fireEvent.change(reason, { target: { value: '  Spam quảng cáo  ' } });
    const submit = screen.getAllByRole('button', { name: 'Báo cáo' });
    fireEvent.click(submit[submit.length - 1]!);
    await waitFor(() => expect(mocks.reportContent).toHaveBeenCalledWith('p1', { targetType: 'POST', reason: 'Spam quảng cáo' }));
  });

  it('báo cáo một bình luận gửi targetType COMMENT kèm targetId', async () => {
    renderPage();
    await screen.findByText('Trả lời của Bình');
    const row = screen.getByText('Trả lời của Bình').parentElement!;
    fireEvent.click(row.querySelector('[aria-label="Báo cáo"]') as HTMLElement);
    await screen.findByPlaceholderText('Lý do báo cáo…');
    const submit = screen.getAllByRole('button', { name: 'Báo cáo' });
    fireEvent.click(submit[submit.length - 1]!);
    await waitFor(() =>
      expect(mocks.reportContent).toHaveBeenCalledWith('p1', { targetType: 'COMMENT', targetId: 'c1', reason: '' }),
    );
  });

  it('bài và bình luận của chính mình không có nút Báo cáo', async () => {
    stub(POST({ isOwner: true }), [COMMENT('c3', 'Tôi', { isOwner: true })]);
    renderPage();
    await screen.findByText('Trả lời của Tôi');
    expect(screen.queryByRole('button', { name: 'Báo cáo' })).toBeNull();
  });
});

describe('PostDetailPage — tiêu đề, vùng chạm, biểu tượng (C-076, C-113, C-114)', () => {
  it('có đúng một h1 ở mọi trạng thái: đang khôi phục phiên, cổng đăng nhập, đang tải, lỗi, đã tải', async () => {
    mocks.auth.status = 'loading';
    const a = renderPage();
    expect(a.container.querySelectorAll('h1')).toHaveLength(1);
    a.unmount();

    mocks.auth.status = 'anonymous';
    const b = renderPage();
    expect(b.container.querySelectorAll('h1')).toHaveLength(1);
    b.unmount();

    mocks.auth.status = 'authenticated';
    mocks.getPost.mockReturnValue(new Promise(() => {}));
    const c = renderPage();
    expect(c.container.querySelectorAll('h1')).toHaveLength(1);
    c.unmount();

    mocks.getPost.mockRejectedValue(new Error('hỏng'));
    const d = renderPage();
    await screen.findByText('hỏng');
    expect(d.container.querySelectorAll('h1')).toHaveLength(1);
    d.unmount();

    stub();
    const e = renderPage();
    await screen.findByText('Lan Anh');
    expect(e.container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('nút báo cáo có vùng chạm >= 44px', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    for (const el of screen.getAllByRole('button', { name: 'Báo cáo' })) expect(Number.parseFloat(el.style.minHeight) >= 44).toBe(true);
  });

  it('không dùng emoji làm biểu tượng: avatar, chuyên gia, ghim, câu trả lời hay nhất', async () => {
    stub(POST({ badge: 'EXPERT', isPinned: true }), [COMMENT('c2', 'Hạnh', { isAccepted: true, badge: 'EXPERT' })]);
    const { container } = renderPage();
    await screen.findByText('Lan Anh');
    await screen.findByText(/Câu trả lời hay nhất/);
    expect(container.textContent).not.toMatch(/[🌱🌿📌✅]/u);
  });

  it('sheet Báo cáo có tiêu đề heading; nút xác nhận nằm ngoài vùng cuộn', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Báo cáo' })).toBeInTheDocument();
    const submit = screen.getAllByRole('button', { name: 'Báo cáo' });
    expect(screen.getByTestId('bottom-sheet-body').contains(submit[submit.length - 1]!)).toBe(false);
  });
});

describe('PostDetailPage: Báo cáo khoá chạm đúp, lỗi tại chỗ (W74A)', () => {
  const openReport = async () => {
    await screen.findByText('Lan Anh');
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    const reason = await screen.findByPlaceholderText('Lý do báo cáo…');
    fireEvent.change(reason, { target: { value: 'Spam' } });
    const submit = screen.getAllByRole('button', { name: 'Báo cáo' });
    return submit[submit.length - 1]!;
  };

  it('chạm đúp "Báo cáo" trong cùng một khung hình chỉ gửi một báo cáo', async () => {
    let resolve!: (v: unknown) => void;
    mocks.reportContent.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
    renderPage();
    const submit = await openReport();
    await act(async () => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    expect(mocks.reportContent).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    expect(mocks.reportContent).toHaveBeenCalledTimes(1);
  });

  it('gửi lỗi: báo tại chỗ trong sheet (role=alert), nhả khoá để gửi lại; đóng sheet thì xoá cảnh báo', async () => {
    mocks.reportContent.mockRejectedValueOnce(new Error('Bạn đã báo cáo rồi')).mockResolvedValue({ ok: true });
    renderPage();
    const submit = await openReport();
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('Bạn đã báo cáo rồi');
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.reportContent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('đóng sheet rồi mở lại: không còn cảnh báo lỗi của lần trước', async () => {
    mocks.reportContent.mockRejectedValueOnce(new Error('Bạn đã báo cáo rồi'));
    renderPage();
    const submit = await openReport();
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('Bạn đã báo cáo rồi');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Lý do báo cáo…')).toBeNull());
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    await screen.findByPlaceholderText('Lý do báo cáo…');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('PostDetailPage: đóng sheet báo cáo khi đang gửi (W74A)', () => {
  it('không bỏ theo dõi lần gửi: mở lại vẫn báo bận, không gửi lần hai, lỗi đến sau vẫn hiện', async () => {
    let reject!: (e: unknown) => void;
    mocks.reportContent.mockReturnValueOnce(new Promise((_, rej) => { reject = rej; }));
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    fireEvent.change(await screen.findByPlaceholderText('Lý do báo cáo…'), { target: { value: 'Spam' } });
    const buttons = screen.getAllByRole('button', { name: 'Báo cáo' });
    await act(async () => {
      fireEvent.click(buttons[buttons.length - 1]!);
    });
    await waitFor(() => {
      const b = screen.getAllByRole('button', { name: 'Báo cáo' });
      expect(b[b.length - 1]).toHaveAttribute('aria-busy', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Lý do báo cáo…')).toBeNull());
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    const reopened = await screen.findByPlaceholderText('Lý do báo cáo…');
    fireEvent.change(reopened, { target: { value: 'Spam' } });
    await waitFor(() => {
      const b = screen.getAllByRole('button', { name: 'Báo cáo' });
      expect(b[b.length - 1]).toHaveAttribute('aria-busy', 'true');
    });
    const b = screen.getAllByRole('button', { name: 'Báo cáo' });
    await act(async () => {
      fireEvent.click(b[b.length - 1]!);
    });
    expect(mocks.reportContent).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('Bạn đã báo cáo rồi')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bạn đã báo cáo rồi');
  });
});

describe('PostDetailPage: "Thử lại" chạm đúp (W74A)', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  it('lỗi tải bài: chạm đúp "Thử lại" chỉ tải lại một lần', async () => {
    const d = deferred();
    mocks.getPost.mockRejectedValueOnce(new Error('mất mạng')).mockReturnValueOnce(d.promise);
    renderPage();
    await screen.findByText('mất mạng');
    const retry = btn('Thử lại');
    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.getPost).toHaveBeenCalledTimes(2);
    await act(async () => d.resolve(POST()));
    expect(await screen.findByText('Lan Anh')).toBeInTheDocument();
  });
});

// W113A: báo cáo bị máy chủ từ chối hẳn (400/404/409/422) thì đóng tấm và báo lỗi bằng snackbar; riêng 400/404/409 còn tải lại bài + bình luận và giữ khoá tới khi dữ liệu về (tối đa LOCK_REFRESH_WAIT_MS). Mất mạng, quá hạn, 401, 5xx: tấm còn mở kèm lỗi tại chỗ như trước, nhả khoá ngay, không tải lại.
describe('PostDetailPage: Báo cáo bị từ chối thì đóng tấm, tải lại bài + bình luận, giữ khoá (W113A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const errorToasts = (text: string) => mocks.openSnackbar.mock.calls.filter(([o]) => o.type === 'error' && o.text === text).length;
  const REASON = 'Lý do báo cáo…';
  /** Mở tấm báo cáo bài và trả nút gửi (nút "Báo cáo" cuối cùng trong DOM, nằm ở chân tấm). */
  const openSheet = async () => {
    await screen.findByText('Lan Anh');
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    fireEvent.change(await screen.findByPlaceholderText(REASON), { target: { value: 'Spam' } });
    const all = screen.getAllByRole('button', { name: 'Báo cáo' });
    return all[all.length - 1]!;
  };
  const submitBtn = () => {
    const all = screen.getAllByRole('button', { name: 'Báo cáo' });
    return all[all.length - 1]!;
  };
  const sheetGone = () => waitFor(() => expect(screen.queryByPlaceholderText(REASON)).toBeNull());

  it.each([
    [400, 'Bạn đã báo cáo nội dung này rồi'],
    [404, 'Nội dung bị báo cáo không còn'],
    [409, 'Báo cáo vừa được xử lý'],
  ])('bị từ chối %i: báo lỗi một lần, tải lại bài và bình luận, tấm giữ mở và khoá giữ tới khi dữ liệu về rồi mới đóng', async (status, message) => {
    mocks.reportContent.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue({ ok: true });
    renderPage();
    const submit = await openSheet();
    const refresh = deferred();
    mocks.getPost.mockReturnValueOnce(refresh.promise);
    fireEvent.click(submit);
    await waitFor(() => expect(errorToasts(message)).toBe(1));
    // Tiền tố ['community', 'p1'] tải lại cả bài lẫn bình luận.
    await waitFor(() => expect(mocks.getPost).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.getComments).toHaveBeenCalledTimes(2));
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    // Dữ liệu chưa về: tấm vẫn mở, nút vẫn bận, chạm thêm không gửi lần hai.
    expect(screen.getByPlaceholderText(REASON)).toBeInTheDocument();
    expect(submitBtn()).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(submitBtn());
      fireEvent.click(submitBtn());
    });
    expect(mocks.reportContent).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve(POST()));
    await sheetGone();
    await settle();
    // Khoá đã nhả: mở lại tấm, nút không còn bận.
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    await screen.findByPlaceholderText(REASON);
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy'));
    expect(errorToasts(message)).toBe(1);
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.reportContent).toHaveBeenCalledTimes(2));
  });

  it('bị từ chối 422: đóng tấm và báo lỗi nhưng không tải lại, nhả khoá ngay', async () => {
    mocks.reportContent.mockRejectedValueOnce(serverError('Dữ liệu không hợp lệ', 422)).mockResolvedValue({ ok: true });
    renderPage();
    const submit = await openSheet();
    fireEvent.click(submit);
    await waitFor(() => expect(errorToasts('Dữ liệu không hợp lệ')).toBe(1));
    await sheetGone();
    await settle();
    expect(mocks.getPost).toHaveBeenCalledTimes(1);
    expect(mocks.getComments).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    await screen.findByPlaceholderText(REASON);
    expect(submitBtn()).not.toHaveAttribute('aria-busy');
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.reportContent).toHaveBeenCalledTimes(2));
  });

  it('tấm đã mở lại cho bình luận khác lúc lệnh bay: lỗi 404 của lệnh báo cáo bài không đóng tấm bình luận và giữ lý do đang gõ', async () => {
    let reject!: (e: unknown) => void;
    mocks.reportContent.mockReturnValueOnce(new Promise((_, rej) => { reject = rej; }));
    renderPage();
    const submit = await openSheet();
    await act(async () => {
      fireEvent.click(submit);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await sheetGone();
    const row = (await screen.findByText('Trả lời của Bình')).parentElement!;
    fireEvent.click(row.querySelector('[aria-label="Báo cáo"]') as HTMLElement);
    fireEvent.change(await screen.findByPlaceholderText(REASON), { target: { value: 'Quảng cáo' } });
    await act(async () => reject(serverError('Nội dung bị báo cáo không còn', 404)));
    await waitFor(() => expect(errorToasts('Nội dung bị báo cáo không còn')).toBe(1));
    await settle();
    expect(screen.getByPlaceholderText(REASON)).toHaveValue('Quảng cáo');
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ])('%s: tấm còn mở kèm lỗi tại chỗ, nhả khoá ngay, không tải lại, không có snackbar lỗi', async (_label, error) => {
    mocks.reportContent.mockRejectedValueOnce(error).mockResolvedValue({ ok: true });
    renderPage();
    const submit = await openSheet();
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(error.message);
    expect(screen.getByPlaceholderText(REASON)).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy'));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    await settle();
    expect(mocks.getPost).toHaveBeenCalledTimes(1);
    expect(mocks.getComments).toHaveBeenCalledTimes(1);
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.reportContent).toHaveBeenCalledTimes(2));
  });

  it('tải lại treo mãi: tấm mở và khoá giữ, đúng sau LOCK_REFRESH_WAIT_MS tấm mới đóng và khoá nhả', async () => {
    mocks.reportContent.mockRejectedValueOnce(serverError('Báo cáo vừa được xử lý', 409)).mockResolvedValue({ ok: true });
    renderPage();
    const submit = await openSheet();
    mocks.getPost.mockReturnValueOnce(new Promise(() => undefined));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(submit);
      await waitFor(() => expect(errorToasts('Báo cáo vừa được xử lý')).toBe(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(screen.getByPlaceholderText(REASON)).toBeInTheDocument();
      expect(submitBtn()).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await sheetGone();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
      await screen.findByPlaceholderText(REASON);
      await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy'));
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.reportContent).toHaveBeenCalledTimes(2));
  });
});

describe('PostDetailPage: tấm Báo cáo đóng SAU khi dữ liệu mới về (W115A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const REASON = 'Lý do báo cáo…';
  const submitBtn = () => {
    const all = screen.getAllByRole('button', { name: 'Báo cáo' });
    return all[all.length - 1]!;
  };
  const sheetOpen = () => screen.queryByPlaceholderText(REASON) !== null;
  const openSheet = async () => {
    await screen.findByText('Lan Anh');
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    fireEvent.change(await screen.findByPlaceholderText(REASON), { target: { value: 'Spam' } });
    return submitBtn();
  };

  it('thứ tự: lỗi hiện trước, tấm vẫn mở lúc tải lại chưa về, đóng đúng một lần sau khi về, lý do bị xoá, khoá nhả sau khi tấm đã đóng', async () => {
    mocks.reportContent.mockRejectedValueOnce(serverError('Nội dung bị báo cáo không còn', 404)).mockResolvedValue({ ok: true });
    renderPage();
    const submit = await openSheet();
    const refresh = deferred();
    mocks.getPost.mockReturnValueOnce(refresh.promise);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text: 'Nội dung bị báo cáo không còn' })));
    await waitFor(() => expect(mocks.getPost).toHaveBeenCalledTimes(2));
    await settle();
    expect(sheetOpen()).toBe(true);
    expect(submitBtn()).toHaveAttribute('aria-busy', 'true');
    await act(async () => refresh.resolve(POST()));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    await settle();
    expect(mocks.openSnackbar.mock.calls.filter(([o]) => o.type === 'error')).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    expect(await screen.findByPlaceholderText(REASON)).toHaveValue('');
    expect(submitBtn()).not.toHaveAttribute('aria-busy');
  });

  it('tải lại treo mãi: tấm còn mở ở LOCK_REFRESH_WAIT_MS - 500, đã đóng ở LOCK_REFRESH_WAIT_MS + 100', async () => {
    mocks.reportContent.mockRejectedValueOnce(serverError('Báo cáo vừa được xử lý', 409));
    renderPage();
    const submit = await openSheet();
    mocks.getPost.mockReturnValueOnce(new Promise(() => undefined));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(submit);
      await waitFor(() => expect(mocks.getPost).toHaveBeenCalledTimes(2));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(sheetOpen()).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await waitFor(() => expect(sheetOpen()).toBe(false));
    } finally {
      vi.useRealTimers();
    }
  });

  it('khách đổi sang báo cáo bình luận trong lúc chờ: tấm của bình luận không bị đóng, lý do đang gõ còn nguyên', async () => {
    mocks.reportContent.mockRejectedValueOnce(serverError('Nội dung bị báo cáo không còn', 404));
    renderPage();
    const submit = await openSheet();
    const refresh = deferred();
    mocks.getPost.mockReturnValueOnce(refresh.promise);
    await act(async () => {
      fireEvent.click(submit);
    });
    await waitFor(() => expect(mocks.getPost).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    const row = (await screen.findByText('Trả lời của Bình')).parentElement!;
    fireEvent.click(row.querySelector('[aria-label="Báo cáo"]') as HTMLElement);
    fireEvent.change(await screen.findByPlaceholderText(REASON), { target: { value: 'Quảng cáo' } });
    await act(async () => refresh.resolve(POST()));
    await settle();
    expect(screen.getByPlaceholderText(REASON)).toHaveValue('Quảng cáo');
  });

  it('máy chủ lỗi 503: tấm giữ mở, không tải lại, khoá nhả ngay (không đổi so với trước)', async () => {
    mocks.reportContent.mockRejectedValueOnce(serverError('Service Unavailable', 503));
    renderPage();
    const submit = await openSheet();
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('Service Unavailable');
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy'));
    await settle();
    expect(sheetOpen()).toBe(true);
    expect(mocks.getPost).toHaveBeenCalledTimes(1);
  });
});

describe('PostDetailPage: phản hồi muộn của lệnh cũ không đóng tấm Báo cáo mở lại cùng đích (W116A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const REASON = 'Lý do báo cáo…';
  const submitBtn = () => {
    const all = screen.getAllByRole('button', { name: 'Báo cáo' });
    return all[all.length - 1]!;
  };
  const sheetOpen = () => screen.queryByPlaceholderText(REASON) !== null;
  /** Mở tấm báo cáo bài, gõ lý do, gửi và chờ lệnh được nhận (đã gọi API). */
  const sendFirst = async () => {
    await screen.findByText('Lan Anh');
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    fireEvent.change(await screen.findByPlaceholderText(REASON), { target: { value: 'Spam' } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.reportContent).toHaveBeenCalledTimes(1));
  };
  /** Khách đóng tấm bằng nút Đóng rồi mở lại báo cáo CÙNG bài và gõ lý do mới. */
  const closeAndReopenSameTarget = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    fireEvent.change(await screen.findByPlaceholderText(REASON), { target: { value: 'Lý do mới' } });
  };

  it('bị từ chối 404 sau khi khách đóng rồi mở lại cùng bài: tấm mới còn mở, lý do đang gõ còn nguyên; lỗi, tải lại và nhả khoá vẫn chạy', async () => {
    mocks.reportContent.mockRejectedValueOnce(serverError('Nội dung bị báo cáo không còn', 404)).mockResolvedValue({ ok: true });
    renderPage();
    const refresh = deferred();
    await screen.findByText('Lan Anh');
    mocks.getPost.mockReturnValueOnce(refresh.promise);
    await sendFirst();
    await waitFor(() => expect(mocks.getPost).toHaveBeenCalledTimes(2));
    await closeAndReopenSameTarget();
    // Dữ liệu mới về: lần đóng muộn của lệnh cũ không chạm tấm mới.
    await act(async () => refresh.resolve(POST()));
    await settle();
    expect(sheetOpen()).toBe(true);
    expect(screen.getByPlaceholderText(REASON)).toHaveValue('Lý do mới');
    expect(mocks.openSnackbar.mock.calls.filter(([o]) => o.type === 'error')).toHaveLength(1);
    expect(mocks.getComments).toHaveBeenCalledTimes(2);
    // Khoá đã nhả: tấm mới gửi được.
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy'));
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.reportContent).toHaveBeenCalledTimes(2));
  });

  it('báo xong sau khi khách đóng rồi mở lại cùng bài: tấm mới còn mở, lý do đang gõ còn nguyên; thông báo thành công vẫn hiện', async () => {
    const send = deferred();
    mocks.reportContent.mockReturnValueOnce(send.promise);
    renderPage();
    await sendFirst();
    await closeAndReopenSameTarget();
    await act(async () => send.resolve({ ok: true }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    await settle();
    expect(mocks.haptic).toHaveBeenCalledWith('light');
    expect(sheetOpen()).toBe(true);
    expect(screen.getByPlaceholderText(REASON)).toHaveValue('Lý do mới');
  });

  it('khách không mở lại: lệnh báo xong hay bị từ chối vẫn đóng tấm như trước, lý do bị xoá', async () => {
    mocks.reportContent.mockRejectedValueOnce(serverError('Nội dung bị báo cáo không còn', 404)).mockResolvedValue({ ok: true });
    renderPage();
    const refresh = deferred();
    await screen.findByText('Lan Anh');
    mocks.getPost.mockReturnValueOnce(refresh.promise);
    await sendFirst();
    await waitFor(() => expect(mocks.getPost).toHaveBeenCalledTimes(2));
    await act(async () => refresh.resolve(POST()));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    fireEvent.click(screen.getAllByRole('button', { name: 'Báo cáo' })[0]!);
    expect(await screen.findByPlaceholderText(REASON)).toHaveValue('');
  });
});
