import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FeedItem } from '../services/feed-api';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  getFeed: vi.fn(),
  getCategories: vi.fn(),
  haptic: vi.fn(),
  search: '',
  auth: { status: 'authenticated' as 'loading' | 'authenticated' | 'anonymous' },
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/feed', search: mocks.search, state: null }),
}));
vi.mock('../services/feed-api', () => ({ getFeed: mocks.getFeed, getCategories: mocks.getCategories }));
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi') }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, login: mocks.login };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../utils/use-debounced', () => ({ useDebounced: <T,>(v: T) => v }));
vi.mock('../components/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('../components/community/post-composer', () => ({
  default: ({ visible }: { visible: boolean }) => (visible ? <div data-testid="composer" /> : null),
}));

import FeedPage from './feed';

const POST = (id: string, author: string): FeedItem => ({
  id,
  kind: 'TIP',
  status: 'APPROVED',
  title: null,
  body: `Nội dung ${id}`,
  images: [],
  meta: null,
  createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
  author,
  avatar: null,
  badge: null,
  authorLevel: 1,
  category: null,
  productTags: [],
  tags: [],
  isPinned: false,
  likeCount: 0,
  commentCount: 0,
  liked: false,
  bestCommentId: null,
  isOwner: false,
});

const CATS = [
  { id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null },
  { id: 'c2', slug: 'vuon', name: 'Vườn', icon: null },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FeedPage />
    </QueryClientProvider>,
  );
}

const lastFeedArgs = () => mocks.getFeed.mock.calls.at(-1)![0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search = '';
  mocks.auth.status = 'authenticated';
  mocks.getCategories.mockResolvedValue(CATS);
  mocks.getFeed.mockResolvedValue({ posts: [POST('p1', 'Lan Anh'), POST('p2', 'Minh Tâm')], nextCursor: null });
});

describe('FeedPage — hành vi giữ nguyên khi chuyển DS v2', () => {
  it('chưa đăng nhập: cổng đăng nhập, bấm nút gọi login, không tải bài', async () => {
    mocks.auth.status = 'anonymous';
    renderPage();
    expect(screen.getByText('Đăng nhập để xem cộng đồng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục với Zalo' }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.getFeed).not.toHaveBeenCalled();
  });

  it('đang khôi phục phiên: không hiện cổng đăng nhập và không tải bài', () => {
    mocks.auth.status = 'loading';
    renderPage();
    expect(screen.queryByText('Đăng nhập để xem cộng đồng')).toBeNull();
    expect(mocks.getFeed).not.toHaveBeenCalled();
  });

  it('đã đăng nhập: tải bài mới nhất, hiện danh sách và mở bài khi bấm thẻ', async () => {
    renderPage();
    expect(await screen.findByText('Lan Anh')).toBeInTheDocument();
    expect(screen.getByText('Minh Tâm')).toBeInTheDocument();
    expect(lastFeedArgs()).toEqual({
      category: undefined,
      sort: 'new',
      cursor: undefined,
      q: undefined,
      unanswered: undefined,
      tag: undefined,
    });
    fireEvent.click(screen.getByText('Lan Anh'));
    expect(mocks.navigate).toHaveBeenCalledWith('/feed/p1');
  });

  it('chip sắp xếp, danh mục, chưa trả lời đổi tham số truy vấn', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(screen.getByRole('button', { name: 'Nổi bật' }));
    await waitFor(() => expect(lastFeedArgs()).toMatchObject({ sort: 'popular' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nhà bếp' }));
    await waitFor(() => expect(lastFeedArgs()).toMatchObject({ category: 'bep' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chưa trả lời' }));
    await waitFor(() => expect(lastFeedArgs()).toMatchObject({ unanswered: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
    await waitFor(() => expect(lastFeedArgs()).toMatchObject({ category: undefined }));
  });

  it('gõ vào ô tìm kiếm gửi q', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.change(screen.getByPlaceholderText('Tìm câu hỏi, mẹo, bài viết…'), { target: { value: 'sen đá' } });
    await waitFor(() => expect(lastFeedArgs()).toMatchObject({ q: 'sen đá' }));
  });

  it('nút bảng xếp hạng, sự kiện điều hướng; nút Đăng bài mở khung soạn', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(screen.getByRole('button', { name: 'Bảng xếp hạng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/feed/leaderboard');
    fireEvent.click(screen.getByRole('button', { name: 'Sự kiện' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/feed/events');
    expect(screen.queryByTestId('composer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Đăng bài' }));
    expect(screen.getByTestId('composer')).toBeInTheDocument();
  });

  it('mở từ thẻ hashtag (?tag=…&tagName=…): lọc theo thẻ, hiện nhãn, bấm nhãn để bỏ lọc', async () => {
    mocks.search = '?tag=da-nhay-cam&tagName=da%20nh%E1%BA%A1y%20c%E1%BA%A3m';
    renderPage();
    const pill = await screen.findByRole('button', { name: 'Bỏ lọc thẻ' });
    expect(pill).toHaveTextContent('da nhạy cảm');
    await waitFor(() => expect(lastFeedArgs()).toMatchObject({ tag: 'da-nhay-cam' }));
    fireEvent.click(pill);
    expect(mocks.navigate).toHaveBeenCalledWith('/feed', { replace: true });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Bỏ lọc thẻ' })).toBeNull());
    await waitFor(() => expect(lastFeedArgs()).toMatchObject({ tag: undefined }));
  });

  it('không có bài: không lọc → "Chưa có bài viết nào"; đang lọc → "Không tìm thấy bài phù hợp"', async () => {
    mocks.getFeed.mockResolvedValue({ posts: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText('Chưa có bài viết nào')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chưa trả lời' }));
    expect(await screen.findByText('Không tìm thấy bài phù hợp')).toBeInTheDocument();
  });

  it('lỗi tải: báo lỗi và Thử lại tải lại', async () => {
    mocks.getFeed.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue({ posts: [POST('p1', 'Lan Anh')], nextCursor: null });
    renderPage();
    expect(await screen.findByText('mất mạng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Lan Anh')).toBeInTheDocument();
  });

  it('phân trang: "Xem thêm" nạp trang kế bằng cursor', async () => {
    mocks.getFeed
      .mockResolvedValueOnce({ posts: [POST('p1', 'Lan Anh')], nextCursor: 'cur-2' })
      .mockResolvedValue({ posts: [POST('p3', 'Hà My')], nextCursor: null });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
    expect(await screen.findByText('Hà My')).toBeInTheDocument();
    expect(lastFeedArgs()).toMatchObject({ cursor: 'cur-2' });
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  });
});

describe('FeedPage — tiêu đề, vùng chạm, biểu tượng (C-076, C-113, C-114)', () => {
  it('có đúng một h1 "Cộng đồng Vườn Tubu" ở mọi trạng thái', async () => {
    mocks.auth.status = 'loading';
    const loading = renderPage();
    expect(loading.container.querySelectorAll('h1')).toHaveLength(1);
    loading.unmount();

    mocks.auth.status = 'anonymous';
    const gate = renderPage();
    expect(gate.container.querySelectorAll('h1')).toHaveLength(1);
    gate.unmount();

    mocks.auth.status = 'authenticated';
    mocks.getFeed.mockReturnValue(new Promise(() => {}));
    const fetching = renderPage();
    expect(fetching.container.querySelectorAll('h1')).toHaveLength(1);
    fetching.unmount();

    mocks.getFeed.mockResolvedValue({ posts: [POST('p1', 'Lan Anh')], nextCursor: null });
    const loaded = renderPage();
    await screen.findByText('Lan Anh');
    expect(loaded.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Cộng đồng Vườn Tubu');
  });

  it('nút bảng xếp hạng, sự kiện, Đăng bài và chip có vùng chạm >= 44px', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    for (const name of ['Bảng xếp hạng', 'Sự kiện']) {
      const btn = screen.getByRole('button', { name });
      expect(Number.parseFloat(btn.style.minWidth)).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
    expect(Number.parseFloat(screen.getByRole('button', { name: 'Đăng bài' }).style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(screen.getByRole('button', { name: 'Nổi bật' }).className).toContain('tubu-hit-44');
  });

  it('nhãn lọc thẻ không dùng ký tự ✕', async () => {
    mocks.search = '?tag=da-nhay-cam&tagName=da%20nh%E1%BA%A1y%20c%E1%BA%A3m';
    renderPage();
    const pill = await screen.findByRole('button', { name: 'Bỏ lọc thẻ' });
    expect(pill.textContent).not.toContain('✕');
  });

  it('ô tìm kiếm là form role=search có nút xoá khi đã gõ', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    expect(screen.getByRole('search')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Tìm câu hỏi, mẹo, bài viết…'), { target: { value: 'abc' } });
    expect(screen.getByRole('button', { name: 'Xoá từ khoá' })).toBeInTheDocument();
  });
});
