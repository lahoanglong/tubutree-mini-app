// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';
import { ITEM_BATTERY, ITEM_CARTON, ITEM_MILK } from './recycle-fixtures';
import { WasteItemStep } from './waste-item-step';

// Chép ý phần WasteItemStep của recycle-new.spec.tsx (Mini App, §4.2): quy tắc, chuẩn bị, câu trần, bộ đếm kẹp theo trần còn lại.

let mounted: Rendered[] = [];
const mount = (props: Partial<Parameters<typeof WasteItemStep>[0]> = {}) => {
  const onChange = vi.fn();
  const r = render(<WasteItemStep items={[ITEM_BATTERY, ITEM_MILK, ITEM_CARTON]} lines={{}} onChange={onChange} {...props} />);
  mounted.push(r);
  return { c: r.container, onChange };
};
const card = (c: HTMLElement, name: string) => byText(c, '[data-item]', name)!;
const btn = (el: HTMLElement, label: string) => el.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!;

afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('WasteItemStep (web)', () => {
  it('thẻ món: quy tắc, chuẩn bị, câu trần, ảnh hoặc biểu tượng; xếp theo sortOrder', () => {
    const { c } = mount();
    expect(Array.from(c.querySelectorAll('[data-item]')).map((e) => e.getAttribute('data-status'))).toEqual(['ACTIVE', 'ACTIVE', 'COMING_SOON']);
    const carton = card(c, 'Thùng carton');
    expect(carton.textContent).toContain('1 thùng = 1.000 điểm');
    expect(carton.textContent).toContain('Gấp phẳng, bỏ băng keo');
    expect(carton.textContent).toContain('Tối đa 20 thùng mỗi tháng. Mang tới điểm nhận: tối đa 10 thùng mỗi ngày');
    expect(carton.querySelector('[data-item-media] svg, [data-item-media] img')).not.toBeNull();
  });
  it('món sắp nhận mờ đi, có nhãn và không có bộ đếm; món ẩn không hiện', () => {
    const { c } = mount({ items: [ITEM_CARTON, ITEM_BATTERY, { ...ITEM_MILK, status: 'HIDDEN' }] });
    const battery = card(c, 'Pin cũ');
    expect(battery.textContent).toContain('Sắp nhận');
    expect(battery.textContent).toContain('Đợt này Tubu chưa nhận pin');
    expect(battery.className).toContain('opacity-[.55]');
    expect(btn(battery, 'Tăng số lượng')).toBeNull();
    expect(c.textContent).not.toContain('Vỏ hộp sữa');
  });
  it('bấm + gọi onChange với số mới; − về 0 gọi onChange(id, 0)', () => {
    const { c, onChange } = mount({ lines: { 'item-carton': 2 } });
    click(btn(card(c, 'Thùng carton'), 'Tăng số lượng'));
    expect(onChange).toHaveBeenLastCalledWith('item-carton', 3);
    click(btn(card(c, 'Thùng carton'), 'Giảm số lượng'));
    expect(onChange).toHaveBeenLastCalledWith('item-carton', 1);
  });
  it('bộ đếm kẹp theo phần trần tháng còn lại, cộng phần allowance của yêu cầu đang sửa', () => {
    const limited = { ...ITEM_CARTON, monthRemainingQty: 1 };
    const { c, onChange } = mount({ items: [limited], lines: { 'item-carton': 1 } });
    const plus = btn(card(c, 'Thùng carton'), 'Tăng số lượng');
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    click(plus);
    expect(onChange).not.toHaveBeenCalled();
    const { c: c2 } = mount({ items: [limited], lines: { 'item-carton': 1 }, allowance: { 'item-carton': 2 } });
    expect(btn(card(c2, 'Thùng carton'), 'Tăng số lượng').getAttribute('aria-disabled')).toBe('false');
  });
  it('món nhóm: "thêm N vỏ nữa được +1.000 điểm" và thanh tiến độ theo phần dư', () => {
    const { c } = mount({ lines: { 'item-milk': 2 } });
    const milk = card(c, 'Vỏ hộp sữa');
    expect(milk.textContent).toContain('thêm 3 vỏ nữa được +1.000 điểm');
    expect(milk.querySelector<HTMLElement>('[data-testid="progress-fill"]')?.style.width).toBe('40%');
  });
  it('mọi điều khiển có tên', () => {
    const { c } = mount();
    expect(unnamedControls(c)).toEqual([]);
  });
});
