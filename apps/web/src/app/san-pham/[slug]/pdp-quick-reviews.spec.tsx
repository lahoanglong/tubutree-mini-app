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
