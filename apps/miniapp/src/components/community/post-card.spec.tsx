import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FeedItem } from '../../services/feed-api';
import { describeNested, findNestedInteractive } from '../ui/nested-interactive';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
}));

import PostCard, { KIND_LABEL } from './post-card';

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

const withTags: FeedItem = {
  ...POST,
  productTags: [{ slug: 'nuoc-rua-chen', name: 'Nước rửa chén sinh học', thumbnail: null, salePrice: 79_000, basePrice: 89_000 }],
  tags: [{ slug: 'da-nhay-cam', name: 'da nhạy cảm' }],
};

/** So khớp theo chữ, bỏ emoji và khoảng trắng: bản cũ gộp emoji vào cùng nút văn bản ("🤍 12"). */
const plain = (s: string) => s.replace(/[\p{Extended_Pictographic}\s]/gu, '');
const byPlain = (text: string) => (content: string) => plain(content) === plain(text);

const renderCard = (post: FeedItem = POST, onClick = vi.fn()) => {
  const view = render(<PostCard post={post} onClick={onClick} />);
  return { ...view, onClick };
};

beforeEach(() => vi.clearAllMocks());

describe('PostCard — ảnh bìa (ENGAGE-7)', () => {
  const withImages = (imageCount: number): FeedItem => ({ ...POST, images: ['https://res.cloudinary.com/demo/a.jpg'], imageCount });

  it('bài nhiều ảnh: hiện ảnh bìa và số ảnh còn lại', () => {
    const { container } = renderCard(withImages(4));
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByText('+3 ảnh nữa')).toBeInTheDocument();
  });

  it('bài một ảnh: không hiện số ảnh còn lại', () => {
    renderCard(withImages(1));
    expect(screen.queryByText(/ảnh nữa/)).toBeNull();
  });
});

describe('PostCard — hành vi giữ nguyên khi chuyển DS v2', () => {
  it('hiện tác giả, tiêu đề, nội dung, thời gian, danh mục, số like/bình luận', () => {
    renderCard();
    expect(screen.getByText('Lan Anh')).toBeInTheDocument();
    expect(screen.getByText('Nước rửa chén dùng được cho bình sữa không?')).toBeInTheDocument();
    expect(screen.getByText(/muốn hỏi có rửa được bình sữa/)).toBeInTheDocument();
    expect(screen.getByText(/3 giờ trước · .*Nhà bếp/)).toBeInTheDocument();
    expect(screen.getByText(byPlain('12'))).toBeInTheDocument();
    expect(screen.getByText(byPlain('3'))).toBeInTheDocument();
  });

  it('bấm vào nút mở bài (tiêu đề) gọi onClick', () => {
    const { onClick } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: POST.title! }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('câu hỏi đã có câu trả lời hay → hiện nhãn; kind QUESTION có nhãn loại bài', () => {
    renderCard({ ...POST, bestCommentId: 'cm1' });
    expect(screen.getByText(byPlain('Đã có câu trả lời hay'))).toBeInTheDocument();
    expect(screen.getByText(/Hỏi đáp/)).toBeInTheDocument();
  });

  it.each([
    ['HARVEST', 'Thu hoạch'],
    ['SPECIES', 'Sưu tập loài'],
    ['MILESTONE', 'Mốc cộng đồng'],
    ['MANUAL', 'Chia sẻ'],
  ] as const)('loại bài hệ thống %s: nhãn "%s" đi cùng icon nét, không emoji (D7-6)', (kind, label) => {
    renderCard({ ...POST, kind, title: null });
    const el = screen.getByText(label);
    expect(el.textContent).toBe(label);
    expect(el.querySelector('svg')).not.toBeNull();
  });

  it('huy hiệu chuyên gia chỉ hiện khi badge = EXPERT', () => {
    const first = renderCard();
    expect(screen.queryByText(/Chuyên gia Tubu/)).toBeNull();
    first.unmount();
    renderCard({ ...POST, badge: 'EXPERT' });
    expect(screen.getByText(/Chuyên gia Tubu/)).toBeInTheDocument();
  });

  it('thẻ sản phẩm gắn kèm hiện giá khuyến mãi và mở /product/:slug mà KHÔNG kích hoạt onClick của thẻ', () => {
    const { onClick } = renderCard(withTags);
    expect(screen.getByText('79.000đ')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Nước rửa chén sinh học'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('bấm hashtag mở /feed?tag=…&tagName=… mà KHÔNG kích hoạt onClick của thẻ', () => {
    const { onClick } = renderCard(withTags);
    fireEvent.click(screen.getByText('da nhạy cảm'));
    expect(mocks.navigate).toHaveBeenCalledWith('/feed?tag=da-nhay-cam&tagName=da%20nh%E1%BA%A1y%20c%E1%BA%A3m');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('KIND_LABEL (dùng lại ở trang kiểm duyệt) vẫn có nhãn tiếng Việt cho 3 loại bài người dùng đăng', () => {
    expect(KIND_LABEL.QUESTION).toContain('Hỏi đáp');
    expect(KIND_LABEL.SHOWCASE).toContain('Trải nghiệm');
    expect(KIND_LABEL.TIP).toContain('Mẹo hay');
  });
});

const card = () => screen.getByTestId('post-card');
const NO_TITLE: FeedItem = { ...POST, title: null };

describe('PostCard — bàn phím, vùng chạm, biểu tượng (C-076, C-113)', () => {
  it('nút mở bài là nút thật Tab tới được; Enter và Space gọi onClick', async () => {
    const user = userEvent.setup();
    const { onClick } = renderCard();
    await user.tab();
    const open = screen.getByRole('button', { name: POST.title! });
    expect(open.tagName).toBe('BUTTON');
    expect(open).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('Enter trên thẻ sản phẩm gắn kèm / hashtag chỉ điều hướng, không kích hoạt onClick của thẻ', async () => {
    const user = userEvent.setup();
    const { onClick } = renderCard(withTags);
    const product = screen.getByText('Nước rửa chén sinh học').closest('[role="button"]') as HTMLElement;
    expect(product).not.toBeNull();
    expect(Number.parseFloat(product.style.minHeight)).toBeGreaterThanOrEqual(44);
    product.focus();
    await user.keyboard('{Enter}');
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen');
    const tag = screen.getByText('da nhạy cảm').closest('button') as HTMLElement;
    tag.focus();
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('hashtag là nút thật với vùng chạm 44px', () => {
    renderCard(withTags);
    const tag = screen.getByText('da nhạy cảm').closest('button') as HTMLElement;
    expect(tag.tagName).toBe('BUTTON');
    expect(tag.className).toContain('tubu-hit-44');
  });

  it('không dùng emoji làm biểu tượng cho avatar, nhãn loại bài, chuyên gia, like, bình luận, câu trả lời hay', () => {
    const { container } = renderCard({ ...POST, badge: 'EXPERT', liked: true, bestCommentId: 'cm1' });
    expect(container.textContent).not.toMatch(/[💚🤍💬✅🌱🌿❓💡]/u);
  });
});

describe('PostCard — hàng tác giả gọn (D7 #8)', () => {
  const LONG = 'Nguyễn Thị Thanh Hương Trần Lê Bảo Châu Phạm Minh Anh';

  it('tên tác giả một dòng, cắt bằng "…"; huy hiệu nằm dòng dưới cùng dòng thời gian, không chen cạnh tên', () => {
    renderCard({ ...POST, author: LONG, badge: 'EXPERT', authorLevel: 3 });
    const name = screen.getByText(LONG);
    expect(name.style.whiteSpace).toBe('nowrap');
    expect(name.style.overflow).toBe('hidden');
    expect(name.style.textOverflow).toBe('ellipsis');
    const expert = screen.getByText(/Chuyên gia Tubu/);
    const rank = screen.getByText(/Cây/);
    const time = screen.getByText(/3 giờ trước/);
    expect(name.contains(expert)).toBe(false);
    expect(name.parentElement).not.toBe(expert.parentElement);
    // Cùng một hàng với dòng thời gian (hàng này tự xuống dòng khi chật).
    expect(expert.parentElement).toBe(time.parentElement);
    expect(rank.parentElement).toBe(time.parentElement);
    expect(time.parentElement!.style.flexWrap).toBe('wrap');
  });

  it('khối chữ của hàng tác giả được phép co (minWidth 0) để tên dài cắt "…" thay vì đẩy tràn thẻ', () => {
    renderCard({ ...POST, author: LONG });
    expect(screen.getByText(LONG).parentElement!.style.minWidth).toBe('0px');
  });
});

describe('PostCard — hashtag (D7 #8)', () => {
  const LONG_TAG = 'cach-lam-nuoc-rua-chen-sinh-hoc-tu-vo-trai-cay-tai-nha-cho-gia-dinh';

  it('hashtag dài: chip có maxWidth và nhãn cắt bằng "…" (không tràn mép phải)', () => {
    renderCard({ ...POST, tags: [{ slug: LONG_TAG, name: LONG_TAG }] });
    const label = screen.getByText(LONG_TAG);
    expect(label.style.overflow).toBe('hidden');
    expect(label.style.textOverflow).toBe('ellipsis');
    const chip = label.closest('button') as HTMLElement;
    expect(chip.style.maxWidth).toBe('100%');
    expect(label.closest('button')!.parentElement!.style.maxWidth).toBe('60%');
  });

  it('hashtag trùng với thẻ sản phẩm gắn kèm (theo tên hoặc slug, bỏ dấu và dấu cách) thì bỏ; hashtag khác vẫn giữ', () => {
    renderCard({
      ...POST,
      productTags: [{ slug: 'nuoc-rua-chen', name: 'Nước rửa chén sinh học', thumbnail: null, salePrice: 79_000, basePrice: 89_000 }],
      tags: [
        { slug: 'nuoc-rua-chen-sinh-hoc', name: 'nước rửa chén sinh học' },
        { slug: 'nuoc-rua-chen', name: 'nuoc rua chen' },
        { slug: 'da-nhay-cam', name: 'da nhạy cảm' },
      ],
    });
    expect(screen.queryByText('nước rửa chén sinh học')).toBeNull();
    expect(screen.queryByText('nuoc rua chen')).toBeNull();
    expect(screen.getByText('da nhạy cảm')).toBeInTheDocument();
    // Thẻ sản phẩm vẫn còn.
    expect(screen.getByText('Nước rửa chén sinh học')).toBeInTheDocument();
  });

  it('mọi hashtag đều trùng thẻ sản phẩm → không dựng hàng hashtag trống', () => {
    const { container } = renderCard({
      ...POST,
      productTags: [{ slug: 'xa-phong', name: 'Xà phòng', thumbnail: null, salePrice: null, basePrice: 20_000 }],
      tags: [{ slug: 'xa-phong', name: 'xà phòng' }],
    });
    expect(container.querySelector('button.tubu-hit-44')).toBeNull();
  });

  it('bài không có thẻ sản phẩm: giữ nguyên mọi hashtag', () => {
    renderCard({ ...POST, tags: [{ slug: 'a', name: 'xanh' }, { slug: 'b', name: 'sạch' }] });
    expect(screen.getByText('xanh')).toBeInTheDocument();
    expect(screen.getByText('sạch')).toBeInTheDocument();
  });

  it('hashtag ngắn chỉ là một đoạn của tên sản phẩm (vd "chén") KHÔNG bị coi là trùng', () => {
    renderCard({
      ...POST,
      productTags: [{ slug: 'nuoc-rua-chen', name: 'Nước rửa chén sinh học', thumbnail: null, salePrice: null, basePrice: 89_000 }],
      tags: [{ slug: 'chen', name: 'chén' }],
    });
    expect(screen.getByText('chén')).toBeInTheDocument();
  });
});

describe('PostCard — không lồng phần tử tương tác (axe nested-interactive, thẻ ở /feed)', () => {
  it('bài có thẻ sản phẩm và hashtag: không phần tử bấm được nào chứa phần tử focus được khác', () => {
    const { container } = renderCard(withTags);
    expect(screen.getByText('Nước rửa chén sinh học').closest('[role="button"]')).not.toBeNull();
    expect(screen.getByText('da nhạy cảm').closest('button')).not.toBeNull();
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });

  it('vỏ thẻ không phải phần tử tương tác: nút mở bài là nút thật và anh em của thẻ sản phẩm / hashtag, không phải cha của chúng', () => {
    renderCard(withTags);
    expect(card()).not.toHaveAttribute('role');
    expect(card()).not.toHaveAttribute('tabindex');
    const open = screen.getByRole('button', { name: POST.title! });
    expect(open.className).toContain('tubu-tile-link');
    expect(open.style.position).toBe('');
    expect(open).not.toContainElement(screen.getByText('Nước rửa chén sinh học'));
    expect(open).not.toContainElement(screen.getByText('da nhạy cảm'));
  });

  it('vỏ thẻ position:relative + isolation; thẻ sản phẩm và hashtag nổi trên lớp phủ bằng z-index', () => {
    renderCard(withTags);
    expect(card().style.position).toBe('relative');
    expect(card().style.isolation).toBe('isolate');
    for (const target of [screen.getByText('Nước rửa chén sinh học'), screen.getByText('da nhạy cảm')]) {
      let el: HTMLElement | null = target;
      let lifted = false;
      while (el && el !== card()) {
        if (el.style.zIndex === '1') lifted = true;
        el = el.parentElement;
      }
      expect(lifted).toBe(true);
    }
  });

  it('bài không tiêu đề: nội dung chính là nút mở bài (vẫn có đúng một nút mở bài)', () => {
    const { onClick } = renderCard(NO_TITLE);
    const open = screen.getByRole('button', { name: /muốn hỏi có rửa được bình sữa/ });
    expect(open.className).toContain('tubu-tile-link');
    fireEvent.click(open);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('bài có tiêu đề: nội dung là mô tả của nút mở bài, không nằm trong nút', () => {
    renderCard();
    const open = screen.getByRole('button', { name: POST.title! });
    expect(open).toHaveAccessibleDescription(/muốn hỏi có rửa được bình sữa/);
    expect(open).not.toContainElement(screen.getByText(/muốn hỏi có rửa được bình sữa/));
  });

  it('nút mở bài có vùng chạm 44px khai báo mà không làm thẻ cao thêm (đệm dọc bù bằng lề âm)', () => {
    renderCard();
    const open = screen.getByRole('button', { name: POST.title! });
    expect(parseInt(open.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(open.style.padding)).toBe(-parseFloat(open.style.marginTop.replace('px', '')));
  });

  it('tokens.css: lớp phủ phẳng (không bo góc thẻ sản phẩm) cho thẻ bài đăng toàn bề ngang', () => {
    const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
    expect(css).toMatch(/\.tubu-tile-link\[data-flat\]::after\s*\{[^}]*border-radius:\s*0/);
  });
});
