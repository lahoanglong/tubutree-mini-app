import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FeedComment, FeedItem } from '../services/feed-api';

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
vi.mock('../services/api', () => ({
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
  avatar: null,
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
  avatar: null,
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
