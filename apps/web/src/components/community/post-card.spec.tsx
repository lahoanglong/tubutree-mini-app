// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { FeedItem } from '@tubutree/app-core/api/feed';
import { render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { PostCard } from './post-card';

// Chép ý post-card.spec.tsx (Mini App): ảnh bìa, tác giả/tiêu đề/nội dung/số liệu, nhãn loại bài, huy hiệu, thẻ sản phẩm và
// hashtag không lồng phần tử tương tác, hashtag trùng sản phẩm bị bỏ.

const POST: FeedItem = {
  id: 'p1',
  kind: 'QUESTION',
  status: 'APPROVED',
  title: 'Nước rửa chén dùng được cho bình sữa không?',
  body: 'Mình đang dùng nước rửa chén sinh học, muốn hỏi có rửa được bình sữa của bé không.',
  images: [],
  meta: null,
  createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  author: 'Lan Anh',
  avatar: null,
  badge: null,
  authorLevel: 1,
  category: { id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null },
  productTags: [],
  tags: [],
  isPinned: false,
  likeCount: 12,
  commentCount: 3,
  liked: false,
  bestCommentId: null,
  isOwner: false,
};
const WITH_TAGS: FeedItem = {
  ...POST,
  productTags: [{ slug: 'nuoc-rua-chen', name: 'Nước rửa chén sinh học', thumbnail: null, salePrice: 79_000, basePrice: 89_000 }],
  tags: [{ slug: 'da-nhay-cam', name: 'da nhạy cảm' }],
};

let mounted: Rendered[] = [];
const mount = (post: FeedItem = POST) => {
  const r = render(<PostCard post={post} />);
  mounted.push(r);
  return r.container;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const links = (c: HTMLElement) => Array.from(c.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')]);

describe('PostCard', () => {
  it('hiện tác giả, tiêu đề, nội dung, thời gian, danh mục, số like/bình luận', () => {
    const c = mount();
    const t = c.textContent ?? '';
    for (const s of ['Lan Anh', POST.title!, POST.body, '3 giờ trước', 'Nhà bếp', '12', '3', 'Hỏi đáp']) expect(t).toContain(s);
  });

  it('tiêu đề là liên kết mở /cong-dong/:id; lớp phủ liên kết phủ cả thẻ', () => {
    const c = mount();
    const a = c.querySelector<HTMLAnchorElement>('a[href="/cong-dong/p1"]')!;
    expect(a.textContent).toContain(POST.title!);
    expect(a.className).toContain('after:absolute');
    expect(a.className).toContain('after:inset-0');
  });

  it('bài không tiêu đề: nội dung là liên kết mở bài, vẫn đúng một liên kết mở bài', () => {
    const c = mount({ ...POST, title: null });
    const open = Array.from(c.querySelectorAll('a')).filter((a) => a.getAttribute('href') === '/cong-dong/p1');
    expect(open).toHaveLength(1);
    expect(open[0]!.textContent).toBe(POST.body);
  });

  it('câu hỏi đã có câu trả lời hay hiện nhãn; loại khác không hiện', () => {
    expect(mount({ ...POST, bestCommentId: 'c9' }).textContent).toContain('Đã có câu trả lời hay');
    expect(mount({ ...POST, kind: 'TIP', bestCommentId: 'c9' }).textContent).not.toContain('Đã có câu trả lời hay');
  });

  it('huy hiệu chuyên gia chỉ hiện khi badge = EXPERT; hạng từ 2 trở lên hiện', () => {
    expect(mount().textContent).not.toContain('Chuyên gia Tubu');
    const c = mount({ ...POST, badge: 'EXPERT', authorLevel: 3 });
    expect(c.textContent).toContain('Chuyên gia Tubu');
    expect(c.textContent).toContain('🌳 Cây trưởng thành');
  });

  it('thẻ sản phẩm hiện giá khuyến mãi và là liên kết /san-pham/:slug; hashtag là liên kết lọc /cong-dong?tag=…&tagName=…', () => {
    const c = mount(WITH_TAGS);
    expect(c.textContent).toContain('79.000đ');
    expect(c.textContent).not.toContain('89.000đ');
    expect(links(c)).toContainEqual([expect.stringContaining('Nước rửa chén sinh học'), '/san-pham/nuoc-rua-chen']);
    expect(links(c)).toContainEqual(['da nhạy cảm', '/cong-dong?tag=da-nhay-cam&tagName=da%20nh%E1%BA%A1y%20c%E1%BA%A3m']);
  });

  it('không có liên kết nào chứa liên kết khác (nested-interactive)', () => {
    const c = mount(WITH_TAGS);
    expect(c.querySelectorAll('a a, a button, button a')).toHaveLength(0);
  });

  it('hashtag trùng tên sản phẩm gắn kèm bị bỏ, hashtag khác giữ; không dựng hàng hashtag trống', () => {
    const p: FeedItem = { ...WITH_TAGS, tags: [{ slug: 'nuoc-rua-chen-sinh-hoc', name: 'Nước rửa chén sinh học' }, { slug: 'be', name: 'cho bé' }] };
    const names = links(mount(p)).map(([t]) => t);
    expect(names).toContain('cho bé');
    expect(names.filter((t) => t === 'Nước rửa chén sinh học')).toHaveLength(0);
    const only: FeedItem = { ...WITH_TAGS, tags: [{ slug: 'nuoc-rua-chen-sinh-hoc', name: 'Nước rửa chén sinh học' }] };
    const c = mount(only);
    expect(Array.from(c.querySelectorAll('a')).filter((a) => a.getAttribute('href')?.startsWith('/cong-dong?tag='))).toHaveLength(0);
  });

  it('ảnh bìa: nhiều ảnh hiện số ảnh còn lại, một ảnh thì không; đường dẫn API được ghép gốc API; URL lạ bị bỏ', () => {
    const many = mount({ ...POST, images: ['https://res.cloudinary.com/demo/a.jpg'], imageCount: 3 });
    expect(many.querySelector('img')!.getAttribute('src')).toBe('https://res.cloudinary.com/demo/a.jpg');
    expect(many.textContent).toContain('+2 ảnh nữa');
    expect(mount({ ...POST, images: ['https://res.cloudinary.com/demo/a.jpg'], imageCount: 1 }).textContent).not.toContain('ảnh nữa');
    expect(mount({ ...POST, images: ['/feed/p1/images/0?v=1'] }).querySelector('img')!.getAttribute('src')).toMatch(/^https?:\/\/.+\/feed\/p1\/images\/0/);
    expect(mount({ ...POST, images: ['javascript:alert(1)'] }).querySelector('img')).toBeNull();
  });

  it('nội dung người dùng được escape, không thành HTML', () => {
    const c = mount({ ...POST, title: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script>' });
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelectorAll('img[src="x"]')).toHaveLength(0);
    expect(c.textContent).toContain('<script>alert(1)</script>');
  });

  it('a11y: tên truy cập, vùng chạm 44px, không có tiêu đề h1 trong thẻ', () => {
    const c = mount(WITH_TAGS);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(c.querySelectorAll('h1')).toHaveLength(0);
  });
});

describe('PostCard — giao diện điện thoại như Mini App', () => {
  it('khối trắng tràn ngang không viền không bo không bóng dưới md', () => {
    const cls = mount().querySelector('[data-testid="post-card"]')!.className;
    for (const c of ['max-md:-mx-4', 'max-md:rounded-none', 'max-md:border-0', 'max-md:shadow-none']) expect(cls).toContain(c);
  });
});

