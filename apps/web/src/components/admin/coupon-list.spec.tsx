// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CouponList } from './coupon-list';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminCoupon } from '@/lib/admin-client';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const coupon = (over: Partial<AdminCoupon> = {}): AdminCoupon => ({
  id: 'c1',
  code: 'SUMMER10',
  type: 'PERCENT',
  value: 10,
  minOrder: 199000,
  maxDiscount: 50000,
  startAt: '2026-01-01T00:00:00.000Z',
  endAt: '2099-12-31T16:59:59.000Z',
  usageLimit: 100,
  perUserLimit: 1,
  scope: 'PUBLIC',
  isActive: true,
  redeemedCount: 7,
  ...over,
});

describe('CouponList — xem, tắt, gia hạn mã (ADMINOPS-8)', () => {
  it('hiện mã kèm giá trị, điều kiện và số lượt đã dùng', async () => {
    const api = mockFetch({ '/admin/coupons': { body: { data: [coupon()], meta: { page: 1, limit: 20, total: 1 } } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<CouponList />);
    mounted.push(r);
    await flush();
    const text = r.container.textContent ?? '';
    expect(text).toContain('Mã đã tạo (1)');
    expect(text).toContain('SUMMER10');
    expect(text).toContain('Đang chạy');
    expect(text).toContain('Đã dùng 7/100 lượt');
    expect(text).toContain('đơn từ 199.000');
  });

  it('mã ẩn thẻ hộp hàng: nhãn "Ẩn · thẻ hộp hàng", "Chỉ khách mới" và số khách đã nhận (D2-03)', async () => {
    const api = mockFetch({
      '/admin/coupons': {
        body: { data: [coupon({ code: 'SHOPEETHANG11', scope: 'CLAIM', newCustomerOnly: true, claimedCount: 42, redeemedCount: 9, usageLimit: 300 })], meta: { page: 1, limit: 20, total: 1 } },
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<CouponList />);
    mounted.push(r);
    await flush();
    const text = r.container.textContent ?? '';
    expect(text).toContain('Ẩn · thẻ hộp hàng');
    expect(text).toContain('Chỉ khách mới');
    expect(text).toContain('Đã nhận 42 · Đã dùng 9/300 lượt');
  });

  it('Tắt mã: hỏi xác nhận rồi PATCH isActive=false; huỷ thì không gửi gì', async () => {
    const api = mockFetch({
      '/admin/coupons/c1': { body: coupon({ isActive: false }) },
      '/admin/coupons': { body: { data: [coupon()], meta: { page: 1, limit: 20, total: 1 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<CouponList />);
    mounted.push(r);
    await flush();
    click(byText(r.container, 'button', 'Tắt mã'));
    await flush();
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(false);
    await flush();
    expect(api.calls.some((c) => c.init?.method === 'PATCH')).toBe(false);

    click(byText(r.container, 'button', 'Tắt mã'));
    await flush();
    answerConfirm(true);
    await flush();
    const patch = api.calls.find((c) => c.init?.method === 'PATCH');
    expect(patch?.url).toContain('/admin/coupons/c1');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ isActive: false });
    expect(r.container.textContent).toContain('Đã tắt mã SUMMER10.');
  });

  it('mã đã tắt hiện nhãn "Đã tắt" và nút "Bật lại" (không cần xác nhận)', async () => {
    const api = mockFetch({
      '/admin/coupons/c1': { body: coupon() },
      '/admin/coupons': { body: { data: [coupon({ isActive: false })], meta: { page: 1, limit: 20, total: 1 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<CouponList />);
    mounted.push(r);
    await flush();
    expect(r.container.textContent).toContain('Đã tắt');
    click(byText(r.container, 'button', 'Bật lại'));
    await flush();
    expect(confirmDialog()).toBeNull();
    const patch = api.calls.find((c) => c.init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ isActive: true });
  });

  it('đổi hạn: gửi cuối ngày đã chọn theo giờ Việt Nam và hiện ngày dạng dd/MM/yyyy', async () => {
    const api = mockFetch({
      '/admin/coupons/c1': { body: coupon({ endAt: '2027-01-05T16:59:59.000Z' }) },
      '/admin/coupons': { body: { data: [coupon({ startAt: '2026-01-04T17:00:00.000Z' })], meta: { page: 1, limit: 20, total: 1 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<CouponList />);
    mounted.push(r);
    await flush();
    expect(r.container.textContent).toContain('05/01/2026 – 31/12/2099');
    typeInto(r.container.querySelector<HTMLInputElement>('input[type="date"]'), '2027-01-05');
    await flush();
    click(byText(r.container, 'button', 'Lưu hạn'));
    await flush();
    const patch = api.calls.find((c) => c.init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ endAt: '2027-01-05T16:59:59.000Z' });
    expect(r.container.textContent).toContain('Đã đổi hạn mã SUMMER10 đến hết 05/01/2027.');
  });

  it('ô ngày gõ dở thì "Lưu hạn" khoá, không gửi PATCH', async () => {
    const api = mockFetch({
      '/admin/coupons/c1': { body: coupon() },
      '/admin/coupons': { body: { data: [coupon()], meta: { page: 1, limit: 20, total: 1 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<CouponList />);
    mounted.push(r);
    await flush();
    const field = r.container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    typeInto(field, '05/01/2027');
    await flush();
    const save = byText(r.container, 'button', 'Lưu hạn') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    typeInto(field, '05/01/202');
    await flush();
    expect(save.disabled).toBe(true);
    expect(api.calls.some((c) => c.init?.method === 'PATCH')).toBe(false);
  });

  it('gõ ngày dở dang không gửi gì: chỉ gửi một lần, với ngày cuối cùng, khi bấm "Lưu hạn"', async () => {
    const api = mockFetch({
      '/admin/coupons/c1': { body: coupon({ endAt: '2027-01-05T16:59:59.000Z' }) },
      '/admin/coupons': { body: { data: [coupon()], meta: { page: 1, limit: 20, total: 1 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<CouponList />);
    mounted.push(r);
    await flush();
    const input = r.container.querySelector<HTMLInputElement>('input[type="date"]')!;
    const save = byText(r.container, 'button', 'Lưu hạn') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    for (const partial of ['0002-01-05', '0020-01-05', '0202-01-05', '2027-01-05']) {
      typeInto(input, partial);
      await flush();
    }
    expect(input.value).toBe('2027-01-05');
    expect(api.calls.some((c) => c.init?.method === 'PATCH')).toBe(false);
    expect(save.disabled).toBe(false);

    click(save);
    await flush();
    const patches = api.calls.filter((c) => c.init?.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(JSON.parse(String(patches[0]!.init?.body))).toEqual({ endAt: '2027-01-05T16:59:59.000Z' });
    expect(input.value).toBe('');
  });

  it('lỗi từ server khi đổi hạn (ngày kết thúc trước ngày bắt đầu) hiện nguyên văn tiếng Việt', async () => {
    const api = mockFetch({
      '/admin/coupons/c1': { status: 400, body: { message: 'Ngày kết thúc phải sau ngày bắt đầu.' } },
      '/admin/coupons': { body: { data: [coupon()], meta: { page: 1, limit: 20, total: 1 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<CouponList />);
    mounted.push(r);
    await flush();
    typeInto(r.container.querySelector<HTMLInputElement>('input[type="date"]'), '2025-01-01');
    await flush();
    click(byText(r.container, 'button', 'Lưu hạn'));
    await flush();
    expect(r.container.textContent).toContain('Ngày kết thúc phải sau ngày bắt đầu.');
  });
});

describe('CouponList — hiện ở mục Nhận mã', () => {
  const listBody = (c: AdminCoupon) => ({ '/admin/coupons': { body: { data: [c], meta: { page: 1, limit: 20, total: 1 } } } });

  it('mã CLAIM đang hiện ở kho: nhãn "Hiện ở mục Nhận mã" thay cho "Ẩn · thẻ hộp hàng", kèm tên hiển thị', async () => {
    const api = mockFetch(listBody(coupon({ scope: 'CLAIM', listed: true, title: 'Mừng bạn mới' })));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<CouponList />);
    mounted.push(r);
    await flush();
    const badges = r.container.querySelector('li')!.querySelectorAll('span');
    expect([...badges].some((b) => b.textContent === 'Hiện ở mục Nhận mã')).toBe(true);
    expect(r.container.textContent).not.toContain('Ẩn · thẻ hộp hàng');
    expect(r.container.querySelector<HTMLInputElement>('input[aria-label="Tên hiển thị mã SUMMER10"]')!.value).toBe('Mừng bạn mới');
  });

  it('bật hiện + đặt tên rồi Lưu: PATCH { listed: true, title } và báo đã hiện', async () => {
    const api = mockFetch({
      '/admin/coupons/c1': { body: coupon({ scope: 'CLAIM', listed: true, title: 'Mừng bạn mới' }) },
      ...listBody(coupon({ scope: 'CLAIM' })),
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<CouponList />);
    mounted.push(r);
    await flush();
    click(r.container.querySelector('input[type="checkbox"]'));
    typeInto(r.container.querySelector('input[aria-label="Tên hiển thị mã SUMMER10"]'), 'Mừng bạn mới');
    click([...r.container.querySelectorAll('button')].find((b) => b.textContent === 'Lưu')!);
    await flush();
    const call = api.calls.find((c) => c.init?.method === 'PATCH')!;
    expect(call.url).toContain('/admin/coupons/c1');
    expect(JSON.parse(String(call.init!.body))).toEqual({ listed: true, title: 'Mừng bạn mới' });
    expect(r.container.textContent).toContain('hiện ở mục Nhận mã');
  });

  it('máy chủ từ chối (mã lô thẻ in): hiện đúng lời từ chối, không báo thành công', async () => {
    const api = mockFetch({
      '/admin/coupons/c1': { status: 400, body: { message: 'Mã thuộc lô thẻ in là mã riêng từng thẻ, không hiện ở mục Nhận mã được.' } },
      ...listBody(coupon({ scope: 'CLAIM' })),
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<CouponList />);
    mounted.push(r);
    await flush();
    click(r.container.querySelector('input[type="checkbox"]'));
    click([...r.container.querySelectorAll('button')].find((b) => b.textContent === 'Lưu')!);
    await flush();
    expect(r.container.textContent).toContain('Mã thuộc lô thẻ in là mã riêng từng thẻ');
  });
});
