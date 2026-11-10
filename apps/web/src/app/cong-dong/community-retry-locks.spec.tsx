// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CommunityEvent, FeedComment, FeedItem } from '@tubutree/app-core/api/feed';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Bảng tin, chi tiết bài và Sự kiện cộng đồng (Mini ↔ web, Wave 74A ↔ 94B): "Xem thêm" trả Promise nên nút khoá (aria-busy, không disabled) tới khi lượt tải xong.
// Hai cú chạm sát nhau (cùng một lần act, trước khi React vẽ lại) chỉ gửi MỘT lượt tải: `isFetchingNextPage` chỉ đúng sau lần vẽ kế, còn `fetchNextPage`
// mặc định huỷ lượt đang chạy rồi gửi lại nên cú thứ hai làm một yêu cầu thừa. "Thử lại" thì khác: truy vấn lỗi chưa có dữ liệu bị `refetch()` đưa về
// trạng thái đang tải, màn vẽ khung xương thay nút (Mini cũng vậy), nên chỉ kiểm chạm đúp vẫn một lần gọi và nội dung hiện khi dữ liệu về.

const h = vi.hoisted(() => ({
  auth: { user: { id: 'u1', role: 'CUSTOMER' } as Record<string, unknown> | null, status: 'authenticated', initialized: true, sessionUnavailable: false, retrySession: vi.fn() },
  params: { id: 'p1' },
  get: vi.fn(),
  post: vi.fn(),
  handlers: {} as Record<string, (query?: Record<string, unknown>) => unknown>,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => h.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: h.get, post: h.post, patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: () => false }));
vi.mock('next/navigation', () => ({
  useParams: () => h.params,
  usePathname: () => '/cong-dong',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/components/community/use-debounced', () => ({ useDebounced: <T,>(v: T) => v }));
vi.mock('@/components/community/post-card', () => ({
  PostCard: ({ post }: { post: FeedItem }) => <a href={`/cong-dong/${post.id}`}>{`Bài ${post.id}`}</a>,
}));
vi.mock('@/components/community/post-composer', () => ({ PostComposer: () => null }));

import { FeedView } from './feed-view';
import PostDetailPage from './[id]/page';
import CommunityEventsPage from './su-kien/page';

const POST = (id: string): FeedItem => ({
  id, kind: 'TIP', status: 'APPROVED', title: null, body: `Nội dung ${id}`, images: [], meta: null, createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
  author: 'Lan Anh', badge: null, authorLevel: 1, category: null, productTags: [], tags: [], isPinned: false, likeCount: 0, commentCount: 0, liked: false,
  bestCommentId: null, isOwner: false,
});
const COMMENT = (id: string): FeedComment => ({
  id, body: `Trả lời ${id}`, author: 'Bình', badge: null, authorLevel: 1, isAccepted: false, createdAt: new Date(Date.now() - 3600 * 1000).toISOString(), isOwner: false,
});
const EVENT: CommunityEvent = {
  id: 'e1', title: 'Sự kiện e1', description: null, coverUrl: null, startAt: new Date(Date.now() - 86_400_000).toISOString(),
  endAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), rewardPoints: 5, status: 'ACTIVE', winnerUserId: null, createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
};

const gate = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
/** Lần gọi đầu thất bại, lần sau trả `then` (hàm thì gọi để lấy giá trị/Promise treo). */
const failThen = (then: () => unknown) => {
  let n = 0;
  return () => {
    if (n++ === 0) throw new Error('mất mạng');
    return then();
  };
};

let mounted: Rendered | null = null;
const mount = async (ui: React.ReactElement) => {
  mounted = render(ui);
  await flush(6);
  return mounted.container;
};
const callsTo = (path: string, match?: (q: Record<string, unknown>) => boolean) =>
  h.get.mock.calls.filter((c) => c[0] === path && (!match || match((c[1] as { query?: Record<string, unknown> } | undefined)?.query ?? {}))).length;
const btn = (c: HTMLElement, text: string | RegExp) => byText(c, 'button', text) as HTMLButtonElement;
/**
 * Truy vấn lỗi mà chưa có dữ liệu: `refetch()` đưa về trạng thái đang tải (`isLoading`) và màn vẽ khung xương trước khi xét lỗi (Mini cũng vậy),
 * nên nút "Thử lại" biến khỏi trang trong lúc tải và không còn gì để chạm lần hai.
 */
const expectReplacedBySkeleton = (c: HTMLElement, retry: HTMLElement) => {
  expect(retry.isConnected).toBe(false);
  expect(byText(c, 'button', 'Thử lại')).toBeNull();
};
const tapTogether = (...els: HTMLElement[]) =>
  act(async () => {
    for (const e of els) e.click();
  });

beforeEach(() => {
  Object.assign(h.auth, { user: { id: 'u1', role: 'CUSTOMER' }, status: 'authenticated', initialized: true, sessionUnavailable: false });
  h.params.id = 'p1';
  h.handlers = {
    '/feed': () => ({ posts: [POST('p1')], nextCursor: null }),
    '/feed/categories': () => [],
    '/config/public': () => ({ communityPublicPreview: false }),
    '/feed/p1': () => POST('p1'),
    '/feed/p1/comments': () => ({ items: [COMMENT('c1')], nextCursor: null }),
    '/feed/events': () => [EVENT],
    '/feed/events/e1/posts': () => ({ posts: [POST('p1')], nextCursor: null }),
  };
  h.post.mockReset().mockResolvedValue({ liked: true });
  h.get.mockReset().mockImplementation(async (path: string, opts?: { query?: Record<string, unknown> }) => {
    const handler = h.handlers[path];
    if (!handler) throw new Error(`no mock ${path}`);
    return handler(opts?.query);
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('Bảng tin cộng đồng: Thử lại và Xem thêm khoá cùng khung hình', () => {
  it('lỗi tải: hai cú chạm Thử lại cùng khung hình chỉ tải lại một lần; khung xương thay nút lúc tải (như Mini), bài về thì hiện', async () => {
    const reloaded = gate<unknown>();
    h.handlers['/feed'] = failThen(() => reloaded.promise);
    const c = await mount(<FeedView />);
    expect(callsTo('/feed')).toBe(1);
    const retry = btn(c, 'Thử lại');
    await tapTogether(retry, retry);
    await flush(2);
    expect(callsTo('/feed')).toBe(2);
    expectReplacedBySkeleton(c, retry);
    reloaded.resolve({ posts: [POST('p9')], nextCursor: null });
    await flush(6);
    expect(c.textContent).toContain('Bài p9');
  });

  it('Xem thêm: hai cú chạm cùng khung hình chỉ nạp trang kế một lần', async () => {
    const next = gate<unknown>();
    h.handlers['/feed'] = (q) => (q?.cursor === 'cur-2' ? next.promise : { posts: [POST('p1')], nextCursor: 'cur-2' });
    const c = await mount(<FeedView />);
    const more = btn(c, 'Xem thêm');
    act(() => {
      more.click();
      more.click();
    });
    // Ngay sau cú chạm (trước khi truy vấn kịp báo `isFetchingNextPage`): nút đã báo bận bằng aria, không disabled.
    expect(more.getAttribute('aria-busy')).toBe('true');
    expect(more.getAttribute('aria-disabled')).toBe('true');
    expect(more.disabled).toBe(false);
    await flush(2);
    expect(callsTo('/feed', (q) => q.cursor === 'cur-2')).toBe(1);
    next.resolve({ posts: [POST('p3')], nextCursor: null });
    await flush(6);
    expect(c.textContent).toContain('Bài p3');
    expect(byText(c, 'button', 'Xem thêm')).toBeNull();
  });
});

describe('Chi tiết bài cộng đồng: Thử lại và Xem thêm trả lời khoá cùng khung hình', () => {
  it('lỗi tải bài: hai cú chạm Thử lại cùng khung hình chỉ tải lại một lần; khung xương thay nút lúc tải, bài về thì hiện', async () => {
    const reloaded = gate<unknown>();
    h.handlers['/feed/p1'] = failThen(() => reloaded.promise);
    const c = await mount(<PostDetailPage />);
    expect(callsTo('/feed/p1')).toBe(1);
    const retry = btn(c, 'Thử lại');
    await tapTogether(retry, retry);
    await flush(2);
    expect(callsTo('/feed/p1')).toBe(2);
    expectReplacedBySkeleton(c, retry);
    reloaded.resolve(POST('p1'));
    await flush(6);
    expect(c.textContent).toContain('Nội dung p1');
  });

  it('lỗi tải trả lời: hai cú chạm Thử lại cùng khung hình chỉ tải lại một lần; khung xương thay nút lúc tải, trả lời về thì hiện', async () => {
    const reloaded = gate<unknown>();
    h.handlers['/feed/p1/comments'] = failThen(() => reloaded.promise);
    const c = await mount(<PostDetailPage />);
    expect(callsTo('/feed/p1/comments')).toBe(1);
    const retry = btn(c, 'Thử lại');
    await tapTogether(retry, retry);
    await flush(2);
    expect(callsTo('/feed/p1/comments')).toBe(2);
    expectReplacedBySkeleton(c, retry);
    reloaded.resolve({ items: [COMMENT('c7')], nextCursor: null });
    await flush(6);
    expect(c.textContent).toContain('Trả lời c7');
  });

  it('Xem thêm trả lời: hai cú chạm cùng khung hình chỉ nạp trang kế một lần', async () => {
    const next = gate<unknown>();
    h.handlers['/feed/p1/comments'] = (q) => (q?.cursor === 'cur-2' ? next.promise : { items: [COMMENT('c1')], nextCursor: 'cur-2' });
    const c = await mount(<PostDetailPage />);
    const more = btn(c, 'Xem thêm trả lời');
    act(() => {
      more.click();
      more.click();
    });
    // Ngay sau cú chạm (trước khi truy vấn kịp báo `isFetchingNextPage`): nút đã báo bận bằng aria, không disabled.
    expect(more.getAttribute('aria-busy')).toBe('true');
    expect(more.getAttribute('aria-disabled')).toBe('true');
    expect(more.disabled).toBe(false);
    await flush(2);
    expect(callsTo('/feed/p1/comments', (q) => q.cursor === 'cur-2')).toBe(1);
    next.resolve({ items: [COMMENT('c8')], nextCursor: null });
    await flush(6);
    expect(c.textContent).toContain('Trả lời c8');
  });
});

describe('Sự kiện cộng đồng: Thử lại và Xem thêm bài dự thi khoá cùng khung hình', () => {
  const openEvent = async (c: HTMLElement) => {
    click(btn(c, 'Sự kiện e1'));
    await flush(6);
  };

  it('lỗi tải danh sách: hai cú chạm Thử lại cùng khung hình chỉ tải lại một lần; khung xương thay nút lúc tải, sự kiện về thì hiện', async () => {
    const reloaded = gate<unknown>();
    h.handlers['/feed/events'] = failThen(() => reloaded.promise);
    const c = await mount(<CommunityEventsPage />);
    expect(callsTo('/feed/events')).toBe(1);
    const retry = btn(c, 'Thử lại');
    await tapTogether(retry, retry);
    await flush(2);
    expect(callsTo('/feed/events')).toBe(2);
    expectReplacedBySkeleton(c, retry);
    reloaded.resolve([EVENT]);
    await flush(6);
    expect(c.textContent).toContain('Sự kiện e1');
  });

  it('lỗi tải bài dự thi: hai cú chạm Thử lại cùng khung hình chỉ tải lại một lần; khung xương thay nút lúc tải, bài về thì hiện', async () => {
    const reloaded = gate<unknown>();
    h.handlers['/feed/events/e1/posts'] = failThen(() => reloaded.promise);
    const c = await mount(<CommunityEventsPage />);
    await openEvent(c);
    expect(callsTo('/feed/events/e1/posts')).toBe(1);
    const retry = btn(c, 'Thử lại');
    await tapTogether(retry, retry);
    await flush(2);
    expect(callsTo('/feed/events/e1/posts')).toBe(2);
    expectReplacedBySkeleton(c, retry);
    reloaded.resolve({ posts: [POST('p5')], nextCursor: null });
    await flush(6);
    expect(c.textContent).toContain('Bài p5');
  });

  it('Xem thêm bài dự thi: hai cú chạm cùng khung hình chỉ nạp trang kế một lần', async () => {
    const next = gate<unknown>();
    h.handlers['/feed/events/e1/posts'] = (q) => (q?.cursor === 'cur-2' ? next.promise : { posts: [POST('p1')], nextCursor: 'cur-2' });
    const c = await mount(<CommunityEventsPage />);
    await openEvent(c);
    const more = btn(c, 'Xem thêm bài dự thi');
    act(() => {
      more.click();
      more.click();
    });
    // Ngay sau cú chạm (trước khi truy vấn kịp báo `isFetchingNextPage`): nút đã báo bận bằng aria, không disabled.
    expect(more.getAttribute('aria-busy')).toBe('true');
    expect(more.getAttribute('aria-disabled')).toBe('true');
    expect(more.disabled).toBe(false);
    await flush(2);
    expect(callsTo('/feed/events/e1/posts', (q) => q.cursor === 'cur-2')).toBe(1);
    next.resolve({ posts: [POST('p6')], nextCursor: null });
    await flush(6);
    expect(c.textContent).toContain('Bài p6');
  });
});

describe('Xem thêm: dựng lại màn trong lúc trang kế còn tải (khoá mới, truy vấn vẫn đang chạy)', () => {
  // Rời màn rồi quay lại: nút dựng lại với khoá mới (ref trống) nhưng lượt nạp trang kế cũ còn chạy trong bộ nhớ đệm. `fetchNextPage` mặc định
  // huỷ lượt đang chạy rồi gửi lại, nên chạm vào nút "Đang tải…" phải bị bỏ qua thay vì gửi thêm một yêu cầu.
  const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const remount = async (client: QueryClient, ui: React.ReactElement) => {
    act(() => mounted!.root.render(<QueryClientProvider client={client}>{null}</QueryClientProvider>));
    act(() => mounted!.root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>));
    await flush(4);
  };

  it('bảng tin: rời rồi quay lại khi trang kế còn tải, chạm Xem thêm không nạp lần hai', async () => {
    const next = gate<unknown>();
    h.handlers['/feed'] = (q) => (q?.cursor === 'cur-2' ? next.promise : { posts: [POST('p1')], nextCursor: 'cur-2' });
    const qc = newClient();
    mounted = render(<FeedView />, qc);
    await flush(6);
    const c = mounted.container;
    click(btn(c, 'Xem thêm'));
    await flush(2);
    expect(callsTo('/feed', (q) => q.cursor === 'cur-2')).toBe(1);
    await remount(qc, <FeedView />);
    const more = btn(c, 'Đang tải…');
    expect(more.getAttribute('aria-disabled')).toBe('true');
    click(more);
    await flush(2);
    expect(callsTo('/feed', (q) => q.cursor === 'cur-2')).toBe(1);
  });

  it('chi tiết bài: rời rồi quay lại khi trang trả lời kế còn tải, chạm Xem thêm trả lời không nạp lần hai', async () => {
    const next = gate<unknown>();
    h.handlers['/feed/p1/comments'] = (q) => (q?.cursor === 'cur-2' ? next.promise : { items: [COMMENT('c1')], nextCursor: 'cur-2' });
    const qc = newClient();
    mounted = render(<PostDetailPage />, qc);
    await flush(6);
    const c = mounted.container;
    click(btn(c, 'Xem thêm trả lời'));
    await flush(2);
    expect(callsTo('/feed/p1/comments', (q) => q.cursor === 'cur-2')).toBe(1);
    await remount(qc, <PostDetailPage />);
    const more = btn(c, 'Đang tải…');
    expect(more.getAttribute('aria-disabled')).toBe('true');
    click(more);
    await flush(2);
    expect(callsTo('/feed/p1/comments', (q) => q.cursor === 'cur-2')).toBe(1);
  });

  it('sự kiện: Về rồi mở lại khi trang bài dự thi kế còn tải, chạm Xem thêm không nạp lần hai', async () => {
    const next = gate<unknown>();
    h.handlers['/feed/events/e1/posts'] = (q) => (q?.cursor === 'cur-2' ? next.promise : { posts: [POST('p1')], nextCursor: 'cur-2' });
    const c = await mount(<CommunityEventsPage />);
    click(btn(c, 'Sự kiện e1'));
    await flush(6);
    click(btn(c, 'Xem thêm bài dự thi'));
    await flush(2);
    expect(callsTo('/feed/events/e1/posts', (q) => q.cursor === 'cur-2')).toBe(1);
    click(btn(c, 'Sự kiện'));
    await flush(2);
    click(btn(c, 'Sự kiện e1'));
    await flush(4);
    const more = btn(c, 'Đang tải…');
    expect(more.getAttribute('aria-disabled')).toBe('true');
    click(more);
    await flush(2);
    expect(callsTo('/feed/events/e1/posts', (q) => q.cursor === 'cur-2')).toBe(1);
  });
});

describe('Chi tiết bài cộng đồng: lệnh ghi xong mà làm mới không về', () => {
  const never = () => new Promise<unknown>(() => undefined);
  const heart = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const reactPosts = () => h.post.mock.calls.length;

  it('thả tim: còn khoá ở 3,5 giây (chạm thêm không gửi), nhả sau hạn 4 giây và thả lại được', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const c = await mount(<PostDetailPage />);
    h.handlers['/feed/p1'] = never;
    h.handlers['/feed/p1/comments'] = never;
    click(heart(c));
    await flush(4);
    expect(reactPosts()).toBe(1);
    expect(heart(c).getAttribute('aria-busy')).toBe('true');
    await advance(3_500);
    expect(heart(c).getAttribute('aria-busy')).toBe('true');
    click(heart(c));
    await flush(2);
    expect(reactPosts()).toBe(1);
    await advance(1_000);
    await flush(2);
    expect(heart(c).hasAttribute('aria-busy')).toBe(false);
    click(heart(c));
    await flush(2);
    expect(reactPosts()).toBe(2);
  });
});
