import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SectionCardView } from '@tubutree/app-core/commerce/storefront-builder';
import { SectionCard } from './section-card';

const view = (over: Partial<SectionCardView> = {}): SectionCardView => ({
  id: 's1',
  title: 'Bếp xanh',
  style: 'CAROUSEL',
  styleLabel: 'Kệ ngang',
  total: 4,
  countText: 'Kệ ngang · 4 món',
  thumbs: ['/a.jpg', '/b.jpg', '/c.jpg'],
  warnings: [],
  tabOnly: false,
  spoken: 'Bếp xanh, Kệ ngang, 4 món.',
  ...over,
});

describe('SectionCard', () => {
  it('cả thẻ là một nút, tên truy cập là chữ đọc của view; bấm mở một lần', () => {
    const onOpen = vi.fn();
    render(<SectionCard view={view()} onOpen={onOpen} />);
    const btn = screen.getByRole('button', { name: 'Bếp xanh, Kệ ngang, 4 món.' });
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('section-card')).toHaveAttribute('data-section-id', 's1');
  });

  it('hiện dòng kiểu và số món, ảnh trang trí (alt rỗng)', () => {
    const { container } = render(<SectionCard view={view()} onOpen={() => undefined} />);
    expect(screen.getByText('Kệ ngang · 4 món')).toBeInTheDocument();
    const imgs = Array.from(container.querySelectorAll('img'));
    for (const img of imgs) expect(img.getAttribute('alt')).toBe('');
  });

  it('mỗi cảnh báo là một dòng chữ; tab Danh mục có dòng riêng và có trong tên đọc', () => {
    render(<SectionCard view={view({ warnings: ['Thêm ít nhất 1 món nữa.', 'Khách thấy 6/9 món ở tab Shop; 3 món còn lại ở tab Sản phẩm.'], tabOnly: true })} onOpen={() => undefined} />);
    expect(screen.getByText('Thêm ít nhất 1 món nữa.')).toBeInTheDocument();
    expect(screen.getByText(/Khách thấy 6\/9 món/)).toBeInTheDocument();
    expect(screen.getByText('Chỉ hiện ở tab Danh mục')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Chỉ hiện ở tab Danh mục/ })).toBeInTheDocument();
  });

  it('tên khối dài có dấu: cắt hai dòng, không ép một dòng nowrap, cao tối thiểu 44', () => {
    const long = 'Bộ sưu tập những sản phẩm tẩy rửa sinh học thân thiện môi trường cho gia đình';
    render(<SectionCard view={view({ title: long, spoken: `${long}, Kệ ngang, 4 món.` })} onOpen={() => undefined} />);
    const title = screen.getByText(long);
    expect(title.style.whiteSpace).not.toBe('nowrap');
    expect(title.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    const btn = screen.getByRole('button');
    expect(parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('không ảnh nào thì không vẽ dải ảnh', () => {
    const { container } = render(<SectionCard view={view({ thumbs: [] })} onOpen={() => undefined} />);
    expect(container.querySelector('[data-testid="section-thumbs"]')).toBeNull();
  });
});
