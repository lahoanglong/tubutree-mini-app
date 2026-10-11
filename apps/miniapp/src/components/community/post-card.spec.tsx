import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FeedItem } from '../../services/feed-api';

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

  it('bấm vào thẻ gọi onClick', () => {
    const { onClick } = renderCard();
    fireEvent.click(screen.getByText('Lan Anh'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('câu hỏi đã có câu trả lời hay → hiện nhãn; kind QUESTION có nhãn loại bài', () => {
    renderCard({ ...POST, bestCommentId: 'cm1' });
    expect(screen.getByText(byPlain('Đã có câu trả lời hay'))).toBeInTheDocument();
    expect(screen.getByText(/Hỏi đáp/)).toBeInTheDocument();
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

describe('PostCard — bàn phím, vùng chạm, biểu tượng (C-076, C-113)', () => {
  it('thẻ là nút Tab tới được và Enter gọi onClick', () => {
    const { onClick } = renderCard();
    const card = screen.getByText('Lan Anh').closest('[role="button"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.tabIndex).toBe(0);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Enter trên thẻ sản phẩm gắn kèm / hashtag chỉ điều hướng, không kích hoạt onClick của thẻ', () => {
    const { onClick } = renderCard(withTags);
    const product = screen.getByText('Nước rửa chén sinh học').closest('[role="button"]') as HTMLElement;
    expect(product).not.toBeNull();
    expect(Number.parseFloat(product.style.minHeight)).toBeGreaterThanOrEqual(44);
    fireEvent.keyDown(product, { key: 'Enter' });
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nuoc-rua-chen');
    const tag = screen.getByText('da nhạy cảm').closest('button') as HTMLElement;
    fireEvent.keyDown(tag, { key: 'Enter' });
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
