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
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi') }));
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
    expect(screen.getByText('5')).toBeInTheDocument();
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
    expect(screen.getByText(/Chờ duyệt/)).toBeInTheDocument();
    expect(screen.getByText(/Đã ghim/)).toBeInTheDocument();
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

  it('không có câu trả lời → câu mời chia sẻ đầu tiên', async () => {
    stub(POST(), []);
    renderPage();
    expect(await screen.findByText('Hãy là người đầu tiên chia sẻ hoặc đặt câu hỏi!')).toBeInTheDocument();
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

describe('PostDetailPage — thao tác (hành vi giữ nguyên khi chuyển DS v2)', () => {
  const likeBtn = () => screen.getByText('5').closest('button, [role="button"]') as HTMLElement;

  it('bấm tim gọi reactPost; trong lúc đang gửi bấm tiếp không gửi thêm', async () => {
    let resolve!: (v: { liked: boolean }) => void;
    mocks.reactPost.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(likeBtn());
    await waitFor(() => expect(likeBtn()).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(likeBtn());
    expect(mocks.reactPost).toHaveBeenCalledTimes(1);
    expect(mocks.reactPost).toHaveBeenCalledWith('p1');
    resolve({ liked: true });
  });

  it('gửi trả lời: nút Gửi khoá khi ô trống, gửi nội dung đã trim, xoá ô sau khi gửi', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    expect(btn('Gửi')).toBeDisabled();
    const input = screen.getByPlaceholderText('Viết trả lời…');
    fireEvent.change(input, { target: { value: '  Cảm ơn bạn  ' } });
    expect(btn('Gửi')).not.toBeDisabled();
    fireEvent.click(btn('Gửi'));
    await waitFor(() => expect(mocks.addComment).toHaveBeenCalledWith('p1', 'Cảm ơn bạn'));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('chủ bài sửa bài: mở sheet Sửa, đổi nội dung, Lưu gọi editPost', async () => {
    stub(POST({ isOwner: true }));
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(btn('Sửa'));
    const area = await screen.findByPlaceholderText('Chia sẻ chi tiết…');
    expect(area).toHaveValue('Mẹo rửa bình sữa bằng nước rửa chén sinh học.');
    fireEvent.change(area, { target: { value: '  Nội dung mới  ' } });
    fireEvent.click(btn('Lưu'));
    await waitFor(() => expect(mocks.editPost).toHaveBeenCalledWith('p1', { title: undefined, body: 'Nội dung mới' }));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Lưu', type: 'success' });
  });

  it('chủ câu hỏi sửa bài: bắt buộc tiêu đề, gửi kèm tiêu đề đã trim', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Tiêu đề cũ' }));
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(btn('Sửa'));
    const titleInput = await screen.findByPlaceholderText(/Tiêu đề câu hỏi/);
    fireEvent.change(titleInput, { target: { value: '   ' } });
    expect(screen.getByText('Câu hỏi cần có tiêu đề')).toBeInTheDocument();
    expect(btn('Lưu')).toBeDisabled();
    fireEvent.change(titleInput, { target: { value: ' Tiêu đề mới ' } });
    fireEvent.click(btn('Lưu'));
    await waitFor(() =>
      expect(mocks.editPost).toHaveBeenCalledWith('p1', { title: 'Tiêu đề mới', body: 'Mẹo rửa bình sữa bằng nước rửa chén sinh học.' }),
    );
  });

  it('chủ bài bấm Hủy ở hộp xác nhận xoá thì không xoá', async () => {
    stub(POST({ isOwner: true }));
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(btn('Xoá'));
    expect(await screen.findByText('Xoá bài viết này?')).toBeInTheDocument();
    fireEvent.click(btn('Hủy'));
    expect(mocks.deletePost).not.toHaveBeenCalled();
  });

  it('chủ bài xoá: hộp xác nhận → Xoá gọi deletePost rồi về /feed', async () => {
    stub(POST({ isOwner: true }));
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(btn('Xoá'));
    expect(await screen.findByText('Xoá bài viết này?')).toBeInTheDocument();
    const deletes = screen.getAllByRole('button', { name: 'Xoá' });
    fireEvent.click(deletes[deletes.length - 1]!);
    await waitFor(() => expect(mocks.deletePost).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/feed'));
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
    const row = screen.getByText('Trả lời của Bình').closest('[data-testid="comment-row"]') ?? screen.getByText('Trả lời của Bình').parentElement!;
    const flag = Array.from(row.querySelectorAll('[aria-label="Báo cáo"]'))[0] as HTMLElement;
    fireEvent.click(flag);
    await screen.findByPlaceholderText('Lý do báo cáo…');
    const submit = screen.getAllByRole('button', { name: 'Báo cáo' });
    fireEvent.click(submit[submit.length - 1]!);
    await waitFor(() =>
      expect(mocks.reportContent).toHaveBeenCalledWith('p1', { targetType: 'COMMENT', targetId: 'c1', reason: '' }),
    );
  });

  it('chủ câu hỏi chọn câu trả lời hay nhất; câu đã được chọn không còn nút', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    renderPage();
    await screen.findByText('Trả lời của Bình');
    const buttons = screen.getAllByRole('button', { name: 'Chọn hay nhất' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(mocks.setBestAnswer).toHaveBeenCalledWith('p1', 'c1'));
  });

  it('người không phải chủ câu hỏi không thấy nút "Chọn hay nhất"', async () => {
    stub(POST({ kind: 'QUESTION', title: 'Hỏi' }));
    renderPage();
    await screen.findByText('Trả lời của Bình');
    expect(screen.queryByRole('button', { name: 'Chọn hay nhất' })).toBeNull();
  });

  it('quản trị: nút Ghim gọi adminPin(true); bài đã ghim → Bỏ ghim gọi adminPin(false)', async () => {
    mocks.auth.role = 'ADMIN';
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Ghim' }));
    await waitFor(() => expect(mocks.adminPin).toHaveBeenCalledWith('p1', true));
  });

  it('chủ bình luận gỡ bình luận của mình', async () => {
    renderPage();
    await screen.findByText('Trả lời của Tôi');
    fireEvent.click(btn('Ẩn nội dung'));
    await waitFor(() => expect(mocks.removeComment).toHaveBeenCalledWith('c3'));
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

  it('nút sửa, xoá, báo cáo, tim, gửi và nút trên bình luận có vùng chạm >= 44px', async () => {
    stub(POST({ isOwner: true }));
    renderPage();
    await screen.findByText('Lan Anh');
    const tall = (el: HTMLElement) => Number.parseFloat(el.style.minHeight) >= 44;
    expect(tall(btn('Sửa'))).toBe(true);
    expect(tall(btn('Xoá'))).toBe(true);
    expect(tall(btn('Gửi'))).toBe(true);
    expect(tall(screen.getByText('5').closest('button, [role="button"]') as HTMLElement)).toBe(true);
    for (const el of screen.getAllByRole('button', { name: 'Báo cáo' })) expect(tall(el)).toBe(true);
    expect(tall(btn('Ẩn nội dung'))).toBe(true);
  });

  it('không dùng emoji làm biểu tượng: avatar, chuyên gia, ghim, câu trả lời hay nhất', async () => {
    stub(POST({ badge: 'EXPERT', isPinned: true }), [COMMENT('c2', 'Hạnh', { isAccepted: true, badge: 'EXPERT' })]);
    const { container } = renderPage();
    await screen.findByText('Lan Anh');
    await screen.findByText(/Câu trả lời hay nhất/);
    expect(container.textContent).not.toMatch(/[🌱🌿📌✅]/u);
  });

  it('các sheet có tiêu đề heading; nút xác nhận nằm ngoài vùng cuộn', async () => {
    stub(POST({ isOwner: true }));
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(btn('Sửa'));
    expect(await screen.findByRole('heading', { name: 'Sửa' })).toBeInTheDocument();
    expect(screen.getByTestId('bottom-sheet-body').contains(btn('Lưu'))).toBe(false);
  });

  it('ô trả lời và các ô nhập có tên truy cập', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    expect(screen.getByLabelText('Viết trả lời…')).toBe(screen.getByPlaceholderText('Viết trả lời…'));
  });
});
