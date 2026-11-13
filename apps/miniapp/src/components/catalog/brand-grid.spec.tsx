import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { BRAND_ORIGINS, brandBrowseTarget } from '@tubutree/app-core/brand-origins';
import { BrandGrid } from './brand-grid';

beforeEach(() => mocks.navigate.mockClear());

const brands = (n: number) => Array.from({ length: n }, (_, i) => ({ brand: `Nhãn ${String(i).padStart(2, '0')}`, count: i + 1 }));

describe('BrandGrid', () => {
  it('5 nhãn: hiện đủ, tên đọc là "X, xem thương hiệu", chạm gọi onSelect(tên)', () => {
    const onSelect = vi.fn();
    render(<BrandGrid brands={brands(5)} onSelect={onSelect} />);
    const region = screen.getByRole('region', { name: 'Thương hiệu' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Thương hiệu' })).toBeInTheDocument();
    expect(within(region).getAllByRole('button')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Nhãn 03, xem thương hiệu' }));
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
    expect(names[0]).toBe('Nhãn 19, xem thương hiệu');
    expect(names[11]).toBe('Nhãn 08, xem thương hiệu');
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

  describe('API chỉ có nhãn vỏ "Tubu Tree" (PROD ghi mọi SKU là nhãn đó)', () => {
    const SHELL = [{ brand: 'Tubu Tree', count: 111 }];

    it('vẽ 8 nhãn hành trình theo thứ tự thay vì ẩn khối, không có ô "Tubu Tree"', () => {
      render(<BrandGrid brands={SHELL} onSelect={vi.fn()} />);
      const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
      expect(names).toEqual(BRAND_ORIGINS.map((o) => `${o.brand}, xem thương hiệu`));
      expect(names).toHaveLength(8);
    });

    it('chạm một ô mở /browse tìm theo từ khoá của nhãn (không gọi onSelect: cột brand đều là "Tubu Tree" nên lọc ?brand= trả rỗng)', () => {
      const onSelect = vi.fn();
      render(<BrandGrid brands={SHELL} onSelect={onSelect} />);
      fireEvent.click(screen.getByRole('button', { name: `${BRAND_ORIGINS[2]!.brand}, xem thương hiệu` }));
      expect(mocks.navigate).toHaveBeenCalledWith(brandBrowseTarget(BRAND_ORIGINS[2]!, '/browse'));
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('có thêm nhãn thật từ API thì dùng danh sách API như cũ (onSelect theo tên), không dựng nhãn hành trình', () => {
      const onSelect = vi.fn();
      render(<BrandGrid brands={[...SHELL, ...brands(4)]} onSelect={onSelect} />);
      expect(screen.queryByRole('button', { name: `${BRAND_ORIGINS[0]!.brand}, xem thương hiệu` })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Nhãn 03, xem thương hiệu' }));
      expect(onSelect).toHaveBeenCalledWith('Nhãn 03');
      expect(mocks.navigate).not.toHaveBeenCalled();
    });
  });
});
