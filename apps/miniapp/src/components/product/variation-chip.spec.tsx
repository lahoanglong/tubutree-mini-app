import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VariationChip } from './variation-chip';

function chip(over: { stock?: number; price?: number; isFlash?: boolean; salePct?: number; active?: boolean } = {}) {
  const { container } = render(
    <VariationChip
      variation={{ name: 'Chai 500ml', stock: over.stock ?? 10 }}
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
