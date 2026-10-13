// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unlabeledFields } from '@/test-utils/a11y';

// BUYERWEB-14: form địa chỉ chỉ có một dòng lỗi chung và nút Lưu xám không rõ lý do; không đánh dấu ô sai.

vi.mock('@/lib/geo-client', () => ({
  getProvinces: async () => [{ code: 'p1', name: 'Hà Nội' }, { code: 'p2', name: 'Hồ Chí Minh' }],
  getCommunes: async () => [{ code: 'w1', name: 'Cầu Giấy' }],
}));

import { AddressForm } from './address-form';

const GEO = { province: 'Hà Nội', provinceCode: 'p1', ward: 'Cầu Giấy', wardCode: 'w1' };

let mounted: Rendered[] = [];
const submit = vi.fn();
const cancel = vi.fn();
const mount = async (initial?: Parameters<typeof AddressForm>[0]['initial']) => {
  const r = render(<AddressForm title="Thêm địa chỉ mới" submitLabel="Lưu địa chỉ" initial={initial} onSubmit={submit} onCancel={cancel} />);
  mounted.push(r);
  await flush();
  return r.container;
};
const input = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll('label')).find((l) => l.textContent?.includes(label))!.querySelector('input')!;
const blur = (el: Element) => act(() => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
const saveBtn = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Lưu') || b.textContent === 'Đang lưu…')!;

beforeEach(() => {
  submit.mockReset().mockResolvedValue(undefined);
  cancel.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('AddressForm — báo lỗi tại từng ô (BUYERWEB-14)', () => {
  it('nút Lưu không bị khoá khi form trống; bấm vào thì mọi ô sai được đánh dấu kèm lời nhắc riêng và không gọi API', async () => {
    const c = await mount();
    expect(saveBtn(c).disabled).toBe(false);
    click(saveBtn(c));
    await flush();
    expect(submit).not.toHaveBeenCalled();
    expect(input(c, 'Người nhận').getAttribute('aria-invalid')).toBe('true');
    expect(input(c, 'Số điện thoại').getAttribute('aria-invalid')).toBe('true');
    expect(input(c, 'Số nhà, đường').getAttribute('aria-invalid')).toBe('true');
    expect(c.querySelector('select[aria-label="Tỉnh/thành"]')!.getAttribute('aria-invalid')).toBe('true');
    expect(c.querySelector('select[aria-label="Phường/xã"]')!.getAttribute('aria-invalid')).toBe('true');
    const text = c.textContent ?? '';
    for (const msg of ['Nhập tên người nhận.', 'Nhập số điện thoại.', 'Chọn tỉnh/thành.', 'Chọn phường/xã.', 'Nhập số nhà, tên đường.']) {
      expect(text).toContain(msg);
    }
  });

  it('con trỏ nhảy tới ô sai đầu tiên theo thứ tự màn hình', async () => {
    const c = await mount();
    click(saveBtn(c));
    await flush();
    expect(document.activeElement).toBe(input(c, 'Người nhận'));
  });

  it('lời nhắc gắn vào ô bằng aria-describedby để trình đọc màn hình đọc được', async () => {
    const c = await mount();
    typeInto(input(c, 'Số điện thoại'), '12345');
    blur(input(c, 'Số điện thoại'));
    await flush();
    const phone = input(c, 'Số điện thoại');
    const msg = c.ownerDocument.getElementById(phone.getAttribute('aria-describedby') ?? '');
    expect(msg?.textContent).toMatch(/^Số điện thoại chưa đúng/);
  });

  it('rời ô SĐT khi nhập sai thì báo ngay, chưa cần bấm Lưu; ô chưa chạm tới thì chưa báo', async () => {
    const c = await mount();
    typeInto(input(c, 'Số điện thoại'), '12345');
    expect(c.textContent).not.toContain('Số điện thoại chưa đúng');
    blur(input(c, 'Số điện thoại'));
    await flush();
    expect(c.textContent).toContain('Số điện thoại chưa đúng');
    expect(input(c, 'Người nhận').getAttribute('aria-invalid')).toBeNull();
  });

  it('sửa đúng thì lời nhắc biến mất', async () => {
    const c = await mount();
    click(saveBtn(c));
    typeInto(input(c, 'Người nhận'), 'Nguyễn An');
    await flush();
    expect(c.textContent).not.toContain('Nhập tên người nhận.');
    expect(input(c, 'Người nhận').getAttribute('aria-invalid')).toBeNull();
  });

  it('đủ và đúng: gửi payload đã chuẩn hoá một lần', async () => {
    const c = await mount();
    typeInto(input(c, 'Người nhận'), ' Nguyễn An ');
    typeInto(input(c, 'Số điện thoại'), '0912 345 678');
    typeInto(input(c, 'Số nhà, đường'), '1 Xuân Thuỷ');
    selectValue(c.querySelector('select[aria-label="Tỉnh/thành"]'), 'p1');
    await flush();
    selectValue(c.querySelector('select[aria-label="Phường/xã"]'), 'w1');
    click(saveBtn(c));
    await flush(6);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]![0]).toEqual({
      recipient: 'Nguyễn An', phone: '0912345678', street: '1 Xuân Thuỷ', province: 'Hà Nội', ward: 'Cầu Giấy',
      district: '', provinceCode: 'p1', wardCode: 'w1', districtCode: '',
    });
  });

  it('BE từ chối: hiện nguyên văn lời BE ở role="alert" và giữ nguyên dữ liệu đã nhập', async () => {
    submit.mockRejectedValue(new Error('Số điện thoại không hợp lệ.'));
    const c = await mount({ form: { recipient: 'An', phone: '0912345678', street: '1 Xuân Thuỷ' }, geo: GEO });
    click(saveBtn(c));
    await flush(6);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Số điện thoại không hợp lệ.');
    expect(input(c, 'Người nhận').value).toBe('An');
  });

  it('chế độ sửa: ô và tỉnh/phường được điền sẵn từ địa chỉ đã lưu', async () => {
    const c = await mount({ form: { recipient: 'An', phone: '0912345678', street: '1 Xuân Thuỷ' }, geo: GEO });
    expect(input(c, 'Số điện thoại').value).toBe('0912345678');
    expect((c.querySelector('select[aria-label="Tỉnh/thành"]') as HTMLSelectElement).value).toBe('p1');
    expect((c.querySelector('select[aria-label="Phường/xã"]') as HTMLSelectElement).value).toBe('w1');
  });

  it('Hủy gọi onCancel; truy cập: mọi ô có nhãn, vùng chạm đủ 44px', async () => {
    const c = await mount();
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Hủy') ?? null);
    expect(cancel).toHaveBeenCalledTimes(1);
    click(saveBtn(c));
    await flush();
    expect(unlabeledFields(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(headingProblems(c).filter((p) => !/h1/.test(p))).toEqual([]);
  });
});
