// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { VariationChip } from './variation-chip';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

function chip(over: { stock?: number; price?: number; isFlash?: boolean; salePct?: number; active?: boolean } = {}) {
  const r = render(
    <VariationChip
      variation={{ name: 'Chai 500ml', stock: over.stock ?? 10 }}
      pricing={{ price: over.price ?? 85_000, isFlash: over.isFlash ?? false, ...(over.salePct === undefined ? {} : { salePct: over.salePct }) }}
      active={over.active ?? false}
      onClick={() => undefined}
    />,
  );
  mounted.push(r);
  return r.container.querySelector('button') as HTMLButtonElement;
}

describe('VariationChip web: nhãn tiết kiệm của phân loại đang giảm giá', () => {
  it('giá gạch cao hơn giá bán (salePct 15): hiện "-15%" cho mắt, và câu đọc "Giảm 15%" cho trình đọc màn hình', () => {
    const b = chip({ salePct: 15 });
    const visible = b.querySelector('[aria-hidden="true"].font-semibold');
    expect(visible?.textContent).toBe('-15%');
    expect(visible?.getAttribute('class')).toContain('--color-text-price-deal');
    expect(b.querySelector('.sr-only')?.textContent).toBe(', Giảm 15%');
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
    expect(b.disabled).toBe(true);
  });

  it('đang chọn: aria-pressed true và nhãn tiết kiệm vẫn hiện', () => {
    const b = chip({ salePct: 20, active: true });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.textContent).toContain('-20%');
  });
});

describe('VariationChip web: số đều (tabular-nums) cho dòng giá và phần trăm giảm', () => {
  const priceRow = (b: HTMLButtonElement) => b.children[2] as HTMLElement;

  it('dòng giá (kèm "-15%" nằm trong dòng) có lớp tabular-nums', () => {
    const b = chip({ salePct: 15 });
    expect(priceRow(b).textContent).toContain('85.000đ');
    expect(priceRow(b).textContent).toContain('-15%');
    expect(priceRow(b).className.split(' ')).toContain('tabular-nums');
  });

  it('giá Giờ vàng, đang chọn và hết hàng đều giữ tabular-nums (không phụ thuộc trạng thái)', () => {
    expect(priceRow(chip({ isFlash: true })).className.split(' ')).toContain('tabular-nums');
    expect(priceRow(chip({ active: true })).className.split(' ')).toContain('tabular-nums');
    expect(priceRow(chip({ stock: 0 })).className.split(' ')).toContain('tabular-nums');
  });
});
