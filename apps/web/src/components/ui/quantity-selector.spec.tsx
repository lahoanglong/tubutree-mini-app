// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, typeInto, type Rendered } from '@/test-utils/dom';
import { QuantitySelector } from './quantity-selector';

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const btn = (c: HTMLElement, name: string) => c.querySelector<HTMLElement>(`button[aria-label="${name}"]`)!;

describe('QuantitySelector', () => {
  it('tăng/giảm gọi onChange với giá trị mới, hiện số hiện tại', () => {
    const onChange = vi.fn();
    const { container } = mount(<QuantitySelector value={3} max={5} onChange={onChange} />);
    expect(container.textContent).toBe('3');
    click(btn(container, 'Tăng số lượng'));
    expect(onChange).toHaveBeenLastCalledWith(4);
    click(btn(container, 'Giảm số lượng'));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('ở min/max: aria-disabled, bấm không gọi onChange, nút vẫn focus được (không có disabled)', () => {
    const onChange = vi.fn();
    const lo = mount(<QuantitySelector value={1} max={5} onChange={onChange} />).container;
    expect(btn(lo, 'Giảm số lượng').getAttribute('aria-disabled')).toBe('true');
    expect(btn(lo, 'Giảm số lượng').hasAttribute('disabled')).toBe(false);
    click(btn(lo, 'Giảm số lượng'));
    const hi = mount(<QuantitySelector value={5} max={5} onChange={onChange} />).container;
    click(btn(hi, 'Tăng số lượng'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('min tuỳ chọn; vùng chạm: md 44px, sm có lớp phủ giãn 4px', () => {
    const onChange = vi.fn();
    const { container } = mount(<QuantitySelector value={0} min={0} max={3} size="sm" onChange={onChange} />);
    click(btn(container, 'Tăng số lượng'));
    expect(onChange).toHaveBeenCalledWith(1);
    expect(btn(container, 'Giảm số lượng').className).toContain('after:-inset-1');
    expect(btn(mount(<QuantitySelector value={2} max={3} onChange={() => {}} />).container, 'Tăng số lượng').className).toContain('h-11 w-11');
  });

  it('editable: gõ số vào ô, bỏ ký tự lạ, kẹp vào [min, max]', () => {
    const onChange = vi.fn();
    const { container } = mount(<QuantitySelector value={3} max={20} onChange={onChange} editable />);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Số lượng"]')!;
    expect(input.value).toBe('3');
    typeInto(input, '12a');
    expect(onChange).toHaveBeenLastCalledWith(12);
    typeInto(input, '999');
    expect(onChange).toHaveBeenLastCalledWith(20);
    typeInto(input, '');
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('quickSteps: +5 / +10 cộng dồn và kẹp vào max; ở max thì aria-disabled, không gọi onChange', () => {
    const onChange = vi.fn();
    const { container } = mount(<QuantitySelector value={18} max={20} onChange={onChange} quickSteps={[5, 10]} />);
    click(btn(container, 'Thêm 5'));
    expect(onChange).toHaveBeenLastCalledWith(20);
    mounted.pop()!.unmount();
    const onChange2 = vi.fn();
    const r = mount(<QuantitySelector value={20} max={20} onChange={onChange2} quickSteps={[5]} />);
    expect(btn(r.container, 'Thêm 5').getAttribute('aria-disabled')).toBe('true');
    click(btn(r.container, 'Thêm 5'));
    expect(onChange2).not.toHaveBeenCalled();
  });
});
