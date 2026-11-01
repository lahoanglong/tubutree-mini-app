// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { SectionCardView } from '@tubutree/app-core/commerce/storefront-builder';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { SectionCard } from './section-card';

const view = (over: Partial<SectionCardView> = {}): SectionCardView => ({
  id: 's1', title: 'Bếp xanh', style: 'CAROUSEL', styleLabel: 'Kệ ngang', total: 4, countText: 'Kệ ngang · 4 món',
  thumbs: ['/a.jpg', '/b.jpg', '/c.jpg'], warnings: [], tabOnly: false, spoken: 'Bếp xanh, Kệ ngang, 4 món.', ...over,
});
const btn = () => document.querySelector<HTMLButtonElement>('[data-testid="section-card"] button')!;

describe('SectionCard (web)', () => {
  it('cả thẻ là một nút, tên truy cập là chữ đọc của view; bấm mở một lần', () => {
    const onOpen = vi.fn();
    mount(<SectionCard view={view()} onOpen={onOpen} />);
    expect(btn().getAttribute('aria-label')).toBe('Bếp xanh, Kệ ngang, 4 món.');
    click(btn());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="section-card"]')!.getAttribute('data-section-id')).toBe('s1');
  });

  it('hiện kiểu và số món; ảnh trang trí có alt rỗng', () => {
    mount(<SectionCard view={view()} onOpen={() => undefined} />);
    expect(document.body.textContent).toContain('Kệ ngang · 4 món');
    for (const img of Array.from(document.querySelectorAll('img'))) expect(img.getAttribute('alt')).toBe('');
  });

  it('mỗi cảnh báo là một dòng; tab Danh mục có dòng riêng và có trong tên đọc', () => {
    mount(<SectionCard view={view({ warnings: ['Thêm ít nhất 1 món nữa.', 'Khách thấy 6/9 món ở tab Shop; 3 món còn lại ở tab Sản phẩm.'], tabOnly: true })} onOpen={() => undefined} />);
    expect(document.body.textContent).toContain('Thêm ít nhất 1 món nữa.');
    expect(document.body.textContent).toContain('Khách thấy 6/9 món');
    expect(btn().textContent).toContain('Chỉ hiện ở tab Danh mục');
    expect(btn().getAttribute('aria-label')).toContain('Chỉ hiện ở tab Danh mục');
  });

  it('tên dài có dấu: cắt hai dòng, không nowrap, nút cao tối thiểu 44', () => {
    const long = 'Bộ sưu tập những sản phẩm tẩy rửa sinh học thân thiện môi trường cho gia đình';
    mount(<SectionCard view={view({ title: long })} onOpen={() => undefined} />);
    const title = Array.from(document.querySelectorAll<HTMLElement>('span')).find((s) => s.textContent === long)!;
    expect(title.style.whiteSpace).not.toBe('nowrap');
    expect(title.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    expect(parseFloat(btn().style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('không có ảnh thì không vẽ dải ảnh', () => {
    mount(<SectionCard view={view({ thumbs: [] })} onOpen={() => undefined} />);
    expect(document.querySelector('[data-testid="section-thumbs"]')).toBeNull();
  });
});
