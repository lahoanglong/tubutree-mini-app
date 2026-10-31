import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { BrandGrid } from './brand-grid';

const brands = (n: number) => Array.from({ length: n }, (_, i) => ({ brand: `Nhãn ${String(i).padStart(2, '0')}`, count: i + 1 }));

describe('BrandGrid', () => {
  it('5 nhãn: hiện đủ, tên đọc là "Xem thương hiệu X", chạm gọi onSelect(tên)', () => {
    const onSelect = vi.fn();
    render(<BrandGrid brands={brands(5)} onSelect={onSelect} />);
    const region = screen.getByRole('region', { name: 'Thương hiệu' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Thương hiệu' })).toBeInTheDocument();
    expect(within(region).getAllByRole('button')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Xem thương hiệu Nhãn 03' }));
    expect(onSelect).toHaveBeenCalledWith('Nhãn 03');
  });

  it('dưới 4 nhãn hoặc chưa có dữ liệu: không vẽ gì (không để tiêu đề trơ)', () => {
    const { container, rerender } = render(<BrandGrid brands={brands(3)} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BrandGrid brands={[]} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('20 nhãn: cắt còn 12, nhãn nhiều sản phẩm đứng trước', () => {
    render(<BrandGrid brands={brands(20)} onSelect={vi.fn()} />);
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toHaveLength(12);
    expect(names[0]).toBe('Xem thương hiệu Nhãn 19');
    expect(names[11]).toBe('Xem thương hiệu Nhãn 08');
  });

  it('có logoUrl: ảnh trang trí (alt rỗng); không có: chữ cái đầu của tên', () => {
    const list = [{ brand: 'Tubu', count: 9, logoUrl: 'https://img.test/tubu.png' }, ...brands(3).map((b) => ({ ...b, logoUrl: null }))];
    const { container } = render(<BrandGrid brands={list} onSelect={vi.fn()} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('alt', '');
    expect(imgs[0]).toHaveAttribute('src', 'https://img.test/tubu.png');
    expect(screen.getAllByTestId('initials-avatar')).toHaveLength(3);
  });

  it('ô cao tối thiểu 44px; tên dài cắt một dòng', () => {
    render(<BrandGrid brands={[{ brand: 'Một thương hiệu có cái tên rất là dài', count: 9 }, ...brands(3)]} onSelect={vi.fn()} />);
    for (const b of screen.getAllByRole('button')) expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(44);
    const label = screen.getByRole('button', { name: /Một thương hiệu/ }).querySelector('[data-brand-label]') as HTMLElement;
    expect(label.style.whiteSpace).toBe('nowrap');
    expect(label.style.textOverflow).toBe('ellipsis');
  });
});
