// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { SubscriptionsPanel } from './subscriptions-panel';
import { subscriptionPatch } from './subscription-edit-sheet';

// Mini App subscriptions-panel.spec.tsx: danh sách lịch, sửa (PATCH chỉ trường đổi), tạm dừng/tiếp tục, huỷ qua sheet giữ chân, bỏ kỳ.

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: 'authenticated', initialized: true, sessionUnavailable: false }) }));

const SUB = {
  id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-10-15T00:00:00.000Z',
  addressId: 'a1', paymentMethod: 'COD', lastOrderId: null,
  productName: 'Nước xả vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nxv', unitPrice: 80000, effectiveDiscountPct: 0.14,
};
const ADDR = (id: string, street: string) => ({
  id, recipient: 'Lan', phone: '0900000000', province: 'HCM', district: 'Q.1', ward: 'P.1', street,
  provinceCode: '79', districtCode: '760', wardCode: '1', isDefault: id === 'a1',
});

interface Call { method: string; path: string; body: unknown }
let calls: Call[] = [];
let subs: Record<string, unknown>[] = [SUB];
let failures: Record<string, { status: number; message: string }> = {};
let listFailsOnce = false;

function stubApi() {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      const fail = failures[`${method} ${path}`];
      if (fail) return json({ message: fail.message }, fail.status);
      if (method === 'GET' && path === '/me/subscriptions') {
        if (listFailsOnce) {
          listFailsOnce = false;
          return json({ message: 'boom' }, 500);
        }
        return json(subs);
      }
      if (method === 'GET' && path === '/me/addresses') return json([ADDR('a1', '1 Lê Lợi'), ADDR('a2', '9 Hai Bà Trưng')]);
      if (method === 'GET' && path === '/me/wallet') return json({ walletBalance: 50000 });
      if (method === 'GET' && path === '/config/public') return json({ subscribeDiscountPct: 0.12 });
      return json(SUB);
    }),
  );
}
const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<SubscriptionsPanel />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const radio = (text: string) =>
  Array.from(document.body.querySelectorAll('label')).find((l) => l.textContent?.includes(text))?.querySelector('input') ?? null;
const btn = (label: string, root: ParentNode = document.body) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;

beforeEach(() => {
  subs = [SUB];
  failures = {};
  listFailsOnce = false;
  stubApi();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('SubscriptionsPanel', () => {
  it('liệt kê lịch: tên, chu kỳ + tiền, trạng thái, % giảm đang áp, lần kế', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Nước xả vải Tubu');
    expect(c.textContent).toContain('Mỗi 4 tuần · 137.600đ');
    expect(c.textContent).toContain('Đang chạy');
    expect(c.textContent).toContain('Đang giảm 14% cho đơn định kỳ');
    expect(c.textContent).toContain('Lần kế: 15/10/2026');
  });

  it('lời giới thiệu lấy % giảm từ gói đầu, chưa có gói thì từ cấu hình công khai', async () => {
    subs = [];
    const c = await mount();
    expect(c.textContent).toContain('tiết kiệm 12% mỗi đơn');
  });

  it('giá mỗi kỳ là giá SAU giảm; giá gốc gạch ngang kèm nhãn tiết kiệm', async () => {
    subs = [{ ...SUB, cycleSubtotal: 160000, cycleDiscount: 22400, cycleGoods: 137600 }];
    const c = await mount();
    expect(c.textContent).toContain('Mỗi 4 tuần · 137.600đ');
    expect(Array.from(c.querySelectorAll('s')).map((s) => s.textContent)).toEqual(['160.000đ']);
    expect(c.textContent).toContain('Tiết kiệm 14%');
    expect(c.textContent).not.toContain('Mỗi 4 tuần · 160.000đ');
  });

  it('API cũ chưa trả cycle*: thẻ tự tính cùng công thức (phần giảm làm tròn xuống)', async () => {
    subs = [{ ...SUB, unitPrice: 99_990, quantity: 3 }];
    const c = await mount();
    expect(c.textContent).toContain('Mỗi 4 tuần · 257.975đ');
    expect(c.querySelector('s')?.textContent).toBe('299.970đ');
  });

  it('không giảm giá (0%): chỉ hiện giá mỗi kỳ, không gạch ngang, không nhãn tiết kiệm', async () => {
    subs = [{ ...SUB, effectiveDiscountPct: 0 }];
    const c = await mount();
    expect(c.textContent).toContain('Mỗi 4 tuần · 160.000đ');
    expect(c.querySelector('s')).toBeNull();
    expect(c.textContent).not.toContain('Tiết kiệm');
  });

  it('thẻ hiện cách trả + địa chỉ giao (phân biệt các gói cùng SP khác địa chỉ)', async () => {
    subs = [SUB, { ...SUB, id: 's2', addressId: 'a2', paymentMethod: 'WALLET' }];
    const c = await mount();
    expect(c.textContent).toContain('Giao tới: 1 Lê Lợi, P.1, Q.1');
    expect(c.textContent).toContain('Giao tới: 9 Hai Bà Trưng, P.1, Q.1');
    expect(c.textContent).toContain('Thanh toán: COD');
    expect(c.textContent).toContain('Thanh toán: Ví Tubu');
  });

  it('"Sửa" mở sheet; đổi số lượng + địa chỉ + cách trả → PATCH /me/subscriptions/:id chỉ các trường đã đổi', async () => {
    const c = await mount();
    click(btn('Sửa', c));
    await flush(6);
    expect(document.body.textContent).toContain('Sửa gói định kỳ');
    const save = btn('Lưu thay đổi');
    expect(save.disabled).toBe(true);
    click(btn('Tăng số lượng'));
    await flush();
    click(radio('9 Hai Bà Trưng'));
    click(radio('Chuyển khoản ngân hàng'));
    await flush();
    click(btn('Lưu thay đổi'));
    await flush(8);
    expect(sent('PATCH', '/me/subscriptions/s1')[0]!.body).toEqual({ quantity: 3, addressId: 'a2', paymentMethod: 'BANK_TRANSFER' });
    expect(c.textContent).toContain('Đã cập nhật gói định kỳ');
  });

  it('chỉ đổi số lượng → PATCH chỉ có quantity', async () => {
    const c = await mount();
    click(btn('Sửa', c));
    await flush(6);
    click(btn('Giảm số lượng'));
    click(btn('Lưu thay đổi'));
    await flush(8);
    expect(sent('PATCH', '/me/subscriptions/s1')[0]!.body).toEqual({ quantity: 1 });
  });

  it('gói tạm dừng cũng sửa được; API từ chối (trùng gói 409) → báo lỗi, sheet vẫn mở', async () => {
    subs = [{ ...SUB, status: 'PAUSED' }];
    failures['PATCH /me/subscriptions/s1'] = { status: 409, message: 'Bạn đã có gói định kỳ cho sản phẩm này tại địa chỉ đó.' };
    const c = await mount();
    click(btn('Sửa', c));
    await flush(6);
    click(radio('9 Hai Bà Trưng'));
    await flush();
    click(btn('Lưu thay đổi'));
    await flush(8);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Bạn đã có gói định kỳ cho sản phẩm này tại địa chỉ đó.');
    expect(document.body.textContent).toContain('Sửa gói định kỳ');
  });

  it('"Tạm dừng" gọi POST /status PAUSED; "Tiếp tục" ở gói đang dừng gọi ACTIVE', async () => {
    const c = await mount();
    click(btn('Tạm dừng', c));
    await flush(6);
    expect(sent('POST', '/me/subscriptions/s1/status')[0]!.body).toEqual({ status: 'PAUSED' });

    mounted.forEach((m) => m.unmount());
    mounted = [];
    subs = [{ ...SUB, status: 'PAUSED' }];
    calls = [];
    const c2 = await mount();
    expect(c2.textContent).toContain('Đang tạm dừng');
    click(btn('Tiếp tục', c2));
    await flush(6);
    expect(sent('POST', '/me/subscriptions/s1/status')[0]!.body).toEqual({ status: 'ACTIVE' });
  });

  it('"Hủy" mở sheet giữ chân; "Bỏ qua kỳ này" gọi POST /skip; "Vẫn hủy" gọi CANCELLED', async () => {
    const c = await mount();
    click(btn('Hủy', c));
    await flush(6);
    expect(document.body.textContent).toContain('Giữ lại lịch định kỳ?');
    click(btn('Bỏ qua kỳ này'));
    await flush(8);
    expect(sent('POST', '/me/subscriptions/s1/skip')).toHaveLength(1);
    expect(c.textContent).toContain('Đã bỏ qua kỳ này');
    expect(document.body.textContent).not.toContain('Giữ lại lịch định kỳ?');

    click(btn('Hủy', c));
    await flush(6);
    click(btn('Vẫn hủy'));
    await flush(8);
    expect(sent('POST', '/me/subscriptions/s1/status').pop()!.body).toEqual({ status: 'CANCELLED' });
  });

  it('gói đang tạm dừng thì sheet giữ chân không có "Bỏ qua kỳ này"', async () => {
    subs = [{ ...SUB, status: 'PAUSED' }];
    const c = await mount();
    click(btn('Hủy', c));
    await flush(6);
    expect(btn('Bỏ qua kỳ này')).toBeUndefined();
  });

  it('API từ chối đổi trạng thái → báo lỗi', async () => {
    failures['POST /me/subscriptions/s1/status'] = { status: 400, message: 'Không đổi được trạng thái' };
    const c = await mount();
    click(btn('Tạm dừng', c));
    await flush(6);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Không đổi được trạng thái');
  });

  it('lỗi tải → "Thử lại" gọi lại danh sách', async () => {
    listFailsOnce = true;
    const c = await mount();
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    click(btn('Thử lại', c));
    await flush(6);
    expect(c.textContent).toContain('Nước xả vải Tubu');
    expect(sent('GET', '/me/subscriptions')).toHaveLength(2);
  });

  it('chưa có lịch → trạng thái trống có lối "Khám phá sản phẩm" tới /san-pham', async () => {
    subs = [];
    const c = await mount();
    expect(c.textContent).toContain('Chưa có lịch đặt định kỳ');
    expect(Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Khám phá sản phẩm')?.getAttribute('href')).toBe('/san-pham');
  });

  it('hàng nút Sửa/Tạm dừng/Hủy có tên, vùng chạm >= 44px, xuống dòng khi thiếu chỗ', async () => {
    const c = await mount();
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(btn('Tạm dừng', c).parentElement?.className).toContain('flex-wrap');
  });
});

describe('subscriptionPatch', () => {
  const sub = { quantity: 2, addressId: 'a1', paymentMethod: 'COD' as const };
  it('chỉ gửi trường đã đổi; thiếu paymentMethod coi như COD', () => {
    expect(subscriptionPatch(sub, { quantity: 2, addressId: 'a1', paymentMethod: 'COD' })).toEqual({});
    expect(subscriptionPatch({ quantity: 2, addressId: 'a1' }, { quantity: 2, addressId: 'a1', paymentMethod: 'COD' })).toEqual({});
    expect(subscriptionPatch(sub, { quantity: 3, addressId: 'a2', paymentMethod: 'WALLET' })).toEqual({ quantity: 3, addressId: 'a2', paymentMethod: 'WALLET' });
    expect(subscriptionPatch(sub, { quantity: 2, addressId: undefined, paymentMethod: 'COD' })).toEqual({});
  });
});
