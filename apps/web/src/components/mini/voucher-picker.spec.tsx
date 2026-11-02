// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { CouponPreviewDTO } from '@tubutree/shared-types';
import type { CouponDTO } from '@tubutree/app-core/api/loyalty';
import { pickerRows } from '@tubutree/app-core/commerce/voucher-picker';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { VoucherPicker } from './voucher-picker';

const NOW = Date.parse('2026-11-01T05:00:00Z');
const END = '2099-01-01T00:00:00.000Z';
const coupon = (code: string, over: Partial<CouponDTO> = {}): CouponDTO => ({ code, type: 'AMOUNT', value: 20_000, minOrder: null, maxDiscount: null, endAt: END, ...over });
const WALLET = [
  coupon('OK'),
  coupon('APPLIED', { value: 5_000 }),
  coupon('SHORT', { minOrder: 500_000 }),
  coupon('SHIP', { type: 'FREESHIP', value: 0 }),
];
const rowsFor = (previews: CouponPreviewDTO[] = []) =>
  pickerRows(WALLET, { currentCode: 'APPLIED', subtotal: 150_000, shippingFee: 0, previews: new Map(previews.map((p) => [p.code, p])), now: NOW });
const props = (over: Partial<Parameters<typeof VoucherPicker>[0]> = {}) => ({ rows: rowsFor(), onUse: vi.fn(), onRemove: vi.fn(), ...over });
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
const byName = (name: string) => buttons().find((b) => b.getAttribute('aria-label') === name)!;
const q = (id: string) => document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`);

describe('VoucherPicker (web)', () => {
  it('mỗi nhóm một nhãn nút: Bỏ chọn (đang dùng), Dùng, Chưa đủ, Không áp dụng', () => {
    mount(<VoucherPicker {...props()} />);
    expect(buttons().map((b) => b.textContent)).toEqual(['Bỏ chọn', 'Dùng', 'Chưa đủ', 'Không áp dụng']);
  });

  it('nút có tên đọc kèm mã', () => {
    mount(<VoucherPicker {...props()} />);
    expect(byName('Dùng mã OK')).toBeTruthy();
    expect(byName('Bỏ chọn mã APPLIED')).toBeTruthy();
  });

  it('bấm Dùng gọi onUse(mã), bấm Bỏ chọn gọi onRemove; hai nút khoá không gọi gì', () => {
    const p = props();
    mount(<VoucherPicker {...p} />);
    click(byName('Dùng mã OK'));
    expect(p.onUse).toHaveBeenCalledWith('OK');
    click(byName('Bỏ chọn mã APPLIED'));
    expect(p.onRemove).toHaveBeenCalledTimes(1);
    for (const name of ['Chưa đủ điều kiện dùng mã SHORT', 'Không áp dụng mã SHIP']) {
      expect(byName(name).getAttribute('aria-disabled')).toBe('true');
      click(byName(name));
    }
    expect(p.onUse).toHaveBeenCalledTimes(1);
    expect(p.onRemove).toHaveBeenCalledTimes(1);
  });

  it('hàng đang dùng có chữ "Đang dùng"; hàng chưa đủ có lý do bằng chữ', () => {
    mount(<VoucherPicker {...props()} />);
    expect(q('voucher-selected')).toHaveLength(1);
    expect(document.body.textContent).toContain('Mua thêm 350k để dùng');
    expect(document.body.textContent).toContain('Đơn này đã miễn phí giao hàng');
  });

  it('mức giảm máy chủ báo hiện ở hàng dùng được', () => {
    mount(<VoucherPicker {...props({ rows: rowsFor([{ code: 'OK', eligible: true, discount: 20_000 }]) })} />);
    expect(q('voucher-saving')[0]!.textContent).toBe('Giảm 20.000đ cho đơn này');
  });

  it('busy: mọi nút aria-disabled (không aria-busy) và bấm không gọi gì; pendingCode chỉ đặt aria-busy cho nút của mã đó', () => {
    const p = props({ busy: true });
    const a = mount(<VoucherPicker {...p} />);
    for (const b of buttons()) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('aria-busy')).toBeNull();
    }
    click(byName('Dùng mã OK'));
    click(byName('Bỏ chọn mã APPLIED'));
    expect(p.onUse).not.toHaveBeenCalled();
    expect(p.onRemove).not.toHaveBeenCalled();
    a.unmount();
    mount(<VoucherPicker {...props({ pendingCode: 'OK' })} />);
    expect(byName('Dùng mã OK').getAttribute('aria-busy')).toBe('true');
    expect(byName('Bỏ chọn mã APPLIED').getAttribute('aria-busy')).toBeNull();
  });

  it('không phần tử nào bị làm mờ (opacity < 1 hoặc lớp opacity-*)', () => {
    const m = mount(<VoucherPicker {...props()} />);
    const all = Array.from(m.container.querySelectorAll<HTMLElement>('*'));
    expect(all.filter((el) => el.style.opacity !== '' && Number(el.style.opacity) < 1)).toEqual([]);
    expect(all.filter((el) => /(^|\s)opacity-/.test(el.getAttribute('class') ?? ''))).toEqual([]);
  });

  it('danh sách có tên "Mã giảm giá của bạn"', () => {
    mount(<VoucherPicker {...props()} />);
    expect(document.querySelector('ul[aria-label="Mã giảm giá của bạn"]')).not.toBeNull();
  });
});
