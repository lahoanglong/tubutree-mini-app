// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({ fetchProductReviews: vi.fn() }));
vi.mock('@/lib/reviews-client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/reviews-client')>()), fetchProductReviews: mocks.fetchProductReviews }));

import { PdpQuickReviews } from './pdp-quick-reviews';

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, rating: 5, comment: `Dùng rất ổn ${id}`, images: [] as string[], videoUrl: null as string | null, createdAt: '2026-10-01T00:00:00.000Z', author: 'Lan', ...over,
});

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
beforeEach(() => {
  mocks.fetchProductReviews.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('PdpQuickReviews (web)', () => {
  it('hiện điểm, số lượt, đúng 2 đánh giá có chữ (có ảnh trước) và nút "Xem tất cả (n)" cuộn tới #danh-gia', async () => {
    mocks.fetchProductReviews.mockResolvedValue({ average: 4.4, count: 27, distribution: {}, items: [item('a'), item('b', { comment: null }), item('c', { images: ['x.jpg'] }), item('d')] });
    const target = document.createElement('section');
    target.id = 'danh-gia';
    document.body.appendChild(target);
    const { container } = mount(<PdpQuickReviews slug="dau-goi" />);
    await flush();
    expect(byText(container, 'h2', 'Đánh giá')).not.toBeNull();
    expect(container.textContent).toContain('4,4');
    // Tên đọc của dải sao đầu khối là điểm trung bình (như số đang hiện); mỗi đánh giá là điểm một khách chấm.
    const labels = Array.from(container.querySelectorAll('[role="img"]')).map((e) => e.getAttribute('aria-label'));
    expect(labels).toEqual(['4,4 trên 5 sao', '5 trên 5 sao', '5 trên 5 sao']);
    expect(container.querySelectorAll('[data-testid="quick-review"]')).toHaveLength(2);
    expect(container.textContent).toContain('Dùng rất ổn c');
    click(byText(container, 'button', 'Xem tất cả (27)'));
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts.at(-1)).toBe(target);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
    target.remove();
  });

  it('điện thoại: là một dải trắng riêng cách dải trên 8px (như Mini App), có data-section cho bài so thứ tự', async () => {
    mocks.fetchProductReviews.mockResolvedValue({ average: 4.4, count: 27, distribution: {}, items: [item('a')] });
    const { container } = mount(<PdpQuickReviews slug="dau-goi" />);
    await flush();
    const section = container.querySelector('section[aria-label="Đánh giá nhanh"]')!;
    expect(section.getAttribute('data-section')).toBe('pdp-quick-reviews');
    expect(section.className).toContain('max-md:mt-2');
    expect(section.className).toContain('max-md:bg-[var(--color-bg-surface)]');
    expect(section.className).toContain('max-md:p-4');
  });

  it('không có đánh giá có chữ, đang tải hoặc lỗi thì không dựng gì', async () => {
    mocks.fetchProductReviews.mockResolvedValue({ average: 4, count: 3, distribution: {}, items: [item('a', { comment: null })] });
    const none = mount(<PdpQuickReviews slug="a" />);
    await flush();
    expect(none.container.innerHTML).toBe('');
    mocks.fetchProductReviews.mockRejectedValue(new Error('500'));
    const failed = mount(<PdpQuickReviews slug="b" />);
    await flush();
    expect(failed.container.innerHTML).toBe('');
  });
});

describe('PdpQuickReviews (web): số đều, huy hiệu "Đã mua", dải ảnh thu nhỏ (W51A)', () => {
  const ABS = 'https://res.cloudinary.com/tubu/image/upload/a.jpg';
  const load = async (items: unknown[]) => {
    mocks.fetchProductReviews.mockResolvedValue({ average: 4.4, count: 27, distribution: {}, items });
    const m = mount(<PdpQuickReviews slug="dau-goi" />);
    await flush();
    return m.container;
  };
  const rowOf = (c: HTMLElement, author: string) =>
    Array.from(c.querySelectorAll<HTMLElement>('[data-testid="quick-review"]')).find((r) => r.textContent!.includes(author))!;

  it('"điểm · số lượt" và nút "Xem tất cả (n)" dùng số đều (tabular-nums) để không nhảy khi số đổi', async () => {
    const c = await load([item('a')]);
    expect(byText(c, 'span', '4,4 · 27')!.className).toContain('tabular-nums');
    expect(byText(c, 'button', 'Xem tất cả (27)')!.className).toContain('tabular-nums');
  });

  it('huy hiệu "Đã mua" chỉ hiện ở đánh giá verifiedPurchase=true, cùng hàng với tên người đánh giá', async () => {
    const c = await load([
      item('a', { author: 'Lan', verifiedPurchase: true }),
      item('b', { author: 'Mai', verifiedPurchase: false }),
    ]);
    const badge = rowOf(c, 'Lan').querySelector('[data-testid="quick-review-verified"]')!;
    expect(badge.textContent).toBe('Đã mua');
    expect(badge.parentElement).toBe(byText(rowOf(c, 'Lan'), 'span', 'Lan')!.parentElement);
    expect(rowOf(c, 'Mai').querySelector('[data-testid="quick-review-verified"]')).toBeNull();
    expect(c.querySelectorAll('[data-testid="quick-review-verified"]')).toHaveLength(1);
  });

  it('đánh giá không có trường verifiedPurchase (API cũ) thì không có huy hiệu', async () => {
    const c = await load([item('a')]);
    expect(c.querySelector('[data-testid="quick-review-verified"]')).toBeNull();
  });

  it('dải ảnh thu nhỏ nằm dưới nhận xét: tối đa 3 ảnh, ảnh trang trí (alt rỗng, lazy)', async () => {
    const c = await load([item('a', { images: ['/reviews/r1/images/0', '/reviews/r1/images/1', '/reviews/r1/images/2', '/reviews/r1/images/3'] })]);
    const strip = c.querySelector('[data-testid="quick-review-photos"]')!;
    const imgs = Array.from(strip.querySelectorAll('img'));
    expect(imgs).toHaveLength(3);
    imgs.forEach((img) => {
      expect(img.getAttribute('alt')).toBe('');
      expect(img.getAttribute('loading')).toBe('lazy');
      // Ảnh gốc (Cloudinary) có thể rộng cả nghìn px: không có lớp 48px này thì tràn khung 375px.
      expect(img.className).toContain('h-12');
      expect(img.className).toContain('w-12');
    });
    expect(strip.previousElementSibling!.tagName).toBe('P');
    expect(strip.previousElementSibling!.textContent).toBe('Dùng rất ổn a');
  });

  it('ảnh do API phục vụ (đường dẫn "/…") được ghép gốc API, URL tuyệt đối (Cloudinary) giữ nguyên như danh sách đầy đủ', async () => {
    const c = await load([item('a', { images: [ABS, '/reviews/r1/images/0'] })]);
    const srcs = Array.from(c.querySelectorAll('[data-testid="quick-review-photos"] img')).map((img) => img.getAttribute('src'));
    expect(srcs).toHaveLength(2);
    expect(srcs[0]).toBe(ABS);
    expect(srcs[1]).toMatch(/^https?:\/\/.+\/reviews\/r1\/images\/0$/);
  });

  it('không có ảnh thì không dựng dải ảnh', async () => {
    const c = await load([item('a')]);
    expect(c.querySelector('[data-testid="quick-review-photos"]')).toBeNull();
  });

  it('có huy hiệu và dải ảnh vẫn không có control thiếu tên hay nhỏ hơn 44px', async () => {
    const c = await load([item('a', { verifiedPurchase: true, images: ['/reviews/r1/images/0', ABS] }), item('b', { verifiedPurchase: true })]);
    expect(c.querySelectorAll('[data-testid="quick-review-verified"]')).toHaveLength(2);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});
