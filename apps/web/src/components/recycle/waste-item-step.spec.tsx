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
    expect(carton.textContent).toContain('Tối đa 20 thùng mỗi tháng. Mỗi ngày mang tới điểm nhận tối đa 10 thùng');
    expect(carton.querySelector('[data-item-media] svg, [data-item-media] img')).not.toBeNull();
  });
  it('món sắp nhận mờ đi, có nhãn và không có bộ đếm; món ẩn không hiện', () => {
    const { c } = mount({ items: [ITEM_CARTON, ITEM_BATTERY, { ...ITEM_MILK, status: 'HIDDEN' }] });
    const battery = card(c, 'Pin cũ');
    expect(battery.textContent).toContain('Sắp nhận');
    expect(battery.textContent).toContain('Đợt này Tubu chưa nhận pin');
    expect(battery.className).not.toContain('opacity-');
    expect(battery.getAttribute('aria-disabled')).toBe('true');
    expect(card(c, 'Pin cũ').querySelector('span.text-stone-500')?.textContent).toBe('Pin cũ');
    expect(card(c, 'Thùng carton').hasAttribute('aria-disabled')).toBe(false);
    expect(btn(battery, 'Tăng số lượng')).toBeNull();
    expect(c.textContent).not.toContain('Vỏ hộp sữa');
  });
  it('trần tháng đã bớt hoặc hết: thẻ món nói lý do dưới câu trần', () => {
    const { c } = mount({ items: [{ ...ITEM_CARTON, monthRemainingQty: 3 }, { ...ITEM_MILK, monthRemainingQty: 0 }] });
    expect(card(c, 'Thùng carton').textContent).toContain('Tháng này còn 3 thùng');
    expect(card(c, 'Vỏ hộp sữa').textContent).toContain('Tháng này bạn đã đủ trần cho món này');
  });
  it('trần tháng còn nguyên: không có dòng "Tháng này còn"', () => {
    const { c } = mount({ items: [ITEM_CARTON] });
    expect(c.textContent).not.toContain('Tháng này còn');
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

describe('WasteItemStep — biểu tượng món', () => {
  it('Vỏ chai Tubu dùng biểu tượng hộp trung tính, không phải ly rượu', () => {
    const { c } = mount({ items: [{ ...ITEM_CARTON, code: 'TUBU_BOTTLE', name: 'Vỏ chai Tubu', imageUrl: null }] });
    const icon = c.querySelector('[data-item-icon="bottle"] svg')!;
    expect(icon.getAttribute('class')).toContain('lucide-container');
    expect(icon.getAttribute('class')).not.toContain('wine');
  });
});

describe('WasteItemStep — diện mạo Mini App ở điện thoại', () => {
  it('món chưa có ảnh dùng biểu tượng theo loại món; chữ phụ cỡ caption', () => {
    const { c } = mount({ items: [{ ...ITEM_CARTON, imageUrl: null }] });
    const media = c.querySelector('[data-item-media]')!;
    expect(media.querySelector('[data-item-icon="package"]')).not.toBeNull();
    expect(card(c, 'Thùng carton').querySelector('p')!.className).toContain('max-md:text-[length:var(--type-caption-size)]');
  });
});
