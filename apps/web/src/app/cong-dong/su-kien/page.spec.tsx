// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityEvent, FeedItem } from '@tubutree/app-core/api/feed';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Chép ý community-events.spec.tsx (Mini App): khách/đang khôi phục phiên/mất kết nối, danh sách (tiêu đề, mô tả, hạn, thưởng chỉ khi > 0,
// nhãn Đã kết thúc, trống, lỗi + Thử lại), chọn sự kiện tải bài dự thi, chi tiết (thưởng, bài, quay lại, Đăng bài dự thi mở khung soạn
// kèm id + tên, đăng xong đóng khung và tải lại, sự kiện hết hạn khoá nút, trống, lỗi, phân trang bằng cursor), một h1 và vùng chạm.

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u1', role: 'CUSTOMER' } as Record<string, unknown> | null, status: 'authenticated' as string, initialized: true, sessionUnavailable: false, retrySession: vi.fn() },
  get: vi.fn(),
  composer: { current: null as Record<string, unknown> | null },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/components/community/post-card', () => ({
  PostCard: ({ post }: { post: FeedItem }) => <a href={`/cong-dong/${post.id}`}>{`Bài ${post.id}`}</a>,
}));
vi.mock('@/components/community/post-composer', () => ({
  PostComposer: (props: { open: boolean; onPosted: (m: string) => void; onClose: () => void }) => {
    mocks.composer.current = props as unknown as Record<string, unknown>;
    return props.open ? (
      <div data-testid="composer">
        <button type="button" onClick={() => props.onPosted('Đã đăng bài 🌿')}>
          đã đăng
        </button>
      </div>
    ) : null;
  },
}));

import CommunityEventsPage from './page';

const DAY = 24 * 3600 * 1000;
const EVENT = (id: string, over: Partial<CommunityEvent> = {}): CommunityEvent => ({
  id, title: `Sự kiện ${id}`, description: `Mô tả ${id}`, coverUrl: null, startAt: new Date(Date.now() - 2 * DAY).toISOString(),
  endAt: new Date(Date.now() + 5 * DAY).toISOString(), rewardPoints: 5, status: 'ACTIVE', winnerUserId: null, createdAt: new Date(Date.now() - 3 * DAY).toISOString(), ...over,
});
const POST = (id: string) => ({ id }) as FeedItem;
const ddmmyyyy = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

let events: CommunityEvent[];
let entryPages: { posts: FeedItem[]; nextCursor: string | null }[];
let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CommunityEventsPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const btn = (root: ParentNode, name: string) => Array.from(root.querySelectorAll<HTMLElement>('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === name)!;
const openEvent = async (c: HTMLElement, title: string) => {
  click(byText(c, 'button', title));
  await flush(6);
};
const h1 = (c: HTMLElement) => c.querySelectorAll('h1').length;

beforeEach(() => {
  Object.assign(mocks.auth, { user: { id: 'u1', role: 'CUSTOMER' }, status: 'authenticated', initialized: true, sessionUnavailable: false });
  mocks.composer.current = null;
  events = [EVENT('e1'), EVENT('e2', { rewardPoints: 0 })];
  entryPages = [{ posts: [POST('p1'), POST('p2')], nextCursor: null }];
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: { cursor?: string } }) => {
    if (path === '/feed/categories') return [{ id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null }];
    if (path === '/feed/events') return events;
    if (path === '/feed/events/e1/posts') return entryPages[opts?.query?.cursor ? 1 : 0] ?? entryPages[0];
    throw new Error(`no mock ${path}`);
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/cong-dong/su-kien — danh sách', () => {
  it('khách: cổng đăng nhập mang returnTo, không tải sự kiện', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    const { container } = await mount();
    expect(container.textContent).toContain('Đăng nhập để xem cộng đồng');
    expect(container.querySelector('a[href="/dang-nhap?returnTo=%2Fcong-dong%2Fsu-kien"]')).not.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('đang khôi phục phiên: không hiện cổng đăng nhập, không tải sự kiện', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.initialized = false;
    const { container } = await mount();
    expect(container.textContent).not.toContain('Đăng nhập để xem cộng đồng');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('mất kết nối lúc khôi phục phiên: nói đúng vậy, không mời đăng nhập lại', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.sessionUnavailable = true;
    const { container } = await mount();
    expect(container.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(container.textContent).not.toContain('Đăng nhập để xem cộng đồng');
  });

  it('hiện tiêu đề, mô tả, hạn kết thúc và thưởng của từng sự kiện (thưởng chỉ khi > 0)', async () => {
    const { container } = await mount();
    const t = container.textContent ?? '';
    expect(t).toContain('Sự kiện e1');
    expect(t).toContain('Mô tả e1');
    expect(t.split(`Kết thúc: ${ddmmyyyy(events[0]!.endAt)}`)).toHaveLength(3);
    expect(t.match(/5 điểm/g)).toHaveLength(1);
    expect(mocks.get).toHaveBeenCalledWith('/feed/events');
  });

  it('sự kiện đã qua hạn có nhãn "Đã kết thúc"', async () => {
    events = [EVENT('e1', { endAt: new Date(Date.now() - DAY).toISOString() }), EVENT('e2')];
    const { container } = await mount();
    expect(container.textContent?.match(/Đã kết thúc/g)).toHaveLength(1);
  });

  it('không có sự kiện: trạng thái trống', async () => {
    events = [];
    const { container } = await mount();
    expect(container.textContent).toContain('Chưa có sự kiện nào');
  });

  it('lỗi tải: báo lỗi và Thử lại tải lại', async () => {
    let fail = true;
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string, o?: unknown) => {
      if (path === '/feed/events' && fail) throw new Error('mất mạng');
      return base(path, o);
    });
    const { container } = await mount();
    expect(container.textContent).toContain('mất mạng');
    fail = false;
    click(btn(container, 'Thử lại'));
    await flush(6);
    expect(container.textContent).toContain('Sự kiện e1');
  });

  it('bấm thẻ sự kiện (nút thật, bàn phím mở được) tải bài dự thi của sự kiện đó', async () => {
    const { container } = await mount();
    await openEvent(container, 'Sự kiện e1');
    expect(mocks.get).toHaveBeenCalledWith('/feed/events/e1/posts', { query: undefined });
    expect(container.textContent).toContain('Bài dự thi');
  });
});

describe('/cong-dong/su-kien — chi tiết sự kiện', () => {
  it('hiện thưởng và bài dự thi; mỗi bài là liên kết tới /cong-dong/:id', async () => {
    const { container } = await mount();
    await openEvent(container, 'Sự kiện e1');
    expect(container.textContent).toMatch(/Thưởng:.*5 điểm/);
    expect(container.textContent).toContain('Bài dự thi');
    expect(container.querySelector('a[href="/cong-dong/p1"]')).not.toBeNull();
  });

  it('nút Sự kiện quay lại danh sách', async () => {
    const { container } = await mount();
    await openEvent(container, 'Sự kiện e1');
    click(btn(container, 'Sự kiện'));
    await flush(2);
    expect(container.textContent).toContain('Sự kiện e2');
  });

  it('"Đăng bài dự thi" mở khung soạn kèm id + tên sự kiện và danh mục; đăng xong đóng khung, báo và tải lại bài', async () => {
    const { container } = await mount();
    await openEvent(container, 'Sự kiện e1');
    expect(container.querySelector('[data-testid="composer"]')).toBeNull();
    click(btn(container, 'Đăng bài dự thi'));
    expect(container.querySelector('[data-testid="composer"]')).not.toBeNull();
    expect(mocks.composer.current).toMatchObject({ eventId: 'e1', eventTitle: 'Sự kiện e1', categories: [{ id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null }] });
    const before = mocks.get.mock.calls.filter((c) => c[0] === '/feed/events/e1/posts').length;
    click(btn(container, 'đã đăng'));
    await flush(6);
    expect(container.querySelector('[data-testid="composer"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Đã đăng bài');
    expect(mocks.get.mock.calls.filter((c) => c[0] === '/feed/events/e1/posts').length).toBeGreaterThan(before);
  });

  it('sự kiện đã kết thúc: nút "Đăng bài dự thi" bị khoá', async () => {
    events = [EVENT('e1', { endAt: new Date(Date.now() - DAY).toISOString() })];
    const { container } = await mount();
    await openEvent(container, 'Sự kiện e1');
    const join = btn(container, 'Đăng bài dự thi') as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    click(join);
    expect(container.querySelector('[data-testid="composer"]')).toBeNull();
  });

  it('chưa có bài dự thi: trạng thái trống', async () => {
    entryPages = [{ posts: [], nextCursor: null }];
    const { container } = await mount();
    await openEvent(container, 'Sự kiện e1');
    expect(container.textContent).toContain('Chưa có bài viết nào');
  });

  it('lỗi tải bài dự thi: báo lỗi và Thử lại tải lại', async () => {
    let fail = true;
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string, o?: unknown) => {
      if (path === '/feed/events/e1/posts' && fail) throw new Error('bài hỏng');
      return base(path, o);
    });
    const { container } = await mount();
    await openEvent(container, 'Sự kiện e1');
    expect(container.textContent).toContain('bài hỏng');
    fail = false;
    click(btn(container, 'Thử lại'));
    await flush(6);
    expect(container.querySelector('a[href="/cong-dong/p1"]')).not.toBeNull();
  });

  it('phân trang: "Xem thêm bài dự thi" nạp trang kế bằng cursor', async () => {
    entryPages = [{ posts: [POST('p1')], nextCursor: 'cur-2' }, { posts: [POST('p3')], nextCursor: null }];
    const { container } = await mount();
    await openEvent(container, 'Sự kiện e1');
    click(btn(container, 'Xem thêm bài dự thi'));
    await flush(6);
    expect(container.querySelector('a[href="/cong-dong/p3"]')).not.toBeNull();
    expect(mocks.get).toHaveBeenLastCalledWith('/feed/events/e1/posts', { query: { cursor: 'cur-2' } });
  });
});

describe('/cong-dong/su-kien — tiêu đề, vùng chạm, truy cập', () => {
  it('có đúng một h1 ở mọi trạng thái, kể cả khi xem chi tiết', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.initialized = false;
    expect(h1((await mount()).container)).toBe(1);
    mounted.pop()!.unmount();
    mocks.auth.initialized = true;
    expect(h1((await mount()).container)).toBe(1);
    mounted.pop()!.unmount();
    mocks.auth.status = 'authenticated';
    const { container } = await mount();
    expect(h1(container)).toBe(1);
    await openEvent(container, 'Sự kiện e1');
    expect(h1(container)).toBe(1);
  });

  it('không dùng emoji làm biểu tượng; nút có tên và đủ 44px', async () => {
    const { container } = await mount();
    await openEvent(container, 'Sự kiện e1');
    expect(container.textContent).not.toMatch(/[🎁🎉]/u);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
});
