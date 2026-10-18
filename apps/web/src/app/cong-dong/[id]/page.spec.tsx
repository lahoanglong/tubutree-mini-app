// @vitest-environment jsdom
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
  useParams: () => mocks.params,
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.del } }));

import PostDetailPage from './page';

const POST = (over: Partial<FeedItem> = {}): FeedItem => ({
  id: 'p1', kind: 'TIP', status: 'APPROVED', title: null, body: 'Mẹo rửa bình sữa bằng nước rửa chén sinh học.', images: [], meta: null,
  createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), author: 'Lan Anh', avatar: null, badge: null, authorLevel: 1,
  category: { id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null }, productTags: [], tags: [], isPinned: false, likeCount: 5, commentCount: 2,
  liked: false, bestCommentId: null, isOwner: false, ...over,
});
const COMMENT = (id: string, author: string, over: Partial<FeedComment> = {}): FeedComment => ({
  id, body: `Trả lời của ${author}`, author, avatar: null, badge: null, authorLevel: 1, isAccepted: false,
  createdAt: new Date(Date.now() - 3600 * 1000).toISOString(), isOwner: false, ...over,
});
const COMMENTS = [COMMENT('c1', 'Bình'), COMMENT('c2', 'Hạnh', { isAccepted: true }), COMMENT('c3', 'Tôi', { isOwner: true })];

let postData: FeedItem;
let commentPages: { items: FeedComment[]; nextCursor: string | null }[];
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

beforeEach(() => {
  Object.assign(mocks.auth, { user: { id: 'u1', role: 'CUSTOMER' }, status: 'authenticated', initialized: true, sessionUnavailable: false });
  mocks.params.id = 'p1';
  mocks.push.mockReset();
  stub();
  let page = 0;
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: { cursor?: string } }) => {
    if (path === '/feed/p1') return postData;
    if (path === '/feed/p1/comments') {
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
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('quá nhanh');
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
    click(btn(dlg(), 'Hủy'));
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
    expect(container.querySelector('[role="alert"]')).toBeNull();
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
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it('ô trả lời giới hạn 500 ký tự như API', async () => {
    const { container } = await mount();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Viết trả lời…"]')!.maxLength).toBe(500);
  });
});
