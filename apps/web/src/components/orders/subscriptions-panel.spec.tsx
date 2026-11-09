// @vitest-environment jsdom
import { act } from 'react';
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
let patchGate: Promise<void> | null = null;
let hangAddresses = false;
let addrGate: Promise<void> | null = null;
const ADDRESS_LOAD_ERROR_TEXT = 'Máy chủ đang bận, thử lại nhé.';

function stubApi() {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (hangAddresses && method === 'GET' && path === '/me/addresses') {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      if (method === 'GET' && path === '/me/addresses' && addrGate) await addrGate;
      if (method === 'PATCH' && patchGate) await patchGate;
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
  patchGate = null;
  hangAddresses = false;
  addrGate = null;
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

  it('TZ-01: nextRunAt = 00:00 VN (17:00Z hôm trước) hiện đúng ngày VN, không lùi một ngày', async () => {
    subs = [{ ...SUB, nextRunAt: '2026-11-10T17:00:00.000Z' }];
    const c = await mount();
    expect(c.textContent).toContain('Lần kế: 11/11/2026');
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

  describe('đổi chu kỳ giao (Q22)', () => {
    const SUB_Q22 = { ...SUB, nextRunAt: '2026-11-07T03:00:00.000Z', lastOrderAt: '2026-10-10T03:00:00.000Z' };
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T05:00:00.000Z') });
      subs = [SUB_Q22];
    });
    afterEach(() => vi.useRealTimers());

    it('có đúng 4 lựa chọn 4/6/8/10 tuần, chu kỳ hiện tại chọn sẵn', async () => {
      const c = await mount();
      click(btn('Sửa', c));
      await flush(6);
      const group = document.body.querySelector('[role="group"][aria-label="Chu kỳ giao"]')!;
      const opts = Array.from(group.querySelectorAll('button'));
      expect(opts.map((o) => o.textContent)).toEqual(['4 tuần', '6 tuần', '8 tuần', '10 tuần']);
      expect(opts[0]!.getAttribute('aria-pressed')).toBe('true');
    });

    it('chọn 6 tuần: hiện ngày giao kế trước khi lưu, PATCH chỉ có intervalWeeks', async () => {
      const c = await mount();
      click(btn('Sửa', c));
      await flush(6);
      expect(btn('Lưu thay đổi').disabled).toBe(true);
      click(btn('6 tuần'));
      expect(document.body.textContent).toContain('Lần giao kế tiếp: 21/11/2026');
      click(btn('Lưu thay đổi'));
      await flush(8);
      expect(sent('PATCH', '/me/subscriptions/s1')[0]!.body).toEqual({ intervalWeeks: 6 });
    });

    it('chọn lại chu kỳ cũ: hết thay đổi, nút lưu tắt, không hiện ngày mới', async () => {
      const c = await mount();
      click(btn('Sửa', c));
      await flush(6);
      click(btn('8 tuần'));
      click(btn('4 tuần'));
      expect(btn('Lưu thay đổi').disabled).toBe(true);
      expect(document.body.textContent).not.toContain('Lần giao kế tiếp');
    });

    it('gói tạm dừng: hiện ngày giao kế và lời nhắc ngày chỉ đổi khi đã qua lúc bật lại', async () => {
      subs = [{ ...SUB_Q22, status: 'PAUSED' }];
      const c = await mount();
      click(btn('Sửa', c));
      await flush(6);
      click(btn('10 tuần'));
      expect(document.body.textContent).toContain('Lần giao kế tiếp: 19/12/2026');
      expect(document.body.textContent).toContain('Gói đang tạm dừng: nếu đến lúc bật lại mà ngày này đã qua, ngày giao kế tiếp sẽ tính từ ngày bật lại.');
    });

    it('API cũ không có khoá lastOrderAt: không hiện chọn chu kỳ, không bao giờ gửi intervalWeeks', async () => {
      subs = [SUB];
      const c = await mount();
      click(btn('Sửa', c));
      await flush(6);
      expect(document.body.querySelector('[role="group"][aria-label="Chu kỳ giao"]')).toBeNull();
      expect(document.body.textContent).not.toContain('Chu kỳ giao');
      click(btn('Giảm số lượng'));
      click(btn('Lưu thay đổi'));
      await flush(8);
      expect(sent('PATCH', '/me/subscriptions/s1')[0]!.body).toEqual({ quantity: 1 });
    });

    it('API mới trả lastOrderAt là null (chưa có đơn kỳ): vẫn hiện chọn chu kỳ', async () => {
      subs = [{ ...SUB_Q22, lastOrderAt: null }];
      const c = await mount();
      click(btn('Sửa', c));
      await flush(6);
      expect(document.body.querySelector('[role="group"][aria-label="Chu kỳ giao"]')).not.toBeNull();
      click(btn('8 tuần'));
      click(btn('Lưu thay đổi'));
      await flush(8);
      expect(sent('PATCH', '/me/subscriptions/s1')[0]!.body).toEqual({ intervalWeeks: 8 });
    });
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

  it('"Huỷ" mở sheet giữ chân; "Bỏ qua kỳ này" gọi POST /skip; "Vẫn huỷ" gọi CANCELLED', async () => {
    const c = await mount();
    click(btn('Huỷ', c));
    await flush(6);
    expect(document.body.textContent).toContain('Giữ lại lịch định kỳ?');
    click(btn('Bỏ qua kỳ này'));
    await flush(8);
    expect(sent('POST', '/me/subscriptions/s1/skip')).toHaveLength(1);
    expect(c.textContent).toContain('Đã bỏ qua kỳ này');
    expect(document.body.textContent).not.toContain('Giữ lại lịch định kỳ?');

    click(btn('Huỷ', c));
    await flush(6);
    click(btn('Vẫn huỷ'));
    await flush(8);
    expect(sent('POST', '/me/subscriptions/s1/status').pop()!.body).toEqual({ status: 'CANCELLED' });
  });

  it('gói đang tạm dừng thì sheet giữ chân không có "Bỏ qua kỳ này"', async () => {
    subs = [{ ...SUB, status: 'PAUSED' }];
    const c = await mount();
    click(btn('Huỷ', c));
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

  it('hàng nút Sửa/Tạm dừng/Huỷ có tên, vùng chạm >= 44px, xuống dòng khi thiếu chỗ', async () => {
    const c = await mount();
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(btn('Tạm dừng', c).parentElement?.className).toContain('flex-wrap');
  });
});

describe('SubscriptionEditSheet (web): lỗi tải địa chỉ, khoá khi đang lưu, số đều (W61A)', () => {
  const SUB_NEW = { ...SUB, nextRunAt: '2026-11-07T03:00:00.000Z', lastOrderAt: '2026-10-10T03:00:00.000Z' };
  const sheetOpen = () => document.body.textContent?.includes('Sửa gói định kỳ') ?? false;
  const radios = () => Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  const chips = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Chu kỳ giao"] button'));
  const alertBox = () => document.body.querySelector('[role="alert"]');
  const openEditSheet = async () => {
    const c = await mount();
    click(btn('Sửa', c));
    await flush(6);
    return c;
  };
  const pressEscape = () =>
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

  beforeEach(() => {
    subs = [SUB_NEW];
  });
  afterEach(() => vi.useRealTimers());

  it('tải địa chỉ lỗi: vùng role=alert có lời lỗi + nút Thử lại, không vẽ nhóm địa chỉ trống; Thử lại tải lại và hiện danh sách', async () => {
    failures['GET /me/addresses'] = { status: 500, message: 'boom' };
    await openEditSheet();
    const loadsBefore = sent('GET', '/me/addresses').length;
    const alert = alertBox()!;
    expect(alert).not.toBeNull();
    expect(alert.querySelector('p')!.textContent).toBe(ADDRESS_LOAD_ERROR_TEXT);
    expect(alert.querySelector('p')!.textContent).not.toContain('chưa rõ đã xong chưa');
    expect(document.body.querySelector('[role="radiogroup"][aria-label="Giao tới"]')).toBeNull();
    expect(radio('Lê Lợi')).toBeNull();

    delete failures['GET /me/addresses'];
    click(btn('Thử lại', alert));
    await flush(8);
    expect(radio('9 Hai Bà Trưng')).not.toBeNull();
    expect(radio('1 Lê Lợi')!.checked).toBe(true);
    expect(alertBox()).toBeNull();
    expect(sent('GET', '/me/addresses')).toHaveLength(loadsBefore + 1);
  });

  it('bấm Thử lại: vùng lỗi và nút đứng yên (giữ focus, giữ chữ lỗi cũ), nút báo bận mà không bị disabled, bấm thêm không gửi thêm lượt tải, không có nhóm địa chỉ trống', async () => {
    failures['GET /me/addresses'] = { status: 500, message: 'boom' };
    await openEditSheet();
    const alert = alertBox()!;
    const retry = btn('Thử lại', alert);
    expect(retry.hasAttribute('aria-busy')).toBe(false);
    const loadsBefore = sent('GET', '/me/addresses').length;
    let release!: () => void;
    addrGate = new Promise<void>((r) => { release = r; });
    act(() => retry.focus());
    click(retry);
    await flush(3);
    expect(alertBox()).toBe(alert);
    expect(alert.querySelector('p')!.textContent).toBe(ADDRESS_LOAD_ERROR_TEXT);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(retry.disabled).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(document.body.querySelector('[role="radiogroup"][aria-label="Giao tới"]')).toBeNull();
    click(retry);
    await flush(2);
    expect(sent('GET', '/me/addresses')).toHaveLength(loadsBefore + 1);

    delete failures['GET /me/addresses'];
    release();
    await flush(8);
    expect(radio('9 Hai Bà Trưng')).not.toBeNull();
    expect(alertBox()).toBeNull();
  });

  it('Thử lại mà vẫn lỗi: vùng lỗi không chớp mất (cùng phần tử), nút hết bận và bấm thử tiếp được, rồi hiện danh sách khi qua', async () => {
    failures['GET /me/addresses'] = { status: 500, message: 'boom' };
    await openEditSheet();
    const alert = alertBox()!;
    const retry = btn('Thử lại', alert);
    const loadsBefore = sent('GET', '/me/addresses').length;
    click(retry);
    await flush(8);
    expect(sent('GET', '/me/addresses')).toHaveLength(loadsBefore + 1);
    expect(alertBox()).toBe(alert);
    expect(btn('Thử lại', alert)).toBe(retry);
    expect(retry.hasAttribute('aria-busy')).toBe(false);
    expect(alert.querySelector('p')!.textContent).toBe(ADDRESS_LOAD_ERROR_TEXT);
    expect(radios()).toHaveLength(3);

    delete failures['GET /me/addresses'];
    click(retry);
    await flush(8);
    expect(sent('GET', '/me/addresses')).toHaveLength(loadsBefore + 2);
    expect(radio('9 Hai Bà Trưng')).not.toBeNull();
    expect(alertBox()).toBeNull();
  });

  it('tải địa chỉ quá hạn: nói "tải chậm" (lời của màn tải), không nói "chưa rõ đã xong chưa" (lời của nút bấm)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hangAddresses = true;
    const r = render(<SubscriptionsPanel />);
    mounted.push(r);
    const tick = (ms = 0) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    for (let i = 0; i < 4; i++) await tick();
    click(btn('Sửa', r.container));
    await tick();
    await tick(20_000);
    for (let i = 0; i < 30; i++) await tick(100);
    const text = alertBox()!.querySelector('p')!.textContent;
    expect(text).toBe('Tải chậm quá, thử lại nhé.');
    expect(text).not.toContain('chưa rõ đã xong chưa');
  });

  it('đã có danh sách mà lần làm mới nền lỗi (mở lại sheet): vẫn hiện danh sách, không phủ bằng vùng lỗi', async () => {
    const c = await openEditSheet();
    expect(radio('9 Hai Bà Trưng')).not.toBeNull();
    click(btn('Đóng'));
    await flush(4);
    expect(sheetOpen()).toBe(false);
    const loadsBefore = sent('GET', '/me/addresses').length;
    failures['GET /me/addresses'] = { status: 500, message: 'boom' };
    click(btn('Sửa', c));
    await flush(8);
    expect(sent('GET', '/me/addresses')).toHaveLength(loadsBefore + 1);
    expect(radio('9 Hai Bà Trưng')).not.toBeNull();
    expect(alertBox()).toBeNull();
  });

  it('đang lưu: nút lưu aria-busy + disabled; số lượng, chu kỳ, cách trả, địa chỉ đều khoá và bấm không đổi lựa chọn', async () => {
    let release!: () => void;
    patchGate = new Promise<void>((r) => { release = r; });
    await openEditSheet();
    click(btn('Tăng số lượng'));
    await flush(2);
    click(btn('Lưu thay đổi'));
    await flush(3);
    const saving = btn('Đang lưu…');
    expect(saving.disabled).toBe(true);
    expect(saving.getAttribute('aria-busy')).toBe('true');
    expect(chips()).toHaveLength(4);
    chips().forEach((c) => expect(c.disabled).toBe(true));
    expect(radios()).toHaveLength(5);
    radios().forEach((r) => expect(r.disabled).toBe(true));
    expect(btn('Tăng số lượng').getAttribute('aria-disabled')).toBe('true');
    expect(btn('Giảm số lượng').getAttribute('aria-disabled')).toBe('true');

    click(btn('6 tuần'));
    click(radio('9 Hai Bà Trưng'));
    click(radio('Chuyển khoản ngân hàng'));
    click(btn('Tăng số lượng'));
    await flush(2);
    expect(chips()[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(chips()[1]!.getAttribute('aria-pressed')).toBe('false');
    expect(radio('1 Lê Lợi')!.checked).toBe(true);
    expect(radio('Thanh toán khi nhận hàng')!.checked).toBe(true);
    release();
    await flush(8);
    expect(sent('PATCH', '/me/subscriptions/s1')).toHaveLength(1);
    expect(sent('PATCH', '/me/subscriptions/s1')[0]!.body).toEqual({ quantity: 3 });
  });

  it('đang lưu: nút Đóng ẩn đi, phím Escape và bấm nền không đóng sheet giữa lúc PATCH đang bay; lưu xong mới đóng', async () => {
    let release!: () => void;
    patchGate = new Promise<void>((r) => { release = r; });
    await openEditSheet();
    click(btn('Tăng số lượng'));
    await flush(2);
    click(btn('Lưu thay đổi'));
    await flush(3);
    expect(btn('Đang lưu…')).toBeTruthy();
    expect(document.body.querySelector('button[aria-label="Đóng"]')).toBeNull();
    pressEscape();
    click(document.body.querySelector('[data-sheet-backdrop]'));
    await flush(2);
    expect(sheetOpen()).toBe(true);
    release();
    await flush(8);
    expect(sheetOpen()).toBe(false);
  });

  it('chưa lưu: nút Đóng và phím Escape vẫn đóng sheet như cũ', async () => {
    const c = await openEditSheet();
    click(btn('Đóng'));
    await flush(3);
    expect(sheetOpen()).toBe(false);
    click(btn('Sửa', c));
    await flush(6);
    expect(sheetOpen()).toBe(true);
    pressEscape();
    await flush(3);
    expect(sheetOpen()).toBe(false);
  });

  it('lưu lỗi: role=alert ngay trên nút lưu, nút hết bận, điều khiển mở lại, sheet không đóng', async () => {
    failures['PATCH /me/subscriptions/s1'] = { status: 409, message: 'Bạn đã có gói định kỳ cho sản phẩm này tại địa chỉ đó.' };
    await openEditSheet();
    click(radio('9 Hai Bà Trưng'));
    await flush(2);
    click(btn('Lưu thay đổi'));
    await flush(8);
    const alert = alertBox()!;
    expect(alert.textContent).toContain('Bạn đã có gói định kỳ cho sản phẩm này tại địa chỉ đó.');
    expect(alert.nextElementSibling).toBe(btn('Lưu thay đổi'));
    expect(btn('Lưu thay đổi').hasAttribute('aria-busy')).toBe(false);
    chips().forEach((c) => expect(c.disabled).toBe(false));
    radios().forEach((r) => expect(r.disabled).toBe(false));
    expect(sheetOpen()).toBe(true);
    click(btn('Đóng'));
    await flush(3);
    expect(sheetOpen()).toBe(false);
  });

  it('số đều: dòng ngày giao kế tiếp, hàng Ví Tubu kèm số dư và hàng địa chỉ kèm số điện thoại', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T05:00:00.000Z') });
    await openEditSheet();
    click(btn('6 tuần'));
    const nextRun = Array.from(document.body.querySelectorAll('p')).find((p) => p.textContent === 'Lần giao kế tiếp: 21/11/2026')!;
    expect(nextRun.className).toContain('tabular-nums');
    const row = (text: string) => radio(text)!.closest('label')!.querySelector('span')!;
    expect(row('Ví Tubu (50.000đ)').className).toContain('tabular-nums');
    expect(row('9 Hai Bà Trưng').className).toContain('tabular-nums');
    expect(row('9 Hai Bà Trưng').textContent).toContain('Lan · 0900000000');
  });
});

describe('subscriptionPatch', () => {
  const sub = { quantity: 2, addressId: 'a1', paymentMethod: 'COD' as const, intervalWeeks: 4 };
  const next = { quantity: 2, addressId: 'a1' as string | undefined, paymentMethod: 'COD' as const, intervalWeeks: 4 };
  it('chỉ gửi trường đã đổi; thiếu paymentMethod coi như COD', () => {
    expect(subscriptionPatch(sub, next)).toEqual({});
    expect(subscriptionPatch({ quantity: 2, addressId: 'a1', intervalWeeks: 4 }, next)).toEqual({});
    expect(subscriptionPatch(sub, { ...next, quantity: 3, addressId: 'a2', paymentMethod: 'WALLET' })).toEqual({ quantity: 3, addressId: 'a2', paymentMethod: 'WALLET' });
    expect(subscriptionPatch(sub, { ...next, addressId: undefined })).toEqual({});
  });
  it('gửi intervalWeeks chỉ khi đổi, cùng các trường khác', () => {
    expect(subscriptionPatch(sub, { ...next, intervalWeeks: 8 })).toEqual({ intervalWeeks: 8 });
    expect(subscriptionPatch(sub, { ...next, quantity: 3, intervalWeeks: 8 })).toEqual({ quantity: 3, intervalWeeks: 8 });
  });
});
