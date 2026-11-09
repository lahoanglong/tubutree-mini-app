// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
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
    expect(c.textContent).toContain('Ưu đãi của cửa hàng (không dùng Điểm Xanh): Giảm 10% hoá đơn đầu');
    click(r);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('lý do khoá dài (nhiều món) được xuống dòng, không bị cắt', () => {
    const none = makeWastePoint({ id: 'pt-none', name: 'Đại lý Không', acceptedItemIds: [] });
    const c = mount({ points: [none] });
    const reason = byText(c, 'span', 'Điểm này không nhận: Thùng carton, Vỏ hộp sữa')!;
    expect(reason).not.toBeNull();
    expect(reason.className).not.toContain('whitespace-nowrap');
  });
  it('thẻ khoá: chỉ radio và phần chữ bị làm mờ; lý do, Chỉ đường và Gọi giữ nguyên độ đậm', () => {
    const c = mount();
    const r = radio(c, 'Đại lý Hết');
    const card = r.parentElement as HTMLElement;
    expect(card.className).not.toContain('opacity-');
    expect(r.querySelector('[data-point-body]')?.className).toContain('opacity-[.55]');
    const keep = [byText(c, 'span', 'Tạm hết hạn mức tháng này')!, ...Array.from(card.querySelectorAll<HTMLElement>('button')).filter((b) => b !== r)];
    for (const el of keep) expect(el.closest('[class*="opacity-"]')).toBeNull();
    expect(radio(c, 'Đại lý Gần').querySelector('[data-point-body]')?.className).not.toContain('opacity-');
  });
  it('món nhận hiện thành chip riêng, món không nhận vẫn gạch ngang kèm "Không nhận"', () => {
    const c = mount();
    const r = radio(c, 'Đại lý Thiếu');
    const accepted = Array.from(r.querySelectorAll<HTMLElement>('span')).find((e) => e.textContent === 'Thùng carton')!;
    expect(accepted.className).toContain('rounded-full');
    expect(accepted.closest('s, del')).toBeNull();
    expect(r.querySelector('s')?.textContent).toBe('Vỏ hộp sữa');
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

describe('WastePointPicker (web): lý do khoá, bàn phím, bận, số đều (W63A)', () => {
  // Thứ tự hiển thị: Kho Tubu (mở), Hết (khoá), Gần (mở), Thiếu (khoá).
  const radios = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="radio"]'));
  const stops = (c: HTMLElement) => radios(c).filter((r) => r.getAttribute('tabindex') === '0');
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(ev);
    });
    return !ev.defaultPrevented;
  };

  it('ô khoá trỏ aria-describedby vào lý do khoá; ô mở thì không có', () => {
    const c = mount();
    expect(radio(c, 'Đại lý Hết').getAttribute('aria-describedby')).toBe('waste-point-reason-pt-full');
    expect(document.getElementById('waste-point-reason-pt-full')?.textContent).toBe('Tạm hết hạn mức tháng này');
    expect(radio(c, 'Đại lý Thiếu').getAttribute('aria-describedby')).toBe('waste-point-reason-pt-part');
    expect(document.getElementById('waste-point-reason-pt-part')?.textContent).toBe('Điểm này không nhận: Vỏ hộp sữa');
    expect(radio(c, 'Đại lý Gần').hasAttribute('aria-describedby')).toBe(false);
    expect(document.getElementById('waste-point-reason-pt-near')).toBeNull();
  });

  it('mũi tên xuống/lên: sang ô dùng được kế tiếp, bỏ qua ô khoá, đi vòng, và chọn ô đó', () => {
    const c = mount();
    radio(c, 'Kho Tubu TP.HCM').focus();
    expect(stops(c)[0]).toBe(radio(c, 'Kho Tubu TP.HCM'));
    expect(press('ArrowDown')).toBe(false);
    expect(radio(c, 'Đại lý Gần')).toBe(document.activeElement);
    expect(onChange).toHaveBeenLastCalledWith('pt-near');
    press('ArrowDown');
    expect(radio(c, 'Kho Tubu TP.HCM')).toBe(document.activeElement);
    expect(onChange).toHaveBeenLastCalledWith('pt-wh');
    press('ArrowUp');
    expect(radio(c, 'Đại lý Gần')).toBe(document.activeElement);
  });

  it('điểm dừng Tab theo ô đang chọn còn dùng được, ô khoá không giữ điểm dừng khi còn ô mở', () => {
    const c = mount({ value: 'pt-near' });
    expect(stops(c)).toEqual([radio(c, 'Đại lý Gần')]);
    const locked = mount({ value: 'pt-full' });
    expect(stops(locked)).toEqual([radio(locked, 'Kho Tubu TP.HCM')]);
  });

  it('disabled: mọi ô aria-disabled, bấm không gọi onChange, con trỏ not-allowed, mũi tên không chuyển tiêu điểm', () => {
    const c = mount({ disabled: true, value: 'pt-near' });
    for (const r of radios(c)) expect(r.getAttribute('aria-disabled')).toBe('true');
    const near = radio(c, 'Đại lý Gần');
    expect(near.className).toContain('cursor-not-allowed');
    click(radio(c, 'Kho Tubu TP.HCM'));
    expect(onChange).not.toHaveBeenCalled();
    expect(stops(c)).toEqual([near]);
    near.focus();
    expect(press('ArrowDown')).toBe(true);
    expect(near).toBe(document.activeElement);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled=false hay bỏ trống: ô mở aria-disabled="false", con trỏ pointer, chọn được', () => {
    for (const over of [{}, { disabled: false }]) {
      const c = mount(over);
      const near = radio(c, 'Đại lý Gần');
      expect(near.getAttribute('aria-disabled')).toBe('false');
      expect(near.className).toContain('cursor-pointer');
      expect(near.className).not.toContain('cursor-not-allowed');
      click(near);
      expect(onChange).toHaveBeenLastCalledWith('pt-near');
      onChange.mockClear();
      mounted.pop()!.unmount();
    }
  });

  it('disabled chỉ khoá việc chọn: Chỉ đường và Gọi vẫn dùng được', () => {
    const c = mount({ disabled: true, points: [NEAR] });
    click(byText(c, 'button', 'Chỉ đường'));
    expect(mocks.openExternal).toHaveBeenCalledTimes(1);
    click(byText(c, 'button', 'Gọi'));
    expect(mocks.callPhone).toHaveBeenCalledWith('0901234567');
  });

  it('giờ mở cửa và số điện thoại dùng số đều; nút Chỉ đường thì không', () => {
    const c = mount({ points: [NEAR] });
    const hours = Array.from(c.querySelectorAll('span')).find((s) => s.textContent === 'Đang mở, đến 18:00' && s.children.length === 0)!;
    expect(hours.className).toContain('tabular-nums');
    expect(byText(c, 'button', 'Gọi')!.className).toContain('tabular-nums');
    expect(byText(c, 'button', 'Chỉ đường')!.className).not.toContain('tabular-nums');
  });
});
