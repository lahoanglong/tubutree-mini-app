// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { CartComboBlock } from './cart-combo-block';

const block = { title: 'Combo: Bộ giặt sạch Fuwa3e', saving: 'Tiết kiệm 65.250đ', savingPending: false, hint: null };

let mounted: Rendered[] = [];
const mount = (b: typeof block) => {
  const r = render(
    <CartComboBlock block={b}>
      <div />
    </CartComboBlock>,
  );
  mounted.push(r);
  return r.container;
};
const q = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('CartComboBlock: chỗ của số Tiết kiệm khi chờ máy chủ tính lại', () => {
  it('bình thường: số hiện, đọc được, tên khối ghi cả số', () => {
    const c = mount(block);
    expect(q(c, 'cart-combo-heading').textContent).toBe('Combo: Bộ giặt sạch Fuwa3e · Tiết kiệm 65.250đ');
    expect(q(c, 'cart-combo-saving').getAttribute('aria-hidden')).toBeNull();
    expect(q(c, 'cart-combo-saving').classList.contains('invisible')).toBe(false);
    expect(q(c, 'cart-combo-group').getAttribute('aria-label')).toBe('Combo: Bộ giặt sạch Fuwa3e · Tiết kiệm 65.250đ');
  });

  it('chờ máy chủ: số ẩn nhưng còn chiếm chỗ (đầu nhóm không đổi số dòng), không đọc, tên khối không ghi số cũ', () => {
    const c = mount({ ...block, savingPending: true });
    const saving = q(c, 'cart-combo-saving');
    expect(saving.textContent).toBe(' · Tiết kiệm 65.250đ');
    expect(saving.getAttribute('aria-hidden')).toBe('true');
    expect(saving.classList.contains('invisible')).toBe(true);
    expect(q(c, 'cart-combo-group').getAttribute('aria-label')).toBe('Combo: Bộ giặt sạch Fuwa3e');
  });
});
