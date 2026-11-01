// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminCoupon } from '@/lib/admin-client';
import { CouponListing } from './coupon-listing';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const coupon = (over: Partial<AdminCoupon> = {}): AdminCoupon => ({
  id: 'c1', code: 'MUNG10', type: 'AMOUNT', value: 30_000, minOrder: null, maxDiscount: null, startAt: '2026-01-01T00:00:00.000Z', endAt: '2099-12-31T16:59:59.000Z',
  usageLimit: null, perUserLimit: 1, scope: 'CLAIM', isActive: true, redeemedCount: 0, listed: false, title: null, batch: null, ...over,
});
const mount = (c: AdminCoupon, pending = false) => {
  const onSave = vi.fn();
  const r = render(<CouponListing coupon={c} pending={pending} onSave={onSave} />);
  mounted.push(r);
  return { box: r.container, onSave };
};
const checkbox = (box: HTMLElement) => box.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const titleField = (box: HTMLElement) => box.querySelector<HTMLInputElement>('input[type="text"]')!;
const saveBtn = (box: HTMLElement) => [...box.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Lưu')!;

describe('CouponListing — bật hiện ở mục Nhận mã và đặt tên hiển thị', () => {
  it('mã CLAIM không lô: bật hộp chọn + nhập tên + Lưu → onSave({ listed: true, title })', () => {
    const { box, onSave } = mount(coupon());
    expect(checkbox(box).disabled).toBe(false);
    expect(box.textContent).toContain('Hiện ở mục Nhận mã');
    click(checkbox(box));
    typeInto(titleField(box), '  Mừng bạn mới ');
    click(saveBtn(box));
    expect(onSave).toHaveBeenCalledWith({ listed: true, title: 'Mừng bạn mới' });
  });

  it('tên rỗng → title: null; ô tên giới hạn 60 ký tự và có nhãn "Tên hiển thị"', () => {
    const { box, onSave } = mount(coupon({ listed: true, title: 'Cũ' }));
    expect(titleField(box).maxLength).toBe(60);
    expect([...box.querySelectorAll('label')].some((l) => l.textContent?.startsWith('Tên hiển thị'))).toBe(true);
    typeInto(titleField(box), '   ');
    click(saveBtn(box));
    expect(onSave).toHaveBeenCalledWith({ listed: true, title: null });
  });

  it('chưa đổi gì thì nút Lưu khoá; đang lưu cũng khoá', () => {
    const { box } = mount(coupon({ listed: true, title: 'A' }));
    expect(saveBtn(box).disabled).toBe(true);
    mounted.pop()!.unmount();
    const { box: pendingBox } = mount(coupon(), true);
    click(checkbox(pendingBox));
    expect(saveBtn(pendingBox).disabled).toBe(true);
  });

  it('mã thuộc lô thẻ in: hộp chọn khoá, có dòng giải thích, Lưu không gọi onSave', () => {
    const { box, onSave } = mount(coupon({ batch: 'LOT-1' }));
    expect(checkbox(box).disabled).toBe(true);
    expect(box.textContent).toContain('Chỉ mã nhận qua thẻ, không thuộc lô thẻ in, mới hiện ở mục Nhận mã');
    click(saveBtn(box));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('mã phạm vi PUBLIC: hộp chọn khoá, có dòng giải thích, Lưu không gọi onSave', () => {
    const { box, onSave } = mount(coupon({ scope: 'PUBLIC' }));
    expect(checkbox(box).disabled).toBe(true);
    expect(box.textContent).toContain('mới hiện ở mục Nhận mã');
    click(saveBtn(box));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('mã CLAIM thường không có dòng giải thích', () => {
    const { box } = mount(coupon());
    expect(box.textContent).not.toContain('Chỉ mã nhận qua thẻ');
  });
});
