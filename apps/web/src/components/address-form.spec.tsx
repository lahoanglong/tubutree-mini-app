// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from '@/lib/client-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseGeo, click, flush, render, selectByLabel, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unlabeledFields } from '@/test-utils/a11y';

// BUYERWEB-14: form địa chỉ chỉ có một dòng lỗi chung và nút Lưu xám không rõ lý do; không đánh dấu ô sai.

vi.mock('@/lib/geo-client', () => ({
  getProvinces: async () => [{ code: 'p1', name: 'Hà Nội' }, { code: 'p2', name: 'Hồ Chí Minh' }, { code: '84_VN01', name: 'Hà Nội' }, { code: '84_VN79', name: 'Hồ Chí Minh' }],
  getCommunes: async () => [{ code: 'w1', name: 'Cầu Giấy' }, { code: '84_VN0101', name: 'Cầu Giấy' }],
}));

import { AddressForm } from './address-form';

const GEO = { province: 'Hà Nội', provinceCode: 'p1', ward: 'Cầu Giấy', wardCode: 'w1' };

let mounted: Rendered[] = [];
const submit = vi.fn();
const cancel = vi.fn();
const mocks = vi.hoisted(() => ({
  me: { fullName: 'Phạm Văn CTV', phone: '0901000004' } as { fullName?: string | null; phone?: string | null },
  meGate: null as Promise<void> | null,
}));
vi.mock('@/lib/shop-client', async (orig) => ({
  ...(await orig<typeof import('@/lib/shop-client')>()),
  getMe: async () => {
    if (mocks.meGate) await mocks.meGate;
    return { pointsBalance: 0, walletBalance: 0, ...mocks.me };
  },
}));

const mount = async (initial?: Parameters<typeof AddressForm>[0]['initial']) => {
  const r = render(<AddressForm title="Thêm địa chỉ" submitLabel="Lưu" initial={initial} userId="u1" onSubmit={submit} onCancel={cancel} />);
  mounted.push(r);
  await flush();
  return r.container;
};
const input = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll('label')).find((l) => l.textContent?.includes(label))!.querySelector('input')!;
const blur = (el: Element) => act(() => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
const saveBtn = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Lưu') || b.textContent === 'Đang lưu…')!;

beforeEach(() => {
  mocks.me = { fullName: 'Phạm Văn CTV', phone: '0901000004' };
  mocks.meGate = null;
  localStorage.clear();
  submit.mockReset().mockResolvedValue(undefined);
  cancel.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('AddressForm — báo lỗi tại từng ô (BUYERWEB-14)', () => {
  it('nút Lưu không bị khoá khi form trống; bấm vào thì mọi ô sai được đánh dấu kèm lời nhắc riêng và không gọi API', async () => {
    mocks.me = {};
    const c = await mount();
    expect(saveBtn(c).disabled).toBe(false);
    click(saveBtn(c));
    await flush();
    expect(submit).not.toHaveBeenCalled();
    expect(input(c, 'Người nhận').getAttribute('aria-invalid')).toBe('true');
    expect(input(c, 'Số điện thoại').getAttribute('aria-invalid')).toBe('true');
    expect(input(c, 'Số nhà, tên đường').getAttribute('aria-invalid')).toBe('true');
    expect(selectByLabel(c, 'Tỉnh/Thành phố')!.getAttribute('aria-invalid')).toBe('true');
    expect(selectByLabel(c, 'Phường/Xã')!.getAttribute('aria-invalid')).toBe('true');
    const text = c.textContent ?? '';
    for (const msg of ['Nhập tên người nhận.', 'Nhập số điện thoại.', 'Chọn tỉnh/thành.', 'Chọn phường/xã.', 'Nhập số nhà, tên đường.']) {
      expect(text).toContain(msg);
    }
  });

  it('con trỏ nhảy tới ô sai đầu tiên theo thứ tự màn hình', async () => {
    mocks.me = {};
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
    typeInto(input(c, 'Số nhà, tên đường'), '1 Xuân Thuỷ');
    chooseGeo(c, 'Tỉnh/Thành phố', 'p1');
    await flush();
    chooseGeo(c, 'Phường/Xã', 'w1');
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
    expect(selectByLabel(c, 'Tỉnh/Thành phố')!.getAttribute('data-value')).toBe('p1');
    expect(selectByLabel(c, 'Tỉnh/Thành phố')!.textContent).toContain('Hà Nội');
    expect(selectByLabel(c, 'Phường/Xã')!.getAttribute('data-value')).toBe('w1');
    expect(selectByLabel(c, 'Phường/Xã')!.textContent).toContain('Cầu Giấy');
  });

  it('Huỷ gọi onCancel; truy cập: mọi ô có nhãn, vùng chạm đủ 44px', async () => {
    const c = await mount();
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Huỷ') ?? null);
    expect(cancel).toHaveBeenCalledTimes(1);
    click(saveBtn(c));
    await flush();
    expect(unlabeledFields(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(headingProblems(c).filter((p) => !/h1/.test(p))).toEqual([]);
  });
});


// W71B: Lưu địa chỉ khoá đồng bộ bằng ref. `save.isPending` chỉ đúng sau lần vẽ kế, hai cú gửi form sát nhau (bấm đúp, Enter giữ phím)
// vẫn đều thấy nút bật và tạo hai địa chỉ. Đang lưu nút giữ focus: aria-busy + aria-disabled, không `disabled` thật.
describe('AddressForm — Lưu khoá đồng bộ chống bấm đúp (W71B)', () => {
  const FILLED = { form: { recipient: 'An', phone: '0912345678', street: '1 Xuân Thuỷ' }, geo: GEO };
  const hold = () => {
    let release!: () => void;
    let fail!: (e: Error) => void;
    submit.mockReturnValue(new Promise<void>((res, rej) => { release = res; fail = rej; }));
    return { release: () => release(), fail: (e: Error) => fail(e) };
  };
  const twice = (el: HTMLElement) => act(() => { el.click(); el.click(); });

  it('hai cú bấm Lưu trong cùng một khung hình chỉ gọi onSubmit một lần', async () => {
    const gate = hold();
    const c = await mount(FILLED);
    twice(saveBtn(c));
    await flush(2);
    expect(submit).toHaveBeenCalledTimes(1);
    gate.release();
    await flush(4);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('gửi form hai lần liền (Enter giữ phím) chỉ gọi onSubmit một lần', async () => {
    const gate = hold();
    const c = await mount(FILLED);
    const form = c.querySelector('form')!;
    act(() => { form.requestSubmit(); form.requestSubmit(); });
    await flush(2);
    expect(submit).toHaveBeenCalledTimes(1);
    gate.release();
    await flush(4);
  });

  it('đang lưu: nút Lưu aria-busy + aria-disabled, không `disabled` thật, giữ focus, bấm thêm không gọi lại', async () => {
    const gate = hold();
    const c = await mount(FILLED);
    expect(saveBtn(c).getAttribute('aria-busy')).toBeNull();
    expect(saveBtn(c).getAttribute('aria-disabled')).toBeNull();
    saveBtn(c).focus();
    click(saveBtn(c));
    await flush(2);
    const btn = saveBtn(c);
    expect(btn.textContent).toBe('Đang lưu…');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    expect(document.activeElement).toBe(btn);
    click(btn);
    await flush(2);
    expect(submit).toHaveBeenCalledTimes(1);
    gate.release();
    await flush(4);
  });

  it('lưu lỗi: hiện lời BE ở role="alert", nút giữ focus, nhả khoá để bấm lại (mỗi cú đôi vẫn một lần)', async () => {
    const gate = hold();
    const c = await mount(FILLED);
    saveBtn(c).focus();
    click(saveBtn(c));
    await flush(2);
    gate.fail(new Error('Số điện thoại không hợp lệ.'));
    await flush(4);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Số điện thoại không hợp lệ.');
    expect(saveBtn(c).getAttribute('aria-busy')).toBeNull();
    expect(saveBtn(c).getAttribute('aria-disabled')).toBeNull();
    expect(document.activeElement).toBe(saveBtn(c));
    submit.mockReset().mockResolvedValue(undefined);
    twice(saveBtn(c));
    await flush(4);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  // Máy chủ từ chối vì sổ địa chỉ không còn khớp (địa chỉ đang sửa đã bị xoá ở máy khác, đủ số địa chỉ): sổ và báo giá tải lại, khoá giữ tới khi sổ về, lời lỗi vẫn hiện ngay.
  const mountWithClient = async (initial: Parameters<typeof AddressForm>[0]['initial']) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    let reload!: () => void;
    const gate = new Promise<void>((r) => (reload = r));
    const keys: unknown[] = [];
    vi.spyOn(client, 'invalidateQueries').mockImplementation(((f: { queryKey: unknown }) => {
      keys.push(f.queryKey);
      return gate;
    }) as never);
    const r = render(<AddressForm title="Sửa địa chỉ" submitLabel="Lưu" initial={initial} userId="u1" onSubmit={submit} onCancel={cancel} />, client);
    mounted.push(r);
    await flush();
    return { c: r.container, keys, reload: () => reload() };
  };

  it.each([400, 404, 409, 422])('W121: máy chủ từ chối %i: lời lỗi hiện ngay, sổ địa chỉ và báo giá tải lại, nút Lưu giữ bận tới khi sổ về; bấm thêm không gọi lại', async (status) => {
    submit.mockReset().mockRejectedValue(new ApiError('Địa chỉ không còn trong sổ.', status));
    const { c, keys, reload } = await mountWithClient(FILLED);
    saveBtn(c).focus();
    click(saveBtn(c));
    await flush(4);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Địa chỉ không còn trong sổ.');
    expect(keys).toEqual([['addresses'], ['quote']]);
    expect(saveBtn(c).getAttribute('aria-busy')).toBe('true');
    expect(saveBtn(c).disabled).toBe(false);
    expect(document.activeElement).toBe(saveBtn(c));
    twice(saveBtn(c));
    await flush(2);
    expect(submit).toHaveBeenCalledTimes(1);
    reload();
    await flush(4);
    expect(saveBtn(c).getAttribute('aria-busy')).toBeNull();
    submit.mockReset().mockResolvedValue(undefined);
    click(saveBtn(c));
    await flush(4);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['lỗi 500', () => new ApiError('Máy chủ bận.', 500)],
    ['mất mạng', () => new NetworkError(false)],
  ])('W121: %s: lời lỗi hiện, KHÔNG tải lại sổ (lần tải cũng hỏng), nhả khoá ngay', async (_name, makeError) => {
    submit.mockReset().mockRejectedValue(makeError());
    const { c, keys } = await mountWithClient(FILLED);
    click(saveBtn(c));
    await flush(4);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(keys).toEqual([]);
    expect(saveBtn(c).getAttribute('aria-busy')).toBeNull();
  });

  it('lưu xong mà form còn trên màn (nơi gọi chưa đóng): nhả khoá, lần lưu sau vẫn gọi được', async () => {
    const c = await mount(FILLED);
    click(saveBtn(c));
    await flush(4);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(saveBtn(c).getAttribute('aria-busy')).toBeNull();
    click(saveBtn(c));
    await flush(4);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('bấm khi còn thiếu ô: chỉ chỉ ra ô sai, KHÔNG đặt khoá, nút không busy; điền đủ rồi lưu được', async () => {
    mocks.me = {};
    const c = await mount();
    twice(saveBtn(c));
    await flush(2);
    expect(submit).not.toHaveBeenCalled();
    expect(saveBtn(c).getAttribute('aria-busy')).toBeNull();
    typeInto(input(c, 'Người nhận'), 'Nguyễn An');
    typeInto(input(c, 'Số điện thoại'), '0912345678');
    typeInto(input(c, 'Số nhà, tên đường'), '1 Xuân Thuỷ');
    chooseGeo(c, 'Tỉnh/Thành phố', 'p1');
    await flush();
    chooseGeo(c, 'Phường/Xã', 'w1');
    click(saveBtn(c));
    await flush(4);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe('AddressForm tạo mới — điền sẵn từ hồ sơ và địa giới lần trước (parity Mini App)', () => {
  it('điền sẵn Người nhận và SĐT từ hồ sơ', async () => {
    const c = await mount();
    expect(input(c, 'Người nhận').value).toBe('Phạm Văn CTV');
    expect(input(c, 'Số điện thoại').value).toBe('0901000004');
  });

  it('tên giữ chỗ "Khách" không được điền', async () => {
    mocks.me = { fullName: 'Khách', phone: '0901000004' };
    const c = await mount();
    expect(input(c, 'Người nhận').value).toBe('');
    expect(input(c, 'Số điện thoại').value).toBe('0901000004');
  });

  it('hồ sơ tải xong sau khi mở form: điền vào ô còn trống, không đè ô khách đã gõ', async () => {
    let resolveMe!: () => void;
    mocks.meGate = new Promise<void>((r) => { resolveMe = r; });
    const c = await mount();
    expect(input(c, 'Người nhận').value).toBe('');
    expect(input(c, 'Số điện thoại').value).toBe('');
    typeInto(input(c, 'Số điện thoại'), '0988777666');
    resolveMe();
    await flush();
    expect(input(c, 'Người nhận').value).toBe('Phạm Văn CTV');
    expect(input(c, 'Số điện thoại').value).toBe('0988777666');
  });

  it('sửa địa chỉ có sẵn: không đè bằng hồ sơ', async () => {
    const c = await mount({ form: { recipient: 'Người Khác', phone: '0912345678', street: '1 A' }, geo: GEO });
    expect(input(c, 'Người nhận').value).toBe('Người Khác');
    expect(input(c, 'Số điện thoại').value).toBe('0912345678');
  });

  it('tỉnh/phường lấy từ lần lưu gần nhất của chính tài khoản này', async () => {
    localStorage.setItem('tubu_last_geo:u1', JSON.stringify({ province: 'Hà Nội', provinceCode: '84_VN01', ward: 'Cầu Giấy', wardCode: '84_VN0101' }));
    localStorage.setItem('tubu_last_geo:u2', JSON.stringify({ province: 'X', provinceCode: '84_VN99', ward: 'Y', wardCode: '84_VN9901' }));
    const c = await mount();
    expect(selectByLabel(c, 'Tỉnh/Thành phố')!.getAttribute('data-value')).toBe('84_VN01');
  });

  it('chưa nhớ gì thì lấy địa chỉ mặc định trong sổ địa chỉ đã tải', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['addresses'], [
      { id: 'a', recipient: 'A', phone: '0901', street: 's', province: 'Hà Nội', provinceCode: '84_VN01', ward: 'Cầu Giấy', wardCode: '84_VN0101', district: '', districtCode: '', isDefault: false },
      { id: 'b', recipient: 'B', phone: '0902', street: 's', province: 'Hồ Chí Minh', provinceCode: '84_VN79', ward: 'Bến Nghé', wardCode: '84_VN7901', district: '', districtCode: '', isDefault: true },
    ]);
    const r = render(<AddressForm title="Thêm địa chỉ" submitLabel="Lưu" userId="u1" onSubmit={submit} onCancel={cancel} />, client);
    mounted.push(r);
    await flush();
    expect(selectByLabel(r.container, 'Tỉnh/Thành phố')!.getAttribute('data-value')).toBe('84_VN79');
  });

  it('lưu thành công thì nhớ tỉnh/phường cho lần sau', async () => {
    const c = await mount();
    typeInto(input(c, 'Người nhận'), 'An');
    typeInto(input(c, 'Số nhà, tên đường'), '1 Xuân Thuỷ');
    chooseGeo(c, 'Tỉnh/Thành phố', '84_VN01');
    await flush();
    chooseGeo(c, 'Phường/Xã', '84_VN0101');
    await flush();
    click(saveBtn(c));
    await flush();
    expect(submit).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('tubu_last_geo:u1')!)).toMatchObject({ provinceCode: '84_VN01', wardCode: '84_VN0101' });
  });

  it('không có userId thì không ghi bộ nhớ tỉnh/phường dưới khoá nào (kể cả khoá chung)', async () => {
    const r = render(<AddressForm title="Thêm địa chỉ" submitLabel="Lưu" onSubmit={submit} onCancel={cancel} />);
    mounted.push(r);
    await flush();
    const c = r.container;
    typeInto(input(c, 'Người nhận'), 'An');
    typeInto(input(c, 'Số nhà, tên đường'), '1 Xuân Thuỷ');
    chooseGeo(c, 'Tỉnh/Thành phố', '84_VN01');
    await flush();
    chooseGeo(c, 'Phường/Xã', '84_VN0101');
    await flush();
    click(saveBtn(c));
    await flush();
    expect(submit).toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('A11Y-17: mọi ô bắt buộc (người nhận, SĐT, tỉnh, phường, số nhà) có aria-required="true"', async () => {
    const c = await mount();
    expect(input(c, 'Người nhận').getAttribute('aria-required')).toBe('true');
    expect(input(c, 'Số điện thoại').getAttribute('aria-required')).toBe('true');
    expect(input(c, 'Số nhà, tên đường').getAttribute('aria-required')).toBe('true');
    expect(selectByLabel(c, 'Tỉnh/Thành phố')!.getAttribute('aria-required')).toBe('true');
    expect(selectByLabel(c, 'Phường/Xã')!.getAttribute('aria-required')).toBe('true');
  });
});

describe('AddressForm — khổ điện thoại giống Mini App', () => {
  it('dưới md: không khung viền quanh form và tiêu đề chỉ để trình đọc màn hình (Mini không có hai thứ này)', async () => {
    const c = await mount();
    const form = c.querySelector('form')!;
    // Khung viết kiểu mobile-first: lớp không tiền tố là khổ điện thoại (không viền, không đệm), viền và đệm chỉ bật từ md.
    const formClasses = form.className.split(/\s+/);
    expect(formClasses).not.toContain('border');
    expect(formClasses).not.toContain('p-3');
    expect(formClasses).toEqual(expect.arrayContaining(['md:border', 'md:p-3']));
    const headingClasses = c.querySelector('form h3')!.className.split(/\s+/);
    expect(headingClasses).toContain('sr-only');
    expect(headingClasses).toContain('md:not-sr-only');
  });

  it('nhãn dùng bậc field-label (12px/500), lời báo lỗi cỡ 13px (text-caption), không dùng text-xs', async () => {
    mocks.me = {};
    const c = await mount();
    click(saveBtn(c));
    await flush();
    const labels = Array.from(c.querySelectorAll('form label > span'));
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      expect(l.className).toContain('text-field-label');
      expect(l.className).not.toContain('text-xs');
    }
    const errors = Array.from(c.querySelectorAll('form p[id]'));
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) {
      expect(e.className).toContain('text-caption');
      expect(e.className).not.toContain('text-xs');
    }
  });
});

// Khách dán SĐT từ Zalo (chấm, gạch, ngoặc, 84, ký tự vô hình) không được gặp lỗi sai; chuẩn hoá khi rời ô, khi dán và khi gửi, không từng phím.
describe('AddressForm — ô SĐT nhận chữ dán từ Zalo', () => {
  const paste = (el: Element, text: string) => {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
    act(() => {
      el.dispatchEvent(ev);
    });
    return ev;
  };
  const phone = (c: HTMLElement) => input(c, 'Số điện thoại');

  it('ô có inputMode tel, autocomplete tel và số thẳng hàng (tabular-nums)', async () => {
    const c = await mount();
    expect(phone(c).getAttribute('inputmode')).toBe('tel');
    expect(phone(c).getAttribute('autocomplete')).toBe('tel');
    expect(phone(c).className.split(/\s+/)).toContain('tabular-nums');
    expect(input(c, 'Người nhận').className.split(/\s+/)).not.toContain('tabular-nums');
  });

  it('đang gõ thì ô giữ nguyên từng ký tự (không nhảy), rời ô mới chuẩn hoá về 0xxxxxxxxx', async () => {
    const c = await mount();
    typeInto(phone(c), '0912.345');
    expect(phone(c).value).toBe('0912.345');
    typeInto(phone(c), '0912.345.678');
    expect(phone(c).value).toBe('0912.345.678');
    blur(phone(c));
    await flush();
    expect(phone(c).value).toBe('0912345678');
    expect(c.textContent).not.toContain('Số điện thoại chưa đúng');
  });

  it('rời ô với số sai: giữ nguyên chữ khách gõ và báo đúng câu cũ', async () => {
    const c = await mount();
    typeInto(phone(c), '(091) 234 567');
    blur(phone(c));
    await flush();
    expect(phone(c).value).toBe('(091) 234 567');
    expect(c.textContent).toContain('Số điện thoại chưa đúng. Nhập 10 số bắt đầu bằng 0 (hoặc +84 và 9 số).');
  });

  it('dán cả số kiểu Zalo: thay ô bằng 0xxxxxxxxx ngay, kể cả khi dài hơn maxLength của ô', async () => {
    const c = await mount();
    for (const pasted of ['(+84) 912 345 678', '\u200E+84 912 345 678\u200E', '84912345678', '0912–345–678', '0084 912 345 678']) {
      const ev = paste(phone(c), pasted);
      expect(ev.defaultPrevented, pasted).toBe(true);
      expect(phone(c).value, pasted).toBe('0912345678');
      typeInto(phone(c), '');
    }
  });

  it('dán chữ không phải một số điện thoại đầy đủ: để trình duyệt dán như thường', async () => {
    const c = await mount();
    for (const pasted of ['0912', 'Số: 0912 345 678', '']) {
      expect(paste(phone(c), pasted).defaultPrevented, pasted).toBe(false);
    }
  });

  it('gửi payload SĐT dạng chuẩn dù ô còn dạng dán thô (chưa rời ô)', async () => {
    const c = await mount();
    typeInto(input(c, 'Người nhận'), 'Nguyễn An');
    typeInto(phone(c), '(+84) 912.345.678');
    typeInto(input(c, 'Số nhà, tên đường'), '1 Xuân Thuỷ');
    chooseGeo(c, 'Tỉnh/Thành phố', 'p1');
    await flush();
    chooseGeo(c, 'Phường/Xã', 'w1');
    click(saveBtn(c));
    await flush(6);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]![0]).toMatchObject({ phone: '0912345678' });
  });
});
