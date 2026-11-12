import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VariationChip } from './variation-chip';

function chip(over: { stock?: number; price?: number; isFlash?: boolean; salePct?: number; active?: boolean; name?: string; siblingCount?: number } = {}) {
  const { container } = render(
    <VariationChip
      variation={{ name: over.name ?? 'Chai 500ml', stock: over.stock ?? 10 }}
      {...(over.siblingCount === undefined ? {} : { siblingCount: over.siblingCount })}
      pricing={{ price: over.price ?? 85_000, isFlash: over.isFlash ?? false, ...(over.salePct === undefined ? {} : { salePct: over.salePct }) }}
      active={over.active ?? false}
      onClick={vi.fn()}
    />,
  );
  return container.querySelector('[role="button"]') as HTMLElement;
}

describe('VariationChip Mini: nhãn tiết kiệm của phân loại đang giảm giá', () => {
  it('giá gạch cao hơn giá bán (salePct 15): hiện "-15%" màu giá đang giảm, và câu đọc "Giảm 15%"', () => {
    const b = chip({ salePct: 15 });
    const visible = Array.from(b.querySelectorAll<HTMLElement>('[aria-hidden="true"]')).find((x) => x.textContent === '-15%');
    expect(visible).toBeTruthy();
    expect(visible!.getAttribute('style')).toContain('--color-text-price-deal');
    expect(b.textContent).toContain(', Giảm 15%');
    expect(b.textContent).toContain('85.000đ');
  });

  it('không giảm (salePct 0 hoặc không có): không có nhãn tiết kiệm', () => {
    expect(chip({ salePct: 0 }).textContent).not.toContain('%');
    expect(chip().textContent).not.toContain('%');
  });

  it('Giờ vàng giữ dấu riêng, không thêm phần trăm tiết kiệm chồng lên', () => {
    const b = chip({ isFlash: true, salePct: 30 });
    expect(b.textContent).toContain('Giờ vàng');
    expect(b.textContent).not.toContain('-30%');
    expect(b.textContent).not.toContain('Giảm 30%');
  });

  it('hết hàng: ghi "Tạm hết hàng", không ghi giá hay phần trăm', () => {
    const b = chip({ stock: 0, salePct: 15 });
    expect(b.textContent).toContain('Tạm hết hàng');
    expect(b.textContent).not.toContain('%');
    expect(b.getAttribute('aria-disabled')).toBe('true');
  });

  it('đang chọn: aria-pressed true và nhãn tiết kiệm vẫn hiện', () => {
    const b = chip({ salePct: 20, active: true });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.textContent).toContain('-20%');
  });
});

describe('VariationChip Mini: số đều (tabular-nums) cho dòng giá và phần trăm giảm', () => {
  const priceRow = (b: HTMLElement) => b.children[1] as HTMLElement;

  it('dòng giá (kèm "-15%" nằm trong dòng) dùng tabular-nums', () => {
    const b = chip({ salePct: 15 });
    expect(priceRow(b).textContent).toContain('85.000đ');
    expect(priceRow(b).textContent).toContain('-15%');
    expect(priceRow(b).style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('giá Giờ vàng, đang chọn và hết hàng đều giữ tabular-nums (không phụ thuộc trạng thái)', () => {
    expect(priceRow(chip({ isFlash: true })).style.fontVariantNumeric).toBe('tabular-nums');
    expect(priceRow(chip({ active: true })).style.fontVariantNumeric).toBe('tabular-nums');
    expect(priceRow(chip({ stock: 0 })).style.fontVariantNumeric).toBe('tabular-nums');
  });
});

describe('VariationChip Mini: phân loại không có tên (86/154 phân loại trên PROD)', () => {
  it('nhiều phân loại, tên trống: hiện "Mặc định" và giá, không chip trống', () => {
    for (const name of ['', '   ']) {
      const b = chip({ name, siblingCount: 3 });
      expect(b.children[0]!.textContent).toBe('Mặc định');
      expect(b.textContent).toBe('Mặc định85.000đ');
    }
  });

  it('chỉ có chip trong bộ chọn nên không truyền siblingCount cũng coi là nhiều phân loại: "Mặc định"', () => {
    expect(chip({ name: '' }).children[0]!.textContent).toBe('Mặc định');
  });

  it('một phân loại duy nhất tên trống: không ô tên, chỉ còn dòng giá', () => {
    const b = chip({ name: '', siblingCount: 1 });
    expect(b.textContent).toBe('85.000đ');
    expect(b.children).toHaveLength(1);
  });

  it('hết hàng và tên trống: "Mặc định" kèm "Tạm hết hàng"; một phân loại thì chỉ "Tạm hết hàng"', () => {
    expect(chip({ name: ' ', siblingCount: 2, stock: 0 }).textContent).toBe('Mặc địnhTạm hết hàng');
    expect(chip({ name: ' ', siblingCount: 1, stock: 0 }).textContent).toBe('Tạm hết hàng');
  });

  it('có tên: giữ nguyên tên (cắt khoảng trắng) và dòng giá, kể cả khi đứng một mình', () => {
    expect(chip({ name: 'Chai 500ml', siblingCount: 2 }).children[0]!.textContent).toBe('Chai 500ml');
    expect(chip({ name: '  Chai 500ml ', siblingCount: 1 }).children[0]!.textContent).toBe('Chai 500ml');
    expect(chip({ name: 'Chai 500ml', siblingCount: 2 }).children).toHaveLength(2);
  });
});
