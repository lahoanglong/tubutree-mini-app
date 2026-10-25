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
  getPreview: vi.fn(),
  config: { communityPublicPreview: false } as { communityPublicPreview?: boolean; community?: Record<string, string | null> },
  haptic: vi.fn(),
  openExternal: vi.fn(),
  openOAChat: vi.fn(),
  hasOA: true,
  search: '',
  auth: { status: 'authenticated' as 'loading' | 'authenticated' | 'anonymous' },
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/feed', search: mocks.search, state: null }),
}));
vi.mock('../services/feed-api', () => ({ getFeed: mocks.getFeed, getCategories: mocks.getCategories, getFeedPublicPreview: mocks.getPreview }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, ...mocks.config }) }));
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi') }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, login: mocks.login };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../services/zmp-bridge', () => ({
  openExternal: mocks.openExternal,
  openOAChat: mocks.openOAChat,
  get hasOA() {
    return mocks.hasOA;
  },
}));
vi.mock('../utils/use-debounced', () => ({ useDebounced: <T,>(v: T) => v }));
vi.mock('../components/pull-to-refresh', () => ({ PullToRefresh: () => null }));

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
  mocks.hasOA = true;
  mocks.config = { communityPublicPreview: false };
  mocks.getCategories.mockResolvedValue(CATS);
  mocks.getFeed.mockResolvedValue({ posts: [POST('p1', 'Lan Anh'), POST('p2', 'Minh Tâm')], nextCursor: null });
  mocks.getPreview.mockResolvedValue({ posts: [] });
});

describe('FeedPage — chỉ đọc theo chính sách Zalo (4.1, 4.6)', () => {
  it('không có nút Đăng bài, Xếp hạng, ô soạn bài', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    expect(screen.queryByRole('button', { name: 'Đăng bài' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Xếp hạng/ })).toBeNull();
    expect(screen.queryByTestId('composer')).toBeNull();
    expect(screen.queryByRole('button', { name: /thích/i })).toBeNull();
  });

  it('thẻ bài không hiện số thích, vẫn hiện số trả lời', async () => {
    mocks.getFeed.mockResolvedValue({ posts: [{ ...POST('p1', 'Lan Anh'), likeCount: 37, commentCount: 5 }], nextCursor: null });
    renderPage();
    await screen.findByText('Lan Anh');
    expect(screen.queryByText('37')).toBeNull();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('không vẽ chip Facebook, TikTok, nhóm Zalo dù admin đã cấu hình link', async () => {
    mocks.config = { community: { zaloGroupUrl: 'https://zalo.me/g/abc', facebookUrl: 'https://facebook.com/x', tiktokUrl: 'https://tiktok.com/x' } };
    renderPage();
    await screen.findByText('Lan Anh');
    for (const name of ['Nhóm Zalo', 'Facebook', 'TikTok']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Kênh cộng đồng của Tubu Tree' })).toBeNull();
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('khách chưa đăng nhập cũng không thấy kênh ngoài', () => {
    mocks.auth.status = 'anonymous';
    mocks.config = { community: { facebookUrl: 'https://facebook.com/tubutree' } };
    renderPage();
    expect(screen.queryByRole('button', { name: 'Facebook' })).toBeNull();
  });

  it('nút "Hỏi Tubu" mở chat OA; không có OA thì không vẽ nút', async () => {
    const view = renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(screen.getByRole('button', { name: 'Hỏi Tubu' }));
    expect(mocks.openOAChat).toHaveBeenCalledTimes(1);
    view.unmount();
    mocks.hasOA = false;
    renderPage();
    await screen.findByText('Lan Anh');
    expect(screen.queryByRole('button', { name: 'Hỏi Tubu' })).toBeNull();
  });
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
    fireEvent.click(screen.getByRole('button', { name: 'Nội dung p1' }));
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

  it('nút Sự kiện điều hướng', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    fireEvent.click(screen.getByRole('button', { name: 'Sự kiện' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/feed/events');
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

  it('nút Sự kiện, Hỏi Tubu và chip có vùng chạm >= 44px', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    for (const name of ['Sự kiện', 'Hỏi Tubu']) {
      const btn = screen.getByRole('button', { name });
      expect(Number.parseFloat(btn.style.minWidth)).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
    expect(screen.getByRole('button', { name: 'Nổi bật' }).className).toContain('tubu-hit-44');
  });

  it('nút Sự kiện có chữ nhìn thấy, không chỉ là biểu tượng (D6-05)', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    expect(screen.getByRole('button', { name: 'Sự kiện' }).textContent?.trim()).toBe('Sự kiện');
  });

  it('đã đăng nhập: không còn câu phụ đề dưới tiêu đề để bài đầu lên sớm hơn (D6-05)', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    expect(screen.queryByText(/Hỏi đáp cách dùng/)).toBeNull();
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

describe('FeedPage — bảng tin trống không mời đăng bài', () => {
  it('chưa có bài nào, không lọc: không có nút đăng bài đầu tiên', async () => {
    mocks.getFeed.mockResolvedValue({ posts: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText('Chưa có bài viết nào')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đăng bài đầu tiên' })).toBeNull();
    expect(screen.queryByText(/người đầu tiên/)).toBeNull();
  });

  it('đang lọc/tìm mà không có kết quả: hiện "Không tìm thấy bài phù hợp"', async () => {
    mocks.getFeed.mockResolvedValue({ posts: [], nextCursor: null });
    renderPage();
    await screen.findByText('Chưa có bài viết nào');
    fireEvent.click(screen.getByRole('button', { name: 'Chưa trả lời' }));
    expect(await screen.findByText('Không tìm thấy bài phù hợp')).toBeInTheDocument();
  });
});

const PREVIEW_POST = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'TIP',
  title: 'Pha nước rửa chén từ vỏ bưởi',
  snippet: 'Vỏ bưởi ngâm giấm 2 tuần rồi lọc, dùng rất sạch dầu mỡ.',
  image: null,
  createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
  author: 'Lan',
  badge: null,
  category: { slug: 'meo-vat', name: 'Mẹo vặt', icon: null },
  isPinned: false,
  likeCount: 4,
  commentCount: 2,
  ...over,
});

describe('FeedPage — xem trước công khai khi chưa đăng nhập (D5-07, cờ community.public_preview)', () => {
  beforeEach(() => {
    mocks.auth.status = 'anonymous';
  });

  it('cờ tắt (mặc định): cổng đăng nhập như cũ và không gọi API xem trước', async () => {
    mocks.config = {};
    renderPage();
    expect(screen.getByText('Đăng nhập để xem cộng đồng')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getPreview).not.toHaveBeenCalled());
    expect(mocks.getFeed).not.toHaveBeenCalled();
  });

  it('cờ bật: hiện vài bài (tên gọi, đoạn đầu), chỉ đọc; nút đăng nhập gọi login; không tải feed đầy đủ', async () => {
    mocks.config = { communityPublicPreview: true };
    mocks.getPreview.mockResolvedValue({ posts: [PREVIEW_POST('p1'), PREVIEW_POST('p2', { title: null, snippet: 'Cây trầu bà lên lá rất nhanh', author: 'Minh' })] });
    const view = renderPage();
    expect(await screen.findByText('Pha nước rửa chén từ vỏ bưởi')).toBeInTheDocument();
    expect(screen.getByText('Vỏ bưởi ngâm giấm 2 tuần rồi lọc, dùng rất sạch dầu mỡ.')).toBeInTheDocument();
    expect(screen.getByText('Cây trầu bà lên lá rất nhanh')).toBeInTheDocument();
    expect(screen.getByText('Lan')).toBeInTheDocument();
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Đăng bài' })).toBeNull();
    expect(screen.queryByPlaceholderText('Tìm câu hỏi, mẹo, bài viết…')).toBeNull();
    expect(mocks.getFeed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục với Zalo' }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });

  it('bài xem trước không có nút thích/bình luận/mở bài: đọc xong chỉ có lối đăng nhập', async () => {
    mocks.config = { communityPublicPreview: true };
    mocks.getPreview.mockResolvedValue({ posts: [PREVIEW_POST('p1')] });
    renderPage();
    await screen.findByText('Pha nước rửa chén từ vỏ bưởi');
    // Nút không chữ (quay lại ở đầu trang) không tính: chỉ xét các nút có nhãn.
    expect(screen.getAllByRole('button').map((b) => b.textContent).filter(Boolean)).toEqual(['Tiếp tục với Zalo']);
    expect(screen.queryByRole('link')).toBeNull();
    mocks.navigate.mockClear();
    fireEvent.click(screen.getByText('Pha nước rửa chén từ vỏ bưởi'));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('xem trước lỗi hoặc chưa có bài nào: về cổng đăng nhập thay vì báo lỗi cho khách chưa đăng nhập', async () => {
    mocks.config = { communityPublicPreview: true };
    mocks.getPreview.mockRejectedValue(new Error('404'));
    const failed = renderPage();
    expect(await screen.findByText('Đăng nhập để xem cộng đồng')).toBeInTheDocument();
    failed.unmount();

    mocks.getPreview.mockResolvedValue({ posts: [] });
    renderPage();
    expect(await screen.findByText('Đăng nhập để xem cộng đồng')).toBeInTheDocument();
  });

  it('đang tải xem trước: khung chờ, chưa hiện cổng đăng nhập để khỏi nháy', () => {
    mocks.config = { communityPublicPreview: true };
    mocks.getPreview.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.queryByText('Đăng nhập để xem cộng đồng')).toBeNull();
    expect(screen.getByTestId('feed-preview-loading')).toBeInTheDocument();
  });

  // Bài vi phạm đã gỡ không được nằm lại trong bộ nhớ đệm của khách quá lâu: API cache 60 giây, bộ nhớ đệm máy khách không dài hơn.
  it('xem trước chỉ tươi tối đa 60 giây: trong 10 giây mở lại dùng bản cũ, sau 61 giây tải lại', async () => {
    mocks.config = { communityPublicPreview: true };
    mocks.getPreview.mockResolvedValue({ posts: [PREVIEW_POST('p1')] });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const mount = () =>
        render(
          <QueryClientProvider client={qc}>
            <FeedPage />
          </QueryClientProvider>,
        );

      const first = mount();
      await screen.findByText('Pha nước rửa chén từ vỏ bưởi');
      first.unmount();
      expect(mocks.getPreview).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 10_000);
      const soon = mount();
      await screen.findByText('Pha nước rửa chén từ vỏ bưởi');
      soon.unmount();
      expect(mocks.getPreview).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 61_000);
      mount();
      await waitFor(() => expect(mocks.getPreview).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('đã đăng nhập thì không bao giờ gọi API xem trước', async () => {
    mocks.auth.status = 'authenticated';
    mocks.config = { communityPublicPreview: true };
    renderPage();
    await screen.findByText('Lan Anh');
    expect(mocks.getPreview).not.toHaveBeenCalled();
  });
});
