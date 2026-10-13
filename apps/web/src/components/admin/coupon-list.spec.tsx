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
    expect(r.container.textContent).toContain('Ngày kết thúc phải sau ngày bắt đầu.');
  });
});
