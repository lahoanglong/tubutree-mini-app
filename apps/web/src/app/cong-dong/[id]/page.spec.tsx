// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedComment, FeedItem } from '@tubutree/app-core/api/feed';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Chép ý post-detail.spec.tsx (Mini App): nội dung + nhãn loại + huy hiệu chờ duyệt/ghim, câu trả lời hay nhất lên đầu, ảnh qua
// safeMediaUrl, khách/đang khôi phục phiên/mất kết nối, lỗi + Thử lại, bình luận vô hạn theo cursor, thẻ sản phẩm + nút mua,
// thả tim không gửi chồng, gửi trả lời (trim, xoá ô), sửa/xoá/báo cáo bài và bình luận, chọn hay nhất, ghim (ADMIN), gỡ bình luận.

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u1', role: 'CUSTOMER' } as Record<string, unknown> | null, status: 'authenticated' as string, initialized: true, sessionUnavailable: false, retrySession: vi.fn() },
  params: { id: 'p1' },
  push: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useParams: () => mocks.params,
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.del } }));

import PostDetailPage from './page';

const POST = (over: Partial<FeedItem> = {}): FeedItem => ({
  id: 'p1', kind: 'TIP', status: 'APPROVED', title: null, body: 'Mẹo rửa bình sữa bằng nước rửa chén sinh học.', images: [], meta: null,
  createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), author: 'Lan Anh', badge: null, authorLevel: 1,
  category: { id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null }, productTags: [], tags: [], isPinned: false, likeCount: 5, commentCount: 2,
  liked: false, bestCommentId: null, isOwner: false, ...over,
});
const COMMENT = (id: string, author: string, over: Partial<FeedComment> = {}): FeedComment => ({
  id, body: `Trả lời của ${author}`, author, badge: null, authorLevel: 1, isAccepted: false,
  createdAt: new Date(Date.now() - 3600 * 1000).toISOString(), isOwner: false, ...over,
});
const COMMENTS = [COMMENT('c1', 'Bình'), COMMENT('c2', 'Hạnh', { isAccepted: true }), COMMENT('c3', 'Tôi', { isOwner: true })];

let postData: FeedItem;
let commentPages: { items: FeedComment[]; nextCursor: string | null }[];
// Cổng cho lần tải lại bài / bình luận: giữ lời tải lại treo để canh khoá còn giữ tới khi dữ liệu mới về.
let postGate: Promise<unknown> | null = null;
let commentsGate: Promise<unknown> | null = null;
function stub(post: FeedItem = POST(), comments: FeedComment[] = COMMENTS) {
  postData = post;
  commentPages = [{ items: comments, nextCursor: null }];
}

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<PostDetailPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const dlg = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const btn = (root: ParentNode, name: string | RegExp) =>
  Array.from(root.querySelectorAll<HTMLElement>('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().match(typeof name === 'string' ? new RegExp(`^${name}$`) : name))!;
const buttons = (root: ParentNode, name: string) => Array.from(root.querySelectorAll<HTMLElement>('button')).filter((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === name);
const h1 = (c: HTMLElement) => c.querySelectorAll('h1').length;
const shownAlerts = (root: ParentNode) => Array.from(root.querySelectorAll('[role="alert"]')).map((a) => a.textContent ?? '').filter(Boolean);

beforeEach(() => {
  Object.assign(mocks.auth, { user: { id: 'u1', role: 'CUSTOMER' }, status: 'authenticated', initialized: true, sessionUnavailable: false });
  mocks.params.id = 'p1';
  mocks.push.mockReset();
  stub();
  postGate = null;
  commentsGate = null;
  let page = 0;
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: { cursor?: string } }) => {
    if (path === '/feed/p1') {
      await postGate;
      return postData;
    }
    if (path === '/feed/p1/comments') {
      await commentsGate;
      const i = opts?.query?.cursor ? page + 1 : 0;
      page = i;
      return commentPages[Math.min(i, commentPages.length - 1)];
    }
    throw new Error(`no mock ${path}`);
  });
  mocks.post.mockReset().mockResolvedValue({ liked: true, id: 'c9', ok: true });
  mocks.patch.mockReset().mockResolvedValue({ ok: true });
  mocks.del.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/cong-dong/[id] — hiển thị', () => {
  it('hiện bài, số tim/bình luận, nhãn loại; câu trả lời hay nhất được đưa lên đầu', async () => {
    const { container } = await mount();
    const t = container.textContent ?? '';
    expect(t).toContain('Mẹo rửa bình sữa bằng nước rửa chén sinh học.');
    expect(t).toContain('Lan Anh');
    expect(t).toMatch(/2 giờ trước · .*Nhà bếp/);
    expect(t).toContain('Mẹo hay');
    expect(t).toContain('Trả lời (3)');
    const order = ['Trả lời của Hạnh', 'Trả lời của Bình', 'Trả lời của Tôi'].map((s) => t.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(t).toContain('Câu trả lời hay nhất');
    expect(mocks.get).toHaveBeenCalledWith('/feed/p1');
  });

  it('câu hỏi hiện tiêu đề; bài chờ duyệt của chủ bài và bài đã ghim hiện nhãn tương ứng', async () => {
    stub(POST({ kind: 'QUESTION', title: 'Rửa bình sữa thế nào?', isOwner: true, status: 'PENDING', isPinned: true }));
    const { container } = await mount();
    const t = container.textContent ?? '';
    expect(t).toContain('Rửa bình sữa thế nào?');
    expect(t).toContain('Chờ duyệt');
    expect(t).toContain('Đã ghim');
  });

  it('bài chờ duyệt của người khác không hiện huy hiệu Chờ duyệt', async () => {
    stub(POST({ status: 'PENDING', isOwner: false }));
    const { container } = await mount();
    expect(container.textContent).not.toContain('Chờ duyệt');
  });

  it('ảnh bài: đường dẫn do API phục vụ ghép gốc API, https và data ảnh giữ nguyên, javascript: bị bỏ', async () => {
    const v = 'c'.repeat(32);
    stub(POST({ images: [`/feed/posts/p1/images/0?v=${v}`, 'https://res.cloudinary.com/demo/a.jpg', 'data:image/jpeg;base64,QUJD', 'javascript:alert(1)'], imageCount: 4 }));
    const { container } = await mount();
    const srcs = [...container.querySelectorAll('article img')].map((i) => i.getAttribute('src'));
    expect(srcs).toContain('https://res.cloudinary.com/demo/a.jpg');
    expect(srcs).toContain('data:image/jpeg;base64,QUJD');
    expect(srcs.some((s) => s?.includes(`/feed/posts/p1/images/0?v=${v}`) && s.startsWith('http'))).toBe(true);
    expect(srcs.some((s) => s?.startsWith('javascript:'))).toBe(false);
  });

  it('khách: cổng đăng nhập mang returnTo, không tải bài', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    const { container } = await mount();
    expect(container.textContent).toContain('Đăng nhập để xem cộng đồng');
    expect(container.querySelector('a[href="/dang-nhap?returnTo=%2Fcong-dong%2Fp1"]')).not.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('đang khôi phục phiên: không hiện cổng đăng nhập, không tải bài', async () => {
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

  it('lỗi tải bài: báo lỗi, Thử lại tải lại', async () => {
    let fail = true;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/feed/p1' && fail) throw new Error('mất mạng');
      return path === '/feed/p1' ? postData : { items: [], nextCursor: null };
    });
    const { container } = await mount();
    expect(container.textContent).toContain('mất mạng');
    fail = false;
    click(btn(container, 'Thử lại'));
    await flush(6);
    expect(container.textContent).toContain('Lan Anh');
  });

  it('không có câu trả lời: câu mời chia sẻ đầu tiên', async () => {
    stub(POST(), []);
    const { container } = await mount();
    expect(container.textContent).toContain('Hãy là người đầu tiên chia sẻ hoặc đặt câu hỏi!');
  });

  it('lỗi tải bình luận: báo lỗi riêng, bài vẫn hiện', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/feed/p1') return postData;
      throw new Error('bình luận hỏng');
    });
    const { container } = await mount();
    expect(container.textContent).toContain('Lan Anh');
    expect(container.textContent).toContain('bình luận hỏng');
  });

  it('có trang kế: "Xem thêm trả lời" nạp bằng cursor', async () => {
    commentPages = [{ items: [COMMENT('c1', 'Bình')], nextCursor: 'cur-2' }, { items: [COMMENT('c4', 'Mai')], nextCursor: null }];
    const { container } = await mount();
    click(btn(container, 'Xem thêm trả lời'));
    await flush(6);
    expect(container.textContent).toContain('Trả lời của Mai');
    expect(mocks.get).toHaveBeenLastCalledWith('/feed/p1/comments', { query: { cursor: 'cur-2' } });
  });

  it('thẻ sản phẩm gắn kèm mở /san-pham/:slug; bài Trải nghiệm có nút "Mua sản phẩm này", câu hỏi có "Xem sản phẩm gợi ý"', async () => {
    const tag = { slug: 'nuoc-rua-chen', name: 'Nước rửa chén', thumbnail: null, salePrice: null, basePrice: 89_000 };
    stub(POST({ kind: 'SHOWCASE', productTags: [tag] }));
    const { container } = await mount();
    expect(container.querySelector('a[href="/san-pham/nuoc-rua-chen"]')?.textContent).toContain('89.000đ');
    const buy = byText(container, 'a', 'Mua sản phẩm này');
    expect(buy?.getAttribute('href')).toBe('/san-pham/nuoc-rua-chen');
    mounted.pop()!.unmount();
    stub(POST({ kind: 'QUESTION', title: 'Hỏi', productTags: [tag] }));
    const q = await mount();
    expect(byText(q.container, 'a', 'Xem sản phẩm gợi ý')?.getAttribute('href')).toBe('/san-pham/nuoc-rua-chen');
  });

  it('bài mẹo có thẻ sản phẩm nhưng không có nút mua', async () => {
    stub(POST({ kind: 'TIP', productTags: [{ slug: 'a', name: 'A', thumbnail: null, salePrice: null, basePrice: 1000 }] }));
    const { container } = await mount();
    expect(byText(container, 'a', 'Mua sản phẩm này')).toBeNull();
  });
});

describe('/cong-dong/[id] — ô trả lời dính đáy', () => {
  it('body có has-sticky-bar khi bài hiện, mất khi rời trang; main không còn đệm cứng', async () => {
    expect(document.body.classList.contains('has-sticky-bar')).toBe(false);
    const { container } = await mount();
    expect(document.body.classList.contains('has-sticky-bar')).toBe(true);
    expect(container.querySelector('main')!.className).not.toContain('max-md:pb-24');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    expect(document.body.classList.contains('has-sticky-bar')).toBe(false);
  });
});

describe('/cong-dong/[id] — thao tác', () => {
  const likeBtn = (c: HTMLElement) => c.querySelector<HTMLElement>('button[aria-pressed]')!;

  it('bấm tim gọi POST /feed/:id/react; đang gửi thì bấm tiếp không gửi thêm', async () => {
    let resolve!: (v: { liked: boolean }) => void;
    mocks.post.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = await mount();
    click(likeBtn(container));
    await flush(2);
    expect(likeBtn(container).getAttribute('aria-disabled')).toBe('true');
    click(likeBtn(container));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/feed/p1/react');
    resolve({ liked: true });
    await flush(4);
  });

  it('gửi trả lời: nút Gửi khoá khi ô trống, gửi nội dung đã trim, xoá ô sau khi gửi', async () => {
    const { container } = await mount();
    const send = () => btn(container, 'Gửi') as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Viết trả lời…"]')!;
    typeInto(input, '  Cảm ơn bạn  ');
    expect(send().disabled).toBe(false);
    click(send());
    await flush(6);
    expect(mocks.post).toHaveBeenCalledWith('/feed/p1/comments', { body: 'Cảm ơn bạn' });
    expect(input.value).toBe('');
  });

  it('lỗi gửi trả lời: báo lỗi, giữ nguyên chữ đã gõ', async () => {
    mocks.post.mockRejectedValue(new Error('quá nhanh'));
    const { container } = await mount();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Viết trả lời…"]')!;
    typeInto(input, 'Xin chào');
    click(btn(container, 'Gửi'));
    await flush(6);
    expect(shownAlerts(container).join()).toContain('quá nhanh');
    expect(input.value).toBe('Xin chào');
  });

  it('chủ bài sửa bài: sheet Sửa nạp nội dung cũ, Lưu gọi PATCH /feed/:id với nội dung đã trim', async () => {
    stub(POST({ isOwner: true }));
    const { container } = await mount();
    click(btn(container, 'Sửa'));
    await flush(2);
    const area = dlg().querySelector<HTMLTextAreaElement>('textarea')!;
    expect(area.value).toBe('Mẹo rửa bình sữa bằng nước rửa chén sinh học.');
    typeInto(area, '  Nội dung mới  ');
    click(btn(dlg(), 'Lưu'));
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledWith('/feed/p1', { title: undefined, body: 'Nội dung mới' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('chủ câu hỏi sửa bài: bắt buộc tiêu đề, gửi kèm tiêu đề đã trim', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Tiêu đề cũ' }));
    const { container } = await mount();
    click(btn(container, 'Sửa'));
    await flush(2);
    const titleInput = dlg().querySelector<HTMLInputElement>('input')!;
    typeInto(titleInput, '   ');
    expect(dlg().textContent).toContain('Câu hỏi cần có tiêu đề');
    expect((btn(dlg(), 'Lưu') as HTMLButtonElement).disabled).toBe(true);
    typeInto(titleInput, ' Tiêu đề mới ');
    click(btn(dlg(), 'Lưu'));
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledWith('/feed/p1', { title: 'Tiêu đề mới', body: 'Mẹo rửa bình sữa bằng nước rửa chén sinh học.' });
  });

  it('chủ bài bấm Huỷ ở hộp xác nhận xoá thì không xoá', async () => {
    stub(POST({ isOwner: true }));
    const { container } = await mount();
    click(btn(container, 'Xoá'));
    await flush(2);
    expect(dlg().textContent).toContain('Xoá bài viết này?');
    click(btn(dlg(), 'Huỷ'));
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('chủ bài xoá: xác nhận → DELETE /feed/:id rồi về /cong-dong', async () => {
    stub(POST({ isOwner: true }));
    const { container } = await mount();
    click(btn(container, 'Xoá'));
    await flush(2);
    click(btn(dlg(), 'Xoá'));
    await flush(6);
    expect(mocks.del).toHaveBeenCalledWith('/feed/p1');
    expect(mocks.push).toHaveBeenCalledWith('/cong-dong?deleted=1');
  });

  it('xoá lỗi: đóng hộp xác nhận, báo lỗi, ở lại trang', async () => {
    stub(POST({ isOwner: true }));
    mocks.del.mockRejectedValue(new Error('không xoá được'));
    const { container } = await mount();
    click(btn(container, 'Xoá'));
    await flush(2);
    click(btn(dlg(), 'Xoá'));
    await flush(6);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('không xoá được');
  });

  it('người khác báo cáo bài: sheet Báo cáo gửi targetType POST kèm lý do đã trim, rồi báo đã gửi', async () => {
    const { container } = await mount();
    click(container.querySelector('article')!.querySelector('button[aria-label="Báo cáo"]'));
    await flush(2);
    typeInto(dlg().querySelector('textarea'), '  Spam quảng cáo  ');
    click(btn(dlg(), 'Báo cáo'));
    await flush(6);
    expect(mocks.post).toHaveBeenCalledWith('/feed/p1/report', { targetType: 'POST', reason: 'Spam quảng cáo' });
    expect(container.textContent).toContain('Đã gửi báo cáo, cảm ơn bạn');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('báo cáo một bình luận gửi targetType COMMENT kèm targetId', async () => {
    const { container } = await mount();
    const row = byText(container, '[data-testid="comment-row"]', 'Trả lời của Bình')!;
    click(row.querySelector('button[aria-label="Báo cáo"]'));
    await flush(2);
    click(btn(dlg(), 'Báo cáo'));
    await flush(6);
    expect(mocks.post).toHaveBeenCalledWith('/feed/p1/report', { targetType: 'COMMENT', targetId: 'c1', reason: '' });
  });

  it('chủ câu hỏi chọn câu trả lời hay nhất; câu đã được chọn không còn nút', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    const { container } = await mount();
    const choose = buttons(container, 'Chọn hay nhất');
    expect(choose).toHaveLength(2);
    click(choose[0]!);
    await flush(6);
    expect(mocks.post).toHaveBeenCalledWith('/feed/p1/best-answer/c1');
  });

  it('chọn hay nhất lỗi: thông báo hiện ngay dưới bình luận đó, không chỉ ở đầu trang', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    mocks.post.mockRejectedValue(new Error('không đủ quyền'));
    const { container } = await mount();
    click(buttons(container, 'Chọn hay nhất')[0]!);
    await flush(6);
    const rows = Array.from(container.querySelectorAll('[data-testid="comment-row"]'));
    const withAlert = rows.filter((r) => r.querySelector('[role="alert"]')?.textContent?.includes('không đủ quyền'));
    expect(withAlert).toHaveLength(1);
    expect(withAlert[0]!.textContent).toContain('Trả lời của Bình');
  });

  it('ẩn bình luận lỗi: thông báo hiện ngay dưới bình luận đó', async () => {
    mocks.del.mockRejectedValue(new Error('máy chủ bận'));
    const { container } = await mount();
    click(btn(container, 'Ẩn nội dung'));
    await flush(6);
    const rows = Array.from(container.querySelectorAll('[data-testid="comment-row"]'));
    const withAlert = rows.filter((r) => r.querySelector('[role="alert"]')?.textContent?.includes('máy chủ bận'));
    expect(withAlert).toHaveLength(1);
    expect(withAlert[0]!.textContent).toContain('Trả lời của Tôi');
  });

  it('ADMIN cũng chọn được câu hay nhất; người khác và bài không phải câu hỏi thì không thấy nút', async () => {
    stub(POST({ kind: 'QUESTION', title: 'Hỏi' }));
    const a = await mount();
    expect(buttons(a.container, 'Chọn hay nhất')).toHaveLength(0);
    mounted.pop()!.unmount();
    (mocks.auth.user as { role: string }).role = 'ADMIN';
    const b = await mount();
    expect(buttons(b.container, 'Chọn hay nhất')).toHaveLength(2);
    mounted.pop()!.unmount();
    stub(POST({ isOwner: true, kind: 'TIP' }));
    const c = await mount();
    expect(buttons(c.container, 'Chọn hay nhất')).toHaveLength(0);
  });

  it('ADMIN: nút Ghim gọi POST /feed/admin/:id/pin {pinned:true}; bài đã ghim → Bỏ ghim gửi false; khách thường không thấy nút', async () => {
    const a = await mount();
    expect(buttons(a.container, 'Ghim')).toHaveLength(0);
    mounted.pop()!.unmount();
    (mocks.auth.user as { role: string }).role = 'ADMIN';
    const b = await mount();
    click(btn(b.container, 'Ghim'));
    await flush(6);
    expect(mocks.post).toHaveBeenCalledWith('/feed/admin/p1/pin', { pinned: true });
    mounted.pop()!.unmount();
    stub(POST({ isPinned: true }));
    const c = await mount();
    click(btn(c.container, 'Bỏ ghim'));
    await flush(6);
    expect(mocks.post).toHaveBeenCalledWith('/feed/admin/p1/pin', { pinned: false });
  });

  it('chủ bình luận ẩn bình luận của mình: DELETE /feed/comments/:id', async () => {
    const { container } = await mount();
    click(btn(container, 'Ẩn nội dung'));
    await flush(6);
    expect(mocks.del).toHaveBeenCalledWith('/feed/comments/c3');
  });
});

describe('/cong-dong/[id] — tiêu đề, vùng chạm, truy cập', () => {
  it('có đúng một h1 ở mọi trạng thái', async () => {
    mocks.auth.initialized = false;
    mocks.auth.status = 'idle';
    expect(h1((await mount()).container)).toBe(1);
    mounted.pop()!.unmount();
    mocks.auth.initialized = true;
    expect(h1((await mount()).container)).toBe(1);
    mounted.pop()!.unmount();
    mocks.auth.status = 'authenticated';
    mocks.get.mockReturnValue(new Promise(() => {}));
    expect(h1((await mount()).container)).toBe(1);
    mounted.pop()!.unmount();
    mocks.get.mockRejectedValue(new Error('hỏng'));
    expect(h1((await mount()).container)).toBe(1);
    mounted.pop()!.unmount();
    mocks.get.mockImplementation(async (p: string) => (p === '/feed/p1' ? postData : { items: [], nextCursor: null }));
    expect(h1((await mount()).container)).toBe(1);
  });

  it('nút sửa, xoá, báo cáo, tim, gửi và nút trên bình luận đủ 44px, mọi điều khiển có tên', async () => {
    stub(POST({ isOwner: true }));
    const { container } = await mount();
    expect(smallTouchTargets(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
  });
});

describe('/cong-dong/[id] — lỗi hiện tại chỗ thao tác', () => {
  it('sửa bài lỗi: sheet Sửa vẫn mở và báo lỗi ngay trong hộp thoại', async () => {
    stub(POST({ isOwner: true }));
    mocks.patch.mockRejectedValue(new Error('máy chủ bận'));
    const { container } = await mount();
    click(btn(container, 'Sửa'));
    await flush(2);
    click(btn(dlg(), 'Lưu'));
    await flush(6);
    expect(dlg()).not.toBeNull();
    expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('máy chủ bận');
    expect(shownAlerts(container)).toEqual([]);
  });

  it('báo cáo lỗi: sheet Báo cáo giữ nguyên để thử lại, lỗi hiện trong hộp thoại', async () => {
    mocks.post.mockRejectedValue(new Error('quá nhanh'));
    const { container } = await mount();
    click(container.querySelector('article')!.querySelector('button[aria-label="Báo cáo"]'));
    await flush(2);
    typeInto(dlg().querySelector('textarea'), 'Spam');
    click(btn(dlg(), 'Báo cáo'));
    await flush(6);
    expect(dlg()).not.toBeNull();
    expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('quá nhanh');
    expect(dlg().querySelector('textarea')!.value).toBe('Spam');
    mocks.post.mockResolvedValue({ ok: true });
    click(btn(dlg(), 'Báo cáo'));
    await flush(6);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('lỗi gửi trả lời hiện ngay trong ô trả lời dính đáy, không ở banner đầu trang', async () => {
    mocks.post.mockRejectedValue(new Error('quá nhanh'));
    const { container } = await mount();
    typeInto(container.querySelector('input[aria-label="Viết trả lời…"]'), 'Xin chào');
    click(btn(container, 'Gửi'));
    await flush(6);
    const form = container.querySelector('form')!;
    expect(form.querySelector('[role="alert"]')?.textContent).toContain('quá nhanh');
    expect(shownAlerts(container)).toHaveLength(1);
  });

  it('ô trả lời giới hạn 500 ký tự như API', async () => {
    const { container } = await mount();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Viết trả lời…"]')!.maxLength).toBe(500);
  });
});

describe('/cong-dong/[id] — giao diện điện thoại như Mini App', () => {
  it('bài và khối Trả lời là khối trắng tràn ngang không viền không bo', async () => {
    const { container } = await mount();
    for (const el of [container.querySelector('article')!, container.querySelector('section[aria-labelledby="answers-title"]')!]) {
      for (const c of ['max-md:-mx-4', 'max-md:rounded-none', 'max-md:border-0', 'max-md:shadow-none']) expect(el.className).toContain(c);
    }
  });

  it('tiêu đề câu hỏi cỡ title-sm ở điện thoại', async () => {
    stub(POST({ kind: 'QUESTION', title: 'Rửa bình sữa thế nào?' }));
    const { container } = await mount();
    const h = Array.from(container.querySelectorAll('h2')).find((x) => x.textContent === 'Rửa bình sữa thế nào?')!;
    expect(h.className).toContain('max-md:text-[length:var(--type-title-sm-size)]');
  });

  it('ô Viết trả lời cố định đáy màn hình ở điện thoại, đổ bóng', async () => {
    const { container } = await mount();
    const form = container.querySelector('form')!;
    for (const c of ['max-md:fixed', 'max-md:inset-x-0', 'max-md:[box-shadow:var(--elevation-3)]']) expect(form.className).toContain(c);
  });

  it('tiêu đề trên thanh trắng, trang bỏ đệm 48px', async () => {
    const { container } = await mount();
    expect(container.querySelector('h1')!.closest('header')!.hasAttribute('data-page-bleed')).toBe(true);
    expect(container.querySelector('h1')!.closest('header')!.className).toContain('max-md:bg-[var(--color-bg-surface)]');
  });
});

describe('/cong-dong/[id] — tiêu đề khối như Mini App', () => {
  it('"Trả lời (n)" cỡ title-sm ở điện thoại', async () => {
    const { container } = await mount();
    expect(container.querySelector('#answers-title')!.className).toContain('max-md:text-[length:var(--type-title-sm-size)]');
  });
});

describe('/cong-dong/[id] — khoá đồng bộ chống bấm đúp, nút bận giữ focus', () => {
  // Hai cú bấm trong CÙNG một act: React chưa kịp vẽ lại nên `isPending`/state vẫn cũ ở cú thứ hai.
  // mutationFn chạy sau vài microtask: đếm lời gọi API phải đợi `flush`, nếu không ca "chỉ một lần" đậu suông.
  const twice = async (el: Element | null | undefined) => {
    if (!el) throw new Error('twice: không thấy phần tử');
    act(() => {
      (el as HTMLElement).click();
      (el as HTMLElement).click();
    });
    await flush(2);
  };
  const posts = (path: string) => mocks.post.mock.calls.filter((c) => c[0] === path);
  const likeBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
  const sendBtn = (c: HTMLElement) => btn(c, 'Gửi') as HTMLButtonElement;
  const replyInput = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[aria-label="Viết trả lời…"]')!;
  const never = () => new Promise<never>(() => {});
  const deferred = () => {
    let release!: () => void;
    const promise = new Promise<void>((r) => (release = r));
    return { promise, release };
  };

  it('tim: chạm đúp cùng khung hình chỉ gọi POST /react một lần; nút báo aria-busy, vẫn giữ focus', async () => {
    mocks.post.mockReturnValue(never());
    const { container } = await mount();
    likeBtn(container).focus();
    await twice(likeBtn(container));
    expect(posts('/feed/p1/react')).toHaveLength(1);
    await flush(2);
    expect(likeBtn(container).getAttribute('aria-busy')).toBe('true');
    expect(likeBtn(container).getAttribute('aria-disabled')).toBe('true');
    expect(likeBtn(container).disabled).toBe(false);
    expect(document.activeElement).toBe(likeBtn(container));
  });

  it('tim: khoá giữ tới khi số tim mới về, rồi bấm lại được', async () => {
    const { container } = await mount();
    const gate = deferred();
    postGate = gate.promise;
    click(likeBtn(container));
    await flush(4);
    expect(posts('/feed/p1/react')).toHaveLength(1);
    // Lệnh đã xong nhưng bài chưa tải lại: số tim còn cũ, bấm lúc này sẽ bật/tắt trên số cũ.
    expect(likeBtn(container).getAttribute('aria-busy')).toBe('true');
    await twice(likeBtn(container));
    expect(posts('/feed/p1/react')).toHaveLength(1);
    gate.release();
    await flush(4);
    expect(likeBtn(container).hasAttribute('aria-busy')).toBe(false);
    click(likeBtn(container));
    await flush(2);
    expect(posts('/feed/p1/react')).toHaveLength(2);
  });

  it('tim: lỗi nhả khoá, báo lỗi, bấm lại gửi lần hai', async () => {
    mocks.post.mockRejectedValueOnce(new Error('mạng chập chờn'));
    const { container } = await mount();
    click(likeBtn(container));
    await flush(6);
    expect(shownAlerts(container).join()).toContain('mạng chập chờn');
    expect(likeBtn(container).hasAttribute('aria-busy')).toBe(false);
    click(likeBtn(container));
    await flush(2);
    expect(posts('/feed/p1/react')).toHaveLength(2);
  });

  it('trả lời: bấm Gửi hai lần cùng khung hình chỉ đăng một bình luận; nút báo bận, không disabled, giữ focus', async () => {
    mocks.post.mockReturnValue(never());
    const { container } = await mount();
    typeInto(replyInput(container), 'Cảm ơn bạn');
    sendBtn(container).focus();
    await twice(sendBtn(container));
    expect(posts('/feed/p1/comments')).toHaveLength(1);
    await flush(2);
    expect(sendBtn(container).getAttribute('aria-busy')).toBe('true');
    expect(sendBtn(container).getAttribute('aria-disabled')).toBe('true');
    expect(sendBtn(container).disabled).toBe(false);
    expect(document.activeElement).toBe(sendBtn(container));
  });

  it('trả lời: Enter hai lần cùng khung hình (gửi form) chỉ đăng một bình luận', async () => {
    mocks.post.mockReturnValue(never());
    const { container } = await mount();
    typeInto(replyInput(container), 'Cảm ơn bạn');
    const form = container.querySelector('form')!;
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush(2);
    expect(posts('/feed/p1/comments')).toHaveLength(1);
  });

  it('trả lời: lỗi nhả khoá, giữ chữ, gửi lại được và lần này thành công', async () => {
    mocks.post.mockRejectedValueOnce(new Error('quá nhanh'));
    const { container } = await mount();
    typeInto(replyInput(container), 'Xin chào');
    click(sendBtn(container));
    await flush(6);
    expect(replyInput(container).value).toBe('Xin chào');
    expect(sendBtn(container).hasAttribute('aria-busy')).toBe(false);
    click(sendBtn(container));
    await flush(6);
    expect(posts('/feed/p1/comments')).toHaveLength(2);
    expect(replyInput(container).value).toBe('');
    expect(shownAlerts(container)).toEqual([]);
  });

  it('báo cáo: bấm Báo cáo hai lần cùng khung hình chỉ gửi một báo cáo; nút báo bận, không disabled, giữ focus', async () => {
    mocks.post.mockReturnValue(never());
    const { container } = await mount();
    click(container.querySelector('article')!.querySelector('button[aria-label="Báo cáo"]'));
    await flush(2);
    const submit = btn(dlg(), 'Báo cáo') as HTMLButtonElement;
    submit.focus();
    await twice(submit);
    expect(posts('/feed/p1/report')).toHaveLength(1);
    await flush(2);
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(submit.disabled).toBe(false);
    expect(document.activeElement).toBe(submit);
  });

  it('báo cáo: lỗi nhả khoá, thử lại gửi lần hai', async () => {
    mocks.post.mockRejectedValueOnce(new Error('quá nhanh'));
    const { container } = await mount();
    click(container.querySelector('article')!.querySelector('button[aria-label="Báo cáo"]'));
    await flush(2);
    click(btn(dlg(), 'Báo cáo'));
    await flush(6);
    expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('quá nhanh');
    expect(btn(dlg(), 'Báo cáo').hasAttribute('aria-busy')).toBe(false);
    click(btn(dlg(), 'Báo cáo'));
    await flush(6);
    expect(posts('/feed/p1/report')).toHaveLength(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('sửa bài: bấm Lưu hai lần cùng khung hình chỉ gửi một PATCH; nút báo bận, không disabled, giữ focus', async () => {
    stub(POST({ isOwner: true }));
    mocks.patch.mockReturnValue(never());
    const { container } = await mount();
    click(btn(container, 'Sửa'));
    await flush(2);
    const save = btn(dlg(), 'Lưu') as HTMLButtonElement;
    save.focus();
    await twice(save);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    await flush(2);
    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(save.disabled).toBe(false);
    expect(document.activeElement).toBe(save);
  });

  it('sửa bài: lỗi nhả khoá, Lưu lại được; thành công thì khoá giữ tới khi bài mới về', async () => {
    stub(POST({ isOwner: true }));
    mocks.patch.mockRejectedValueOnce(new Error('máy chủ bận'));
    const { container } = await mount();
    click(btn(container, 'Sửa'));
    await flush(2);
    click(btn(dlg(), 'Lưu'));
    await flush(6);
    expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('máy chủ bận');
    const gate = deferred();
    postGate = gate.promise;
    click(btn(dlg(), 'Lưu'));
    await flush(4);
    expect(mocks.patch).toHaveBeenCalledTimes(2);
    // Sheet đã đóng, bài chưa tải lại: mở lại Sửa và Lưu ngay không được gửi trên bản cũ.
    click(btn(container, 'Sửa'));
    await flush(2);
    // Lệnh trước còn giữ khoá nên nút vẫn ghi "Đang lưu…".
    expect(btn(dlg(), /^(Lưu|Đang lưu…)$/).textContent).toBe('Đang lưu…');
    await twice(btn(dlg(), /^(Lưu|Đang lưu…)$/));
    expect(mocks.patch).toHaveBeenCalledTimes(2);
    gate.release();
    await flush(4);
    click(btn(dlg(), 'Lưu'));
    await flush(2);
    expect(mocks.patch).toHaveBeenCalledTimes(3);
  });

  const esc = () =>
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
  const backdrop = () => document.querySelector<HTMLElement>('[data-sheet-backdrop]');

  it('sửa bài: đang lưu thì Esc, bấm nền, nút Đóng đều không đóng khung; lỗi hiện tại chỗ, chữ đã sửa còn, rồi Esc đóng được', async () => {
    stub(POST({ isOwner: true }));
    const gate = deferred();
    mocks.patch.mockImplementation(() =>
      gate.promise.then(() => {
        throw new Error('máy chủ bận');
      }),
    );
    const { container } = await mount();
    click(btn(container, 'Sửa'));
    await flush(2);
    expect(dlg().querySelector('button[aria-label="Đóng"]')).not.toBeNull();
    typeInto(dlg().querySelector('textarea[aria-label="Chia sẻ chi tiết…"]'), 'Nội dung đã sửa');
    click(btn(dlg(), 'Lưu'));
    await flush(2);
    expect(dlg().querySelector('button[aria-label="Đóng"]')).toBeNull();
    esc();
    click(backdrop());
    await flush(2);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    gate.release();
    await flush(6);
    expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('máy chủ bận');
    expect(dlg().querySelector<HTMLTextAreaElement>('textarea[aria-label="Chia sẻ chi tiết…"]')!.value).toBe('Nội dung đã sửa');
    expect(dlg().querySelector('button[aria-label="Đóng"]')).not.toBeNull();
    esc();
    await flush(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('báo cáo: đang gửi thì Esc, bấm nền, nút Đóng đều không đóng khung; lỗi hiện tại chỗ rồi Esc đóng được; gửi xong tự đóng', async () => {
    const gate = deferred();
    mocks.post.mockImplementationOnce(() =>
      gate.promise.then(() => {
        throw new Error('quá nhanh');
      }),
    );
    const { container } = await mount();
    click(container.querySelector('article')!.querySelector('button[aria-label="Báo cáo"]'));
    await flush(2);
    expect(dlg().querySelector('button[aria-label="Đóng"]')).not.toBeNull();
    click(btn(dlg(), 'Báo cáo'));
    await flush(2);
    expect(dlg().querySelector('button[aria-label="Đóng"]')).toBeNull();
    esc();
    click(backdrop());
    await flush(2);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    gate.release();
    await flush(6);
    expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('quá nhanh');
    expect(dlg().querySelector('button[aria-label="Đóng"]')).not.toBeNull();
    esc();
    await flush(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    click(container.querySelector('article')!.querySelector('button[aria-label="Báo cáo"]'));
    await flush(2);
    click(btn(dlg(), 'Báo cáo'));
    await flush(6);
    expect(posts('/feed/p1/report')).toHaveLength(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('trả lời: gõ thêm trong lúc lệnh đang bay thì giữ chữ mới, không bị xoá khi lệnh trước xong', async () => {
    const gate = deferred();
    mocks.post.mockReturnValue(gate.promise.then(() => ({ id: 'c9', ok: true })));
    const { container } = await mount();
    typeInto(replyInput(container), 'Cảm ơn');
    click(sendBtn(container));
    await flush(2);
    typeInto(replyInput(container), 'Cảm ơn bạn nhiều');
    gate.release();
    await flush(6);
    expect(posts('/feed/p1/comments')).toHaveLength(1);
    expect(replyInput(container).value).toBe('Cảm ơn bạn nhiều');
    expect(shownAlerts(container)).toEqual([]);
  });

  it('trả lời: không gõ thêm thì ô được xoá khi gửi xong, kể cả chữ có khoảng trắng hai đầu', async () => {
    const gate = deferred();
    mocks.post.mockReturnValue(gate.promise.then(() => ({ id: 'c9', ok: true })));
    const { container } = await mount();
    typeInto(replyInput(container), '  Cảm ơn bạn ');
    click(sendBtn(container));
    await flush(2);
    expect(replyInput(container).value).toBe('  Cảm ơn bạn ');
    gate.release();
    await flush(6);
    expect(posts('/feed/p1/comments')[0]![1]).toEqual({ body: 'Cảm ơn bạn' });
    expect(replyInput(container).value).toBe('');
  });

  it('xoá bài: bấm Xoá hai lần cùng khung hình chỉ gửi một DELETE; nút báo bận, giữ focus', async () => {
    stub(POST({ isOwner: true }));
    mocks.del.mockReturnValue(never());
    const { container } = await mount();
    click(btn(container, 'Xoá'));
    await flush(2);
    const del = btn(dlg(), 'Xoá') as HTMLButtonElement;
    del.focus();
    await twice(del);
    expect(mocks.del).toHaveBeenCalledTimes(1);
    await flush(2);
    expect(del.getAttribute('aria-busy')).toBe('true');
    expect(del.getAttribute('aria-disabled')).toBe('true');
    expect(del.disabled).toBe(false);
    expect(document.activeElement).toBe(del);
  });

  it('xoá bài: xoá xong thì khoá giữ tới khi rời trang (bấm Xoá lần hai trong lúc chờ chuyển trang không gửi lại)', async () => {
    stub(POST({ isOwner: true }));
    const { container } = await mount();
    click(btn(container, 'Xoá'));
    await flush(2);
    click(btn(dlg(), 'Xoá'));
    await flush(6);
    expect(mocks.push).toHaveBeenCalledWith('/cong-dong?deleted=1');
    // Trình duyệt thật đã chuyển trang; ở đây trang còn đó nên thử bấm lại.
    await twice(btn(dlg(), /^(Xoá|Đang xoá…)$/));
    expect(mocks.del).toHaveBeenCalledTimes(1);
    // Xoá xong vẫn báo bận (không quay về nhãn "Xoá" bấm được) cho tới khi rời trang.
    expect(btn(dlg(), /^(Xoá|Đang xoá…)$/).getAttribute('aria-busy')).toBe('true');
    expect(btn(dlg(), /^(Xoá|Đang xoá…)$/).textContent).toBe('Đang xoá…');
  });

  it('xoá bài: lỗi nhả khoá, mở lại hộp xác nhận xoá được lần hai', async () => {
    stub(POST({ isOwner: true }));
    mocks.del.mockRejectedValueOnce(new Error('không xoá được'));
    const { container } = await mount();
    click(btn(container, 'Xoá'));
    await flush(2);
    click(btn(dlg(), 'Xoá'));
    await flush(6);
    expect(shownAlerts(container).join()).toContain('không xoá được');
    click(btn(container, 'Xoá'));
    await flush(2);
    click(btn(dlg(), 'Xoá'));
    await flush(6);
    expect(mocks.del).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledWith('/cong-dong?deleted=1');
  });

  it('chọn hay nhất: chạm đúp một bình luận chỉ gửi một lệnh; nút đó báo aria-busy, giữ focus', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    mocks.post.mockReturnValue(never());
    const { container } = await mount();
    const choose = buttons(container, 'Chọn hay nhất') as HTMLButtonElement[];
    choose[0]!.focus();
    await twice(choose[0]);
    expect(posts('/feed/p1/best-answer/c1')).toHaveLength(1);
    await flush(2);
    expect(choose[0]!.getAttribute('aria-busy')).toBe('true');
    expect(choose[0]!.disabled).toBe(false);
    expect(document.activeElement).toBe(choose[0]);
    expect(choose[1]!.hasAttribute('aria-busy')).toBe(false);
  });

  // Máy chủ đọc `bestCommentId` ngoài transaction: hai lệnh "hay nhất" song song trên hai bình luận đều thấy bài chưa có câu hay nhất
  // nên cộng uy tín và báo cho cả hai tác giả. Web chỉ cho một lệnh "hay nhất" bay tại một lúc trong cả bài.
  it('chọn hay nhất: hai bình luận khác nhau cùng khung hình chỉ lệnh đầu đi; nút kia báo khoá nhưng không báo busy', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    mocks.post.mockReturnValue(never());
    const { container } = await mount();
    const choose = buttons(container, 'Chọn hay nhất');
    act(() => {
      choose[0]!.click();
      choose[1]!.click();
    });
    await flush(2);
    expect(posts('/feed/p1/best-answer/c1')).toHaveLength(1);
    expect(posts('/feed/p1/best-answer/c3')).toHaveLength(0);
    await flush(2);
    expect(choose[0]!.getAttribute('aria-busy')).toBe('true');
    expect(choose[1]!.hasAttribute('aria-busy')).toBe(false);
    expect(choose[1]!.getAttribute('aria-disabled')).toBe('true');
    expect(choose[1]!.hasAttribute('disabled')).toBe(false);
  });

  it('chọn hay nhất: lệnh A còn bay thì bấm B ở khung hình sau cũng không đi; ẩn một bình luận khác vẫn đi', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    mocks.post.mockReturnValue(never());
    const { container } = await mount();
    const choose = buttons(container, 'Chọn hay nhất');
    click(choose[0]!);
    await flush(2);
    click(choose[1]!);
    await flush(2);
    expect(posts('/feed/p1/best-answer/c3')).toHaveLength(0);
    // c3 là bình luận của chính chủ bài: ẩn nó là việc khác trên bình luận khác, không dính khoá "hay nhất" của c1.
    click(container.querySelector('button[aria-label="Ẩn nội dung"]'));
    await flush(6);
    expect(mocks.del).toHaveBeenCalledTimes(1);
    // Ẩn xong (và danh sách đã tải lại) không được nhả nhầm khoá "hay nhất" của c1 đang bay.
    click(choose[1]!);
    await flush(2);
    expect(posts('/feed/p1/best-answer/c3')).toHaveLength(0);
    expect(posts('/feed/p1/best-answer/c1')).toHaveLength(1);
  });

  it('ẩn hai bình luận khác nhau cùng khung hình đều đi; một bình luận xong không nhả khoá của bình luận kia', async () => {
    stub(POST(), [COMMENT('c1', 'Bình', { isOwner: true }), COMMENT('c3', 'Tôi', { isOwner: true })]);
    mocks.del.mockReturnValueOnce(never()).mockResolvedValueOnce({ ok: true });
    const { container } = await mount();
    const hide = () => Array.from(container.querySelectorAll<HTMLElement>('button[aria-label="Ẩn nội dung"]'));
    act(() => {
      hide()[0]!.click();
      hide()[1]!.click();
    });
    await flush(6);
    expect(mocks.del).toHaveBeenCalledTimes(2);
    // Bình luận thứ hai đã xong và danh sách đã tải lại; bình luận thứ nhất còn bay nên bấm lại vẫn không đi.
    click(hide()[0]!);
    await flush(2);
    expect(mocks.del).toHaveBeenCalledTimes(2);
    expect(hide()[0]!.getAttribute('aria-busy')).toBe('true');
    expect(hide()[1]!.hasAttribute('aria-busy')).toBe(false);
  });

  it('ẩn một bình luận đang bay: chọn hay nhất ở bình luận khác vẫn đi và nút đó không báo khoá', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    mocks.del.mockReturnValue(never());
    const { container } = await mount();
    click(container.querySelector('button[aria-label="Ẩn nội dung"]'));
    await flush(2);
    const bestOfC1 = buttons(container, 'Chọn hay nhất')[0]!;
    expect(bestOfC1.hasAttribute('aria-disabled')).toBe(false);
    click(bestOfC1);
    await flush(2);
    expect(posts('/feed/p1/best-answer/c1')).toHaveLength(1);
  });

  it('chọn hay nhất: lệnh A xong và danh sách đã tải lại thì khoá nhả, chọn B đi; lệnh A lỗi cũng nhả', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    mocks.post.mockRejectedValueOnce(new Error('quá nhanh'));
    const { container } = await mount();
    const choose = buttons(container, 'Chọn hay nhất');
    click(choose[0]!);
    await flush(6);
    expect(shownAlerts(container).join()).toContain('quá nhanh');
    click(choose[1]!);
    await flush(6);
    expect(posts('/feed/p1/best-answer/c3')).toHaveLength(1);
    // Lệnh B thành công, danh sách về xong: chọn lại c1 cũng đi.
    click(choose[0]!);
    await flush(6);
    expect(posts('/feed/p1/best-answer/c1')).toHaveLength(2);
  });

  it('chọn hay nhất: khoá chung cả bài giữ tới khi danh sách mới về (lệnh A xong mà bài còn cũ thì B vẫn chưa đi)', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    const { container } = await mount();
    const choose = buttons(container, 'Chọn hay nhất');
    const gate = deferred();
    commentsGate = gate.promise;
    click(choose[0]!);
    await flush(4);
    expect(posts('/feed/p1/best-answer/c1')).toHaveLength(1);
    click(choose[1]!);
    await flush(2);
    expect(posts('/feed/p1/best-answer/c3')).toHaveLength(0);
    gate.release();
    await flush(6);
    click(choose[1]!);
    await flush(2);
    expect(posts('/feed/p1/best-answer/c3')).toHaveLength(1);
  });

  it('chọn hay nhất rồi ẩn đúng bình luận đó cùng khung hình: chỉ lệnh đầu đi (khoá chung theo bình luận)', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    mocks.post.mockReturnValue(never());
    const { container } = await mount();
    const row = byText(container, '[data-testid="comment-row"]', 'Trả lời của Tôi')!;
    act(() => {
      byText(row, 'button', 'Chọn hay nhất')!.click();
      row.querySelector<HTMLElement>('button[aria-label="Ẩn nội dung"]')!.click();
    });
    await flush(2);
    expect(posts('/feed/p1/best-answer/c3')).toHaveLength(1);
    expect(mocks.del).not.toHaveBeenCalled();
    await flush(2);
    // Nút còn lại cũng báo khoá nhưng chỉ nút đang chạy báo busy.
    expect(row.querySelector('button[aria-label="Ẩn nội dung"]')!.getAttribute('aria-disabled')).toBe('true');
    expect(row.querySelector('button[aria-label="Ẩn nội dung"]')!.hasAttribute('aria-busy')).toBe(false);
  });

  it('ẩn bình luận: chạm đúp chỉ gửi một DELETE; xong mà danh sách chưa tải lại thì chưa cho ẩn lần hai', async () => {
    const { container } = await mount();
    const hide = () => btn(container, 'Ẩn nội dung') as HTMLButtonElement;
    hide().focus();
    mocks.del.mockReturnValue(never());
    await twice(hide());
    expect(mocks.del).toHaveBeenCalledTimes(1);
    await flush(2);
    expect(hide().getAttribute('aria-busy')).toBe('true');
    expect(hide().disabled).toBe(false);
    expect(document.activeElement).toBe(hide());
  });

  it('ẩn bình luận: khoá giữ tới khi danh sách mới về, rồi nhả', async () => {
    const { container } = await mount();
    const gate = deferred();
    commentsGate = gate.promise;
    click(btn(container, 'Ẩn nội dung'));
    await flush(4);
    expect(mocks.del).toHaveBeenCalledTimes(1);
    // Lệnh đã xong, danh sách còn cũ: dòng vẫn hiện, bấm lần hai sẽ DELETE bình luận đã ẩn và nhận lỗi không tìm thấy.
    await twice(btn(container, 'Ẩn nội dung'));
    expect(mocks.del).toHaveBeenCalledTimes(1);
    gate.release();
    await flush(4);
    expect(btn(container, 'Ẩn nội dung').hasAttribute('aria-busy')).toBe(false);
  });

  it('ẩn bình luận: lỗi nhả khoá, lỗi hiện dưới đúng dòng, bấm lại gửi lần hai', async () => {
    mocks.del.mockRejectedValueOnce(new Error('máy chủ bận'));
    const { container } = await mount();
    click(btn(container, 'Ẩn nội dung'));
    await flush(6);
    expect(shownAlerts(container).join()).toContain('máy chủ bận');
    click(btn(container, 'Ẩn nội dung'));
    await flush(2);
    expect(mocks.del).toHaveBeenCalledTimes(2);
  });

  it('ADMIN ghim: chạm đúp chỉ gửi một lệnh ghim; nút báo aria-busy, giữ focus; khoá giữ tới khi bài mới về (Ghim/Bỏ ghim đảo theo bài)', async () => {
    (mocks.auth.user as { role: string }).role = 'ADMIN';
    mocks.post.mockResolvedValue({ ok: true });
    const { container } = await mount();
    const pin = () => btn(container, /^(Ghim|Bỏ ghim)$/) as HTMLButtonElement;
    pin().focus();
    const gate = deferred();
    postGate = gate.promise;
    await twice(pin());
    expect(posts('/feed/admin/p1/pin')).toHaveLength(1);
    await flush(4);
    expect(pin().getAttribute('aria-busy')).toBe('true');
    expect(pin().disabled).toBe(false);
    expect(document.activeElement).toBe(pin());
    // Bài còn cũ (chưa ghim): bấm lúc này gửi lại cùng một chiều.
    click(pin());
    await flush(2);
    expect(posts('/feed/admin/p1/pin')).toHaveLength(1);
    gate.release();
    await flush(4);
    expect(pin().hasAttribute('aria-busy')).toBe(false);
  });

  it('"Xem thêm trả lời": đang tải thì báo aria-busy + aria-disabled, không disabled (giữ focus), bấm tiếp không gọi thêm', async () => {
    commentPages = [{ items: [COMMENT('c1', 'Bình')], nextCursor: 'cur-2' }, { items: [COMMENT('c4', 'Mai')], nextCursor: null }];
    const { container } = await mount();
    const more = () => btn(container, /^(Xem thêm trả lời|Đang tải…)$/) as HTMLButtonElement;
    more().focus();
    const gate = deferred();
    commentsGate = gate.promise;
    click(more());
    await flush(2);
    expect(more().getAttribute('aria-busy')).toBe('true');
    expect(more().getAttribute('aria-disabled')).toBe('true');
    expect(more().disabled).toBe(false);
    expect(document.activeElement).toBe(more());
    click(more());
    await flush(2);
    const pageCalls = () => mocks.get.mock.calls.filter((c) => c[0] === '/feed/p1/comments' && c[1]?.query?.cursor === 'cur-2').length;
    expect(pageCalls()).toBe(1);
    gate.release();
    await flush(6);
    expect(container.textContent).toContain('Trả lời của Mai');
  });

  it('ẩn rồi chọn hay nhất đúng bình luận đó cùng khung hình: chỉ lệnh đầu đi, nút Chọn hay nhất báo khoá nhưng không báo busy', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    mocks.del.mockReturnValue(never());
    const { container } = await mount();
    const row = byText(container, '[data-testid="comment-row"]', 'Trả lời của Tôi')!;
    act(() => {
      row.querySelector<HTMLElement>('button[aria-label="Ẩn nội dung"]')!.click();
      byText(row, 'button', 'Chọn hay nhất')!.click();
    });
    await flush(2);
    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(posts('/feed/p1/best-answer/c3')).toHaveLength(0);
    const best = byText(row, 'button', 'Chọn hay nhất')!;
    expect(best.getAttribute('aria-disabled')).toBe('true');
    expect(best.hasAttribute('aria-busy')).toBe(false);
    expect(row.querySelector('button[aria-label="Ẩn nội dung"]')!.getAttribute('aria-busy')).toBe('true');
  });

  it('gửi form trả lời khi ô trống hoặc chỉ có khoảng trắng (Enter): không gọi API', async () => {
    const { container } = await mount();
    const form = container.querySelector('form')!;
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    typeInto(replyInput(container), '   ');
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush(2);
    expect(posts('/feed/p1/comments')).toHaveLength(0);
  });

  it('vùng alert của ô trả lời và của từng bình luận có sẵn trước khi lỗi, lỗi đổi chữ trên cùng phần tử', async () => {
    stub(POST({ isOwner: true, kind: 'QUESTION', title: 'Hỏi' }));
    mocks.post.mockRejectedValue(new Error('quá nhanh'));
    const { container } = await mount();
    const replyAlert = container.querySelector('form [role="alert"]')!;
    expect(replyAlert.textContent).toBe('');
    const row = byText(container, '[data-testid="comment-row"]', 'Trả lời của Bình')!;
    const rowAlert = row.querySelector('[role="alert"]')!;
    expect(rowAlert.textContent).toBe('');
    expect(rowAlert.className).toBe('sr-only');
    typeInto(replyInput(container), 'Xin chào');
    click(sendBtn(container));
    await flush(6);
    expect(container.querySelector('form [role="alert"]')).toBe(replyAlert);
    expect(replyAlert.textContent).toContain('quá nhanh');
    click(byText(row, 'button', 'Chọn hay nhất'));
    await flush(6);
    expect(byText(container, '[data-testid="comment-row"]', 'Trả lời của Bình')!.querySelector('[role="alert"]')).toBe(rowAlert);
    expect(rowAlert.textContent).toContain('quá nhanh');
    expect(rowAlert.className).not.toContain('sr-only');
  });

  it('sheet Sửa và Báo cáo: vùng alert có sẵn trước khi lỗi, lỗi đổi chữ trên cùng phần tử', async () => {
    stub(POST({ isOwner: true }));
    mocks.patch.mockRejectedValue(new Error('máy chủ bận'));
    const a = await mount();
    click(btn(a.container, 'Sửa'));
    await flush(2);
    const editAlert = dlg().querySelector('[role="alert"]')!;
    expect(editAlert.textContent).toBe('');
    click(btn(dlg(), 'Lưu'));
    await flush(6);
    expect(dlg().querySelector('[role="alert"]')).toBe(editAlert);
    expect(editAlert.textContent).toContain('máy chủ bận');
    mounted.pop()!.unmount();
    stub(POST());
    mocks.post.mockRejectedValue(new Error('quá nhanh'));
    const b = await mount();
    click(b.container.querySelector('article')!.querySelector('button[aria-label="Báo cáo"]'));
    await flush(2);
    const reportAlert = dlg().querySelector('[role="alert"]')!;
    expect(reportAlert.textContent).toBe('');
    click(btn(dlg(), 'Báo cáo'));
    await flush(6);
    expect(dlg().querySelector('[role="alert"]')).toBe(reportAlert);
    expect(reportAlert.textContent).toContain('quá nhanh');
  });

  it('vùng báo luôn có trong DOM: thông báo đổi nội dung trên cùng phần tử, không dựng lại', async () => {
    const { container } = await mount();
    const status = container.querySelector('[role="status"]')!;
    const alert = container.querySelector('[role="alert"]')!;
    expect(status.textContent).toBe('');
    expect(alert.textContent).toBe('');
    click(container.querySelector('article')!.querySelector('button[aria-label="Báo cáo"]'));
    await flush(2);
    click(btn(dlg(), 'Báo cáo'));
    await flush(6);
    expect(container.querySelector('[role="status"]')).toBe(status);
    expect(status.textContent).toContain('Đã gửi báo cáo, cảm ơn bạn');
    mocks.post.mockRejectedValue(new Error('mạng hỏng'));
    click(likeBtn(container));
    await flush(6);
    expect(container.querySelector('[role="alert"]')).toBe(alert);
    expect(alert.textContent).toContain('mạng hỏng');
  });
});
