// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';
import { makeWastePoint } from './recycle-fixtures';

// Chép ý waste-point-picker.spec.tsx (Mini App, §4.4, §16.1) trừ phần khoảng cách: web không dùng vị trí.

const mocks = vi.hoisted(() => ({ callPhone: vi.fn(), openExternal: vi.fn() }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { callPhone: mocks.callPhone, openExternal: mocks.openExternal } }));

import { WastePointPicker, sortWastePoints } from './waste-point-picker';

const ITEMS = [
  { id: 'item-carton', name: 'Thùng carton' },
  { id: 'item-milk', name: 'Vỏ hộp sữa' },
];
const SELECTED = ['item-carton', 'item-milk'];
const NEAR = makeWastePoint({ id: 'pt-near', name: 'Đại lý Gần' });
const WAREHOUSE = makeWastePoint({ id: 'pt-wh', name: 'Kho Tubu TP.HCM', kind: 'WAREHOUSE', phone: null });
const FULL = makeWastePoint({ id: 'pt-full', name: 'Đại lý Hết', quotaFull: true });
const PARTIAL = makeWastePoint({ id: 'pt-part', name: 'Đại lý Thiếu', acceptedItemIds: ['item-carton'], perkText: 'Giảm 10% hoá đơn đầu' });
const MONDAY_9AM = new Date('2026-10-19T02:00:00.000Z');
const onChange = vi.fn();

let mounted: Rendered[] = [];
const mount = (over: Partial<Parameters<typeof WastePointPicker>[0]> = {}) => {
  const r = render(<WastePointPicker points={[WAREHOUSE, FULL, PARTIAL, NEAR]} value={null} onChange={onChange} items={ITEMS} selectedItemIds={SELECTED} now={MONDAY_9AM} {...over} />);
  mounted.push(r);
  return r.container;
};
const radio = (c: HTMLElement, name: string) => byText(c, '[role="radio"]', name)!;

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('WastePointPicker (web)', () => {
  it('nhóm radio có tên; nút gọi và chỉ đường nằm ngoài radio', () => {
    const c = mount();
    expect(c.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Chọn điểm nhận');
    expect(c.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(c.querySelectorAll('[role="radio"] button, [role="radio"] a')).toHaveLength(0);
    expect(unnamedControls(c)).toEqual([]);
    expect(headingProblems(c)).toEqual(['cần đúng 1 h1, có 0']);
  });
  it('điểm nhận đủ món xếp trước, điểm thiếu món xếp sau, cùng nhóm giữ thứ tự đầu vào', () => {
    expect(sortWastePoints([WAREHOUSE, FULL, PARTIAL, NEAR], SELECTED).map((p) => p.id)).toEqual(['pt-wh', 'pt-full', 'pt-near', 'pt-part']);
  });
  it('chọn điểm được thì gọi onChange(id); bấm lại điểm đang chọn không gọi', () => {
    const c = mount({ value: 'pt-near' });
    click(radio(c, 'Đại lý Gần'));
    expect(onChange).not.toHaveBeenCalled();
    click(radio(c, 'Kho Tubu TP.HCM'));
    expect(onChange).toHaveBeenCalledWith('pt-wh');
  });
  it('điểm hết hạn mức: mờ, ghi lý do, không chọn được', () => {
    const c = mount();
    const r = radio(c, 'Đại lý Hết');
    expect(r.getAttribute('aria-disabled')).toBe('true');
    expect(c.textContent).toContain('Tạm hết hạn mức tháng này');
    click(r);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('điểm không nhận đủ món: nói món thiếu, gạch món đó, không chọn được, hiện ưu đãi riêng', () => {
    const c = mount();
    const r = radio(c, 'Đại lý Thiếu');
    expect(r.getAttribute('aria-disabled')).toBe('true');
    expect(c.textContent).toContain('Điểm này không nhận: Vỏ hộp sữa');
    expect(r.querySelector('s')?.textContent).toBe('Vỏ hộp sữa');
    expect(r.textContent).toContain('Không nhận');
    expect(c.textContent).toContain('Ưu đãi riêng của cửa hàng (cửa hàng tự chịu, không qua Điểm Xanh, Tubu không đảm bảo): Giảm 10% hoá đơn đầu');
    click(r);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('không có "Gần nhất" hay khoảng cách vì web không xin vị trí', () => {
    const c = mount({ points: [{ ...NEAR, distanceKm: 1.2 }] });
    expect(c.textContent).not.toContain('Gần nhất');
    expect(c.textContent).not.toMatch(/ km/);
  });
  it('loại điểm, địa chỉ hai cấp, đang mở', () => {
    const c = mount();
    expect(c.textContent).toContain('Kho Tubu');
    expect(c.textContent).toContain('12 Lê Lợi, Phường Bến Thành, TP.HCM');
    expect(c.textContent?.match(/Đang mở/g)).toHaveLength(4);
  });
  it('Chỉ đường mở Google Maps theo địa chỉ; Gọi dùng số của điểm; điểm không có số thì không có nút Gọi', () => {
    const c = mount({ points: [NEAR] });
    click(byText(c, 'button', 'Chỉ đường'));
    expect(mocks.openExternal).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/));
    click(byText(c, 'button', 'Gọi'));
    expect(mocks.callPhone).toHaveBeenCalledWith('0901234567');
    const c2 = mount({ points: [WAREHOUSE] });
    expect(byText(c2, 'button', 'Gọi')).toBeNull();
  });
});
