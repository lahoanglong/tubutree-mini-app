// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { PdpLayout } from './pdp-layout';

let r: Rendered | null = null;
afterEach(() => {
  r?.unmount();
  r = null;
});

const mount = (aside?: boolean) =>
  render(<PdpLayout gallery={<p>ANH</p>} info={<p>THONG TIN</p>} below={<p>DUOI</p>} aside={aside ? <p>BEN</p> : undefined} />);

describe('PdpLayout', () => {
  it('đặt đủ ba vùng, đúng thứ tự đọc: ảnh, thông tin, rồi phần dưới', () => {
    r = mount();
    const text = r.container.textContent ?? '';
    expect(text.indexOf('ANH')).toBeLessThan(text.indexOf('THONG TIN'));
    expect(text.indexOf('THONG TIN')).toBeLessThan(text.indexOf('DUOI'));
  });

  it('từ lg: lưới ảnh 440px + thông tin trong MỘT thẻ trắng, hàng dưới có cột phụ 280px khi có aside', () => {
    r = mount(true);
    const card = r.container.querySelector('[data-testid="pdp-card"]') as HTMLElement;
    expect(card.className).toContain('lg:grid-cols-[440px_minmax(0,1fr)]');
    expect(card.className).toContain('bg-[var(--color-bg-surface)]');
    expect(card.textContent).toContain('ANH');
    expect(card.textContent).toContain('THONG TIN');
    expect(card.textContent).not.toContain('DUOI');
    const rest = r.container.querySelector('[data-testid="pdp-rest"]') as HTMLElement;
    expect(rest.className).toContain('lg:grid-cols-[minmax(0,1fr)_280px]');
    expect(rest.textContent).toContain('BEN');
  });

  it('không có aside: hàng dưới một cột', () => {
    r = mount();
    const rest = r.container.querySelector('[data-testid="pdp-rest"]') as HTMLElement;
    expect(rest.className).not.toContain('280px');
  });

  it('từ lg ô ảnh dính dưới header (chỉ khi khung nhìn cao ≥ 48rem) và tự co theo nội dung, để cột trái không hở trắng', () => {
    r = mount(true);
    const cell = r.container.querySelector('[data-testid="pdp-gallery-cell"]') as HTMLElement;
    expect(cell.textContent).toBe('ANH');
    expect(cell.className).toContain('min-w-0');
    expect(cell.className).toContain('lg:self-start');
    expect(cell.className).toContain('lg:top-[calc(var(--header-h)+1rem)]');
    expect(cell.className).toContain('lg:[@media(min-height:48rem)]:sticky');
    // Dính chỉ ở lg: không có dạng `sticky` trần hay `md:sticky` làm ảnh dính ở khổ hẹp.
    expect(cell.className).not.toMatch(/(^|\s)(md:)?sticky/);
  });

  it('cột thông tin cuộn cùng trang: không dính, không vùng cuộn riêng, không max-height theo khung nhìn', () => {
    r = mount(true);
    const card = r.container.querySelector('[data-testid="pdp-card"]') as HTMLElement;
    const cell = card.querySelector('[data-testid="pdp-gallery-cell"]') as HTMLElement;
    const info = Array.from(card.children).find((c) => c !== cell) as HTMLElement;
    expect(info.textContent).toBe('THONG TIN');
    const outside = r.container.innerHTML.replace(cell.outerHTML, '');
    expect(outside).not.toMatch(/overflow-y-auto|sticky|max-h-\[calc\(100vh/);
    expect(cell.className).not.toMatch(/overflow|max-h-/);
  });

  it('dưới md xếp dọc nguyên con: bố cục không dùng lớp max-md:', () => {
    r = mount(true);
    expect(r.container.innerHTML).not.toContain('max-md:');
  });
});
