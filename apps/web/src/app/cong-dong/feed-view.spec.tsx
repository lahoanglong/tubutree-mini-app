// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { FeedItem, FeedPreviewItem } from '@tubutree/app-core/api/feed';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Chép ý feed.spec.tsx (Mini App): kênh cộng đồng, cổng đăng nhập, danh sách + lọc (sắp xếp, danh mục, chưa trả lời, tìm, thẻ),
// trống/lỗi/phân trang, một h1 ở mọi trạng thái, xem trước công khai cho khách. Điều hướng là liên kết thật nên kiểm href.

const mocks = vi.hoisted(() => ({
  auth: { user: null as Record<string, unknown> | null, status: 'authenticated' as string, initialized: true, sessionUnavailable: false, retrySession: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
  search: '',
  replace: vi.fn(),
  ready: new Set<string>(['/cong-dong/xep-hang']),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => mocks.ready.has(p) }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  usePathname: () => '/cong-dong',
}));
vi.mock('./use-debounced', () => ({ useDebounced: <T,>(v: T) => v }));
vi.mock('@/components/community/use-debounced', () => ({ useDebounced: <T,>(v: T) => v }));
vi.mock('@/components/community/post-composer', () => ({
  PostComposer: ({ open, onPosted }: { open: boolean; onPosted: (m: string) => void }) =>
    open ? (
      <div data-testid="composer">
        <button type="button" onClick={() => onPosted('Đã đăng bài 🌿')}>
          stub-dang-xong
        </button>
      </div>
    ) : null,
}));

import { FeedView } from './feed-view';

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
const PREVIEW = (id: string, over: Partial<FeedPreviewItem> = {}): FeedPreviewItem => ({
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

let config: Record<string, unknown> = {};
let feedImpl: (q: Record<string, unknown>) => unknown;
let previewImpl: () => unknown;

let mounted: Rendered[] = [];
const mount = async (props: Partial<Parameters<typeof FeedView>[0]> = {}) => {
  const r = render(<FeedView {...props} />);
  mounted.push(r);
  await flush(6);
  return r;
};
const feedCalls = () => mocks.get.mock.calls.filter((c) => c[0] === '/feed');
const lastFeedArgs = () => feedCalls().at(-1)![1].query;
const btn = (c: HTMLElement, text: string) => byText(c, 'button', text) as HTMLButtonElement;
const exact = (c: HTMLElement, sel: string, text: string) => Array.from(c.querySelectorAll<HTMLElement>(sel)).find((e) => e.textContent?.trim() === text)!;
const h1 = (c: HTMLElement) => c.querySelectorAll('h1').length;
const searchInput = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[placeholder="Tìm câu hỏi, mẹo, bài viết…"]')!;

beforeEach(() => {
  mocks.auth.status = 'authenticated';
  mocks.auth.initialized = true;
  mocks.auth.sessionUnavailable = false;
  mocks.search = '';
  mocks.replace.mockReset();
  mocks.ready = new Set(['/cong-dong/xep-hang']);
  config = { communityPublicPreview: false };
  feedImpl = () => ({ posts: [POST('p1', 'Lan Anh'), POST('p2', 'Minh Tâm')], nextCursor: null });
  previewImpl = () => ({ posts: [] });
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: Record<string, unknown> }) => {
    if (path === '/feed') return feedImpl(opts?.query ?? {});
    if (path === '/feed/categories') return CATS;
    if (path === '/feed/public-preview') return previewImpl();
    if (path === '/config/public') return config;
    throw new Error(`no mock ${path}`);
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('FeedView — kênh cộng đồng của chủ shop', () => {
  it('chưa cấu hình link: không vẽ nhóm kênh', async () => {
    const { container } = await mount();
    expect(container.querySelector('[role="group"][aria-label="Kênh cộng đồng của Tubu Tree"]')).toBeNull();
  });

  it('chỉ hiện kênh có link https, mở ở tab mới', async () => {
    config = { community: { zaloGroupUrl: 'https://zalo.me/g/abc', facebookUrl: null, tiktokUrl: 'http://tiktok.com/x' } };
    const { container } = await mount();
    const links = Array.from(container.querySelectorAll('[aria-label="Kênh cộng đồng của Tubu Tree"] a'));
    expect(links.map((a) => a.textContent)).toEqual(['Nhóm Zalo']);
    expect(links[0]!.getAttribute('href')).toBe('https://zalo.me/g/abc');
    expect(links[0]!.getAttribute('target')).toBe('_blank');
    expect(links[0]!.getAttribute('rel')).toContain('noopener');
  });

  it('khách chưa đăng nhập vẫn thấy kênh ở màn cổng đăng nhập', async () => {
    mocks.auth.status = 'idle';
    config = { community: { facebookUrl: 'https://facebook.com/tubutree' } };
    const { container } = await mount();
    expect(container.textContent).toContain('Facebook');
  });
});

describe('FeedView — đã đăng nhập', () => {
  it('chưa đăng nhập: cổng đăng nhập có link, không tải bài', async () => {
    mocks.auth.status = 'idle';
    const { container } = await mount();
    expect(container.textContent).toContain('Đăng nhập để xem cộng đồng');
    expect(container.querySelector('a[href="/dang-nhap?returnTo=%2Fcong-dong"]')).not.toBeNull();
    expect(feedCalls()).toHaveLength(0);
  });

  it('đang khôi phục phiên: không hiện cổng đăng nhập và không tải bài', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.initialized = false;
    const { container } = await mount();
    expect(container.textContent).not.toContain('Đăng nhập để xem cộng đồng');
    expect(feedCalls()).toHaveLength(0);
  });

  it('cờ phiên còn mà API không trả lời: nói mất kết nối, không mời đăng nhập lại', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.sessionUnavailable = true;
    const { container } = await mount();
    expect(container.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(container.textContent).not.toContain('Đăng nhập để xem cộng đồng');
  });

  it('tải bài mới nhất, hiện danh sách, mỗi thẻ mở /cong-dong/:id', async () => {
    const { container } = await mount();
    expect(container.textContent).toContain('Lan Anh');
    expect(container.textContent).toContain('Minh Tâm');
    expect(lastFeedArgs()).toEqual({ category: undefined, sort: 'new', cursor: undefined, q: undefined, unanswered: undefined, tag: undefined });
    expect(container.querySelector('a[href="/cong-dong/p1"]')?.textContent).toBe('Nội dung p1');
  });

  it('chip sắp xếp, danh mục, chưa trả lời đổi tham số truy vấn', async () => {
    const { container } = await mount();
    click(btn(container, 'Nổi bật'));
    await flush();
    expect(lastFeedArgs()).toMatchObject({ sort: 'popular' });
    click(btn(container, 'Nhà bếp'));
    await flush();
    expect(lastFeedArgs()).toMatchObject({ category: 'bep' });
    click(btn(container, 'Chưa trả lời'));
    await flush();
    expect(lastFeedArgs()).toMatchObject({ unanswered: true });
    click(exact(container, 'button', 'Tất cả'));
    await flush();
    expect(lastFeedArgs()).toMatchObject({ category: undefined });
  });

  it('gõ vào ô tìm kiếm gửi q; có nút xoá khi đã gõ; ô nằm trong form role=search', async () => {
    const { container } = await mount();
    expect(container.querySelector('[role="search"]')).not.toBeNull();
    typeInto(searchInput(container), 'sen đá');
    await flush();
    expect(lastFeedArgs()).toMatchObject({ q: 'sen đá' });
    click(container.querySelector('button[aria-label="Xoá từ khoá"]'));
    await flush();
    expect(lastFeedArgs()).toMatchObject({ q: undefined });
  });

  it('liên kết Bảng xếp hạng; Sự kiện ẩn khi route chưa xong, hiện khi xong; nút Đăng bài mở khung soạn', async () => {
    const { container } = await mount();
    expect(container.querySelector('a[aria-label="Bảng xếp hạng"]')?.getAttribute('href')).toBe('/cong-dong/xep-hang');
    expect(container.querySelector('a[aria-label="Sự kiện"]')).toBeNull();
    expect(container.querySelector('[data-testid="composer"]')).toBeNull();
    click(exact(container, 'button', 'Đăng bài'));
    expect(document.body.querySelector('[data-testid="composer"]')).not.toBeNull();
  });

  it('Sự kiện hiện khi route sự kiện đã xong', async () => {
    mocks.ready.add('/cong-dong/su-kien');
    const { container } = await mount();
    expect(container.querySelector('a[aria-label="Sự kiện"]')?.getAttribute('href')).toBe('/cong-dong/su-kien');
  });

  it('đăng xong: đóng khung soạn, tải lại bảng tin và hiện câu thông báo', async () => {
    const { container } = await mount();
    click(exact(container, 'button', 'Đăng bài'));
    const before = feedCalls().length;
    click(byText(document.body, 'button', 'stub-dang-xong'));
    await flush();
    expect(document.body.querySelector('[data-testid="composer"]')).toBeNull();
    expect(feedCalls().length).toBeGreaterThan(before);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Đã đăng bài 🌿');
  });

  it('mở từ thẻ hashtag (?tag=…&tagName=…): lọc theo thẻ, hiện nhãn, bấm nhãn để bỏ lọc', async () => {
    mocks.search = '?tag=da-nhay-cam&tagName=da%20nh%E1%BA%A1y%20c%E1%BA%A3m';
    const { container } = await mount();
    const pill = container.querySelector<HTMLButtonElement>('button[aria-label="Bỏ lọc thẻ"]')!;
    expect(pill.textContent).toContain('da nhạy cảm');
    expect(lastFeedArgs()).toMatchObject({ tag: 'da-nhay-cam' });
    click(pill);
    await flush();
    expect(mocks.replace).toHaveBeenCalledWith('/cong-dong');
    expect(container.querySelector('button[aria-label="Bỏ lọc thẻ"]')).toBeNull();
    expect(lastFeedArgs()).toMatchObject({ tag: undefined });
  });

  it('không có bài: không lọc thì "Chưa có bài viết nào" kèm "Đăng bài đầu tiên"; đang lọc thì "Không tìm thấy bài phù hợp" không mời đăng', async () => {
    feedImpl = () => ({ posts: [], nextCursor: null });
    const { container } = await mount();
    expect(container.textContent).toContain('Chưa có bài viết nào');
    expect(container.textContent).toContain('Hãy là người đầu tiên chia sẻ hoặc đặt câu hỏi!');
    click(btn(container, 'Chưa trả lời'));
    await flush();
    expect(container.textContent).toContain('Không tìm thấy bài phù hợp');
    expect(byText(container, 'button', 'Đăng bài đầu tiên')).toBeNull();
    click(btn(container, 'Chưa trả lời'));
    await flush();
    click(btn(container, 'Đăng bài đầu tiên'));
    expect(document.body.querySelector('[data-testid="composer"]')).not.toBeNull();
  });

  it('lỗi tải: báo lỗi và Thử lại tải lại', async () => {
    let n = 0;
    feedImpl = () => {
      if (n++ === 0) throw new Error('mất mạng');
      return { posts: [POST('p1', 'Lan Anh')], nextCursor: null };
    };
    const { container } = await mount();
    expect(container.textContent).toContain('mất mạng');
    click(btn(container, 'Thử lại'));
    await flush();
    expect(container.textContent).toContain('Lan Anh');
  });

  it('phân trang: "Xem thêm" nạp trang kế bằng cursor', async () => {
    let n = 0;
    feedImpl = () => (n++ === 0 ? { posts: [POST('p1', 'Lan Anh')], nextCursor: 'cur-2' } : { posts: [POST('p3', 'Hà My')], nextCursor: null });
    const { container } = await mount();
    click(btn(container, 'Xem thêm'));
    await flush();
    expect(container.textContent).toContain('Hà My');
    expect(lastFeedArgs()).toMatchObject({ cursor: 'cur-2' });
    expect(byText(container, 'button', 'Xem thêm')).toBeNull();
  });

  it('đúng một h1 "Cộng đồng Vườn Tubu" ở mọi trạng thái', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.initialized = false;
    expect(h1((await mount()).container)).toBe(1);
    mocks.auth.initialized = true;
    expect(h1((await mount()).container)).toBe(1);
    mocks.auth.status = 'authenticated';
    const loaded = await mount();
    expect(h1(loaded.container)).toBe(1);
    expect(loaded.container.querySelector('h1')!.textContent).toBe('Cộng đồng Vườn Tubu');
    feedImpl = () => {
      throw new Error('x');
    };
    expect(h1((await mount()).container)).toBe(1);
  });

  it('vùng chạm 44px và tên truy cập; nhãn lọc thẻ không dùng ký tự ✕', async () => {
    mocks.search = '?tag=a&tagName=a';
    const { container } = await mount();
    expect(smallTouchTargets(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
    expect(container.textContent).not.toContain('✕');
    expect(btn(container, 'Nổi bật').getAttribute('aria-pressed')).toBe('false');
  });

  it('nội dung người dùng không thành HTML', async () => {
    feedImpl = () => ({ posts: [{ ...POST('p1', '<b>Lan</b>'), body: '<img src=x onerror=alert(1)>' }], nextCursor: null });
    const { container } = await mount();
    expect(container.querySelectorAll('img[src="x"], b')).toHaveLength(0);
    expect(container.textContent).toContain('<b>Lan</b>');
  });
});

describe('FeedView — xem trước công khai khi chưa đăng nhập (cờ community.public_preview)', () => {
  beforeEach(() => {
    mocks.auth.status = 'idle';
  });

  it('cờ tắt: cổng đăng nhập như cũ và không gọi API xem trước', async () => {
    const { container } = await mount();
    expect(container.textContent).toContain('Đăng nhập để xem cộng đồng');
    expect(mocks.get.mock.calls.filter((c) => c[0] === '/feed/public-preview')).toHaveLength(0);
    expect(feedCalls()).toHaveLength(0);
  });

  it('server đã nạp bài: hiện ngay (tên gọi, đoạn đầu, số tim/bình luận), chỉ đọc, nút đăng nhập; không tải feed đầy đủ', async () => {
    config = { communityPublicPreview: true };
    const { container } = await mount({ initialPreview: [PREVIEW('p1'), PREVIEW('p2', { title: null, snippet: 'Cây trầu bà lên lá rất nhanh', author: 'Minh' })] });
    expect(container.textContent).toContain('Pha nước rửa chén từ vỏ bưởi');
    expect(container.textContent).toContain('Vỏ bưởi ngâm giấm 2 tuần rồi lọc, dùng rất sạch dầu mỡ.');
    expect(container.textContent).toContain('Cây trầu bà lên lá rất nhanh');
    expect(h1(container)).toBe(1);
    expect(byText(container, 'button', 'Đăng bài')).toBeNull();
    expect(searchInput(container)).toBeNull();
    expect(feedCalls()).toHaveLength(0);
    expect(container.querySelector('a[href="/dang-nhap?returnTo=%2Fcong-dong"]')?.textContent).toBe('Đăng nhập với Zalo');
  });

  it('bài xem trước không có nút thích/bình luận/mở bài: chỉ có lối đăng nhập', async () => {
    config = { communityPublicPreview: true };
    const { container } = await mount({ initialPreview: [PREVIEW('p1')] });
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/dang-nhap?returnTo=%2Fcong-dong']);
  });

  it('server chưa nạp được: tự tải ở trình duyệt, có khung chờ rồi hiện bài', async () => {
    config = { communityPublicPreview: true };
    let release!: () => void;
    previewImpl = () => new Promise((res) => (release = () => res({ posts: [PREVIEW('p1')] })));
    const { container } = await mount();
    expect(container.querySelector('[data-testid="feed-preview-loading"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Đăng nhập để xem cộng đồng');
    await act(async () => release());
    await flush();
    expect(container.textContent).toContain('Pha nước rửa chén từ vỏ bưởi');
  });

  it('xem trước lỗi hoặc không có bài: về cổng đăng nhập, không báo lỗi cho khách', async () => {
    config = { communityPublicPreview: true };
    previewImpl = () => {
      throw new Error('404');
    };
    expect((await mount()).container.textContent).toContain('Đăng nhập để xem cộng đồng');
    expect((await mount({ initialPreview: [] })).container.textContent).toContain('Đăng nhập để xem cộng đồng');
  });

  it('đã đăng nhập thì không bao giờ dùng/gọi xem trước', async () => {
    mocks.auth.status = 'authenticated';
    config = { communityPublicPreview: true };
    const { container } = await mount({ initialPreview: [PREVIEW('p1')] });
    expect(container.textContent).toContain('Lan Anh');
    expect(container.textContent).not.toContain('Pha nước rửa chén từ vỏ bưởi');
    expect(mocks.get.mock.calls.filter((c) => c[0] === '/feed/public-preview')).toHaveLength(0);
  });
});
