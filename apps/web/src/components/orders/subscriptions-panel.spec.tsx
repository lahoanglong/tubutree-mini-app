// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { SubscriptionsPanel } from './subscriptions-panel';
import { subscriptionPatch } from './subscription-edit-sheet';

// Mini App subscriptions-panel.spec.tsx: danh sách lịch, sửa (PATCH chỉ trường đổi), tạm dừng/tiếp tục, huỷ qua sheet giữ chân, bỏ kỳ.

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: 'authenticated', initialized: true, sessionUnavailable: false }) }));

// Bọc Sheet để đọc props mới nhất (open/dismissible/onClose): guard `onClose` của sheet giữ chân không có đường bấm nào chạm tới
// khi `dismissible=false` đã ẩn nút X, Esc và nền, nên chỉ gọi thẳng onClose mới chứng minh được nó.
const sheetSpy = vi.hoisted(() => ({
  calls: [] as Array<{ open: boolean; dismissible?: boolean; title?: string; onClose: () => void }>,
}));
vi.mock('@/components/ui/sheet', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui/sheet')>();
  return {
    ...orig,
    Sheet: (p: Parameters<typeof orig.Sheet>[0]) => {
      sheetSpy.calls.push(p);
      return <orig.Sheet {...p} />;
    },
  };
});

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
let gates: Record<string, Promise<void>> = {};
/** Giữ request `METHOD /path` đang bay (mutation ở trạng thái pending) tới khi gọi hàm trả về. */
function hold(key: string) {
  let release!: () => void;
  gates[key] = new Promise<void>((r) => {
    release = r;
  });
  return release;
}
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
      await gates[`${method} ${path}`];
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
  gates = {};
  sheetSpy.calls.length = 0;
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

  it('W140: gói tạm dừng nói rõ lý do và cách chạy lại; không biết lý do (dừng từ trước, mã lạ) chỉ có dòng chung; gói đang chạy không có dòng lý do', async () => {
    subs = [
      { ...SUB, id: 's1', status: 'PAUSED', pausedReason: 'insufficient_wallet' },
      { ...SUB, id: 's2', status: 'PAUSED', pausedReason: null },
      { ...SUB, id: 's3', status: 'PAUSED', pausedReason: 'mã_lạ_của_api_mới' },
      { ...SUB, id: 's4', status: 'ACTIVE', pausedReason: 'customer' },
      { ...SUB, id: 's5', status: 'PAUSED', pausedReason: 'customer' },
    ];
    const c = await mount();
    const cards = [...c.querySelectorAll('li')];
    expect(cards).toHaveLength(5);
    expect(cards[0]!.textContent).toContain('Ví Tubu chưa đủ tiền cho kỳ này');
    expect(cards[0]!.textContent).toContain('bấm Sửa để đổi cách thanh toán, rồi bấm Tiếp tục.');
    for (const i of [1, 2]) {
      expect(cards[i]!.textContent).toContain('Đang tạm dừng');
      expect(cards[i]!.textContent).not.toContain('Bấm Sửa');
      expect(cards[i]!.textContent).not.toContain('Ví Tubu chưa đủ tiền');
    }
    expect(cards[3]!.textContent).toContain('Lần kế:');
    expect(cards[3]!.textContent).not.toContain('Bạn đã tạm dừng');
    expect(cards[4]!.textContent).toContain('Bạn đã tạm dừng gói này');
    expect(cards[4]!.textContent).toContain('Bấm Tiếp tục khi muốn Tubu giao lại.');
  });

  it('W140: danh sách gói là lưới 1 cột ở điện thoại, 2 cột từ md để thẻ không dãn hết khung desktop', async () => {
    const c = await mount();
    const ul = c.querySelector('ul')!;
    expect(ul.className).toContain('grid-cols-1');
    expect(ul.className).toContain('md:grid-cols-2');
    expect(ul.className).toContain('md:items-start');
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

describe('SubscriptionsPanel: khoá chéo statusMut ↔ skipMut, chặn đóng sheet, nút thẻ đang bận', () => {
  const RETENTION_TITLE = 'Giữ lại lịch định kỳ?';
  const SKIP = 'POST /me/subscriptions/s1/skip';
  const STATUS = 'POST /me/subscriptions/s1/status';
  const sheetEl = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
  const retentionSheet = () => sheetSpy.calls.filter((c) => c.title === RETENTION_TITLE).at(-1)!;
  const cards = (c: HTMLElement) => Array.from(c.querySelectorAll('li'));
  /** Ba nút của thẻ theo thứ tự hiển thị: Sửa, Tạm dừng/Tiếp tục, Huỷ. */
  const cardBtns = (li: Element) => Array.from(li.querySelectorAll('button')) as HTMLButtonElement[];
  const tryClose = () => act(() => retentionSheet().onClose());
  const escape = () => act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  const aria = (b: HTMLElement, name: string) => b.getAttribute(name);
  async function openRetention(c: HTMLElement) {
    click(btn('Huỷ', c));
    await flush(6);
    expect(sheetEl()?.textContent).toContain(RETENTION_TITLE);
  }

  it('skipMut đang chạy: "Tạm dừng" + "Vẫn huỷ" + 3 nút thẻ nền khoá; "Bỏ qua kỳ này" giữ focus (aria-busy, không disabled DOM)', async () => {
    const release = hold(SKIP);
    const c = await mount();
    await openRetention(c);
    click(btn('Bỏ qua kỳ này', sheetEl()!));
    await flush(3);

    const skip = btn('Đang xử lý…', sheetEl()!);
    expect(skip).toBeDefined();
    expect(aria(skip, 'aria-busy')).toBe('true');
    expect(aria(skip, 'aria-disabled')).toBe('true');
    expect(skip.disabled).toBe(false);
    expect(btn('Tạm dừng', sheetEl()!).disabled).toBe(true);
    expect(btn('Vẫn huỷ', sheetEl()!).disabled).toBe(true);
    // "Sửa"/"Huỷ" của thẻ khoá bằng aria-disabled (đang là nút mở sheet, giữ focus khi sheet đóng); "Tạm dừng" của thẻ khoá thật.
    expect(cardBtns(cards(c)[0]!).map((b) => b.disabled)).toEqual([false, true, false]);
    expect(cardBtns(cards(c)[0]!).map((b) => aria(b, 'aria-disabled'))).toEqual(['true', null, 'true']);

    // bấm lại / bấm nút kia: không phát sinh lời gọi API thứ hai
    click(skip);
    click(btn('Tạm dừng', sheetEl()!));
    click(btn('Vẫn huỷ', sheetEl()!));
    await flush(2);
    expect(sent('POST', '/me/subscriptions/s1/skip')).toHaveLength(1);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(0);

    release();
    await flush(8);
    expect(c.textContent).toContain('Đã bỏ qua kỳ này');
    expect(sheetEl()).toBeNull();
  });

  it('skipMut đang chạy: sheet không đóng được (không nút X, Esc, nền, onClose đều bị chặn) cho tới khi xong', async () => {
    const release = hold(SKIP);
    const c = await mount();
    await openRetention(c);
    expect(retentionSheet().dismissible).toBe(true);
    expect(btn('Đóng', sheetEl()!)).toBeDefined();

    click(btn('Bỏ qua kỳ này', sheetEl()!));
    await flush(3);
    expect(retentionSheet().dismissible).toBe(false);
    expect(btn('Đóng', sheetEl()!)).toBeUndefined();
    tryClose();
    escape();
    click(document.querySelector('[data-sheet-backdrop]'));
    await flush(2);
    expect(retentionSheet().open).toBe(true);
    expect(sheetEl()?.textContent).toContain(RETENTION_TITLE);

    release();
    await flush(8);
    expect(retentionSheet().open).toBe(false);
    expect(sheetEl()).toBeNull();
  });

  it('skipMut lỗi: báo lỗi trong sheet, mở khoá lại cả sheet, đóng được', async () => {
    const release = hold(SKIP);
    failures[SKIP] = { status: 400, message: 'Không bỏ qua được kỳ này' };
    const c = await mount();
    await openRetention(c);
    click(btn('Bỏ qua kỳ này', sheetEl()!));
    await flush(3);
    expect(btn('Tạm dừng', sheetEl()!).disabled).toBe(true);
    release();
    await flush(8);

    expect(sheetEl()?.querySelector('[role="alert"]')?.textContent).toContain('Không bỏ qua được kỳ này');
    expect(btn('Tạm dừng', sheetEl()!).disabled).toBe(false);
    expect(btn('Vẫn huỷ', sheetEl()!).disabled).toBe(false);
    const skip = btn('Bỏ qua kỳ này', sheetEl()!);
    expect(skip.disabled).toBe(false);
    expect(skip.hasAttribute('aria-busy')).toBe(false);
    expect(skip.hasAttribute('aria-disabled')).toBe(false);
    expect(retentionSheet().dismissible).toBe(true);
    tryClose();
    await flush(2);
    expect(retentionSheet().open).toBe(false);
  });

  it('statusMut đang chạy từ "Tạm dừng" trong sheet: nút đó giữ focus (aria-busy); "Bỏ qua kỳ này", "Vẫn huỷ", thẻ nền khoá; không đóng được', async () => {
    const release = hold(STATUS);
    const c = await mount();
    await openRetention(c);
    click(btn('Tạm dừng', sheetEl()!));
    await flush(3);

    const pause = btn('Đang xử lý…', sheetEl()!);
    expect(aria(pause, 'aria-busy')).toBe('true');
    expect(aria(pause, 'aria-disabled')).toBe('true');
    expect(pause.disabled).toBe(false);
    expect(btn('Bỏ qua kỳ này', sheetEl()!).disabled).toBe(true);
    expect(btn('Vẫn huỷ', sheetEl()!).disabled).toBe(true);
    const [edit, toggle, cancel] = cardBtns(cards(c)[0]!);
    expect([edit!.disabled, toggle!.disabled, cancel!.disabled]).toEqual([false, true, false]);
    expect([aria(edit!, 'aria-disabled'), aria(cancel!, 'aria-disabled')]).toEqual(['true', 'true']);
    // sheet đang mở nên thẻ nền không giả vờ là nơi đang xoay
    expect(toggle!.textContent).toBe('Tạm dừng');
    expect(toggle!.hasAttribute('aria-busy')).toBe(false);

    expect(retentionSheet().dismissible).toBe(false);
    tryClose();
    escape();
    expect(retentionSheet().open).toBe(true);

    click(pause);
    click(btn('Bỏ qua kỳ này', sheetEl()!));
    click(btn('Vẫn huỷ', sheetEl()!));
    await flush(2);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(sent('POST', '/me/subscriptions/s1/status')[0]!.body).toEqual({ status: 'PAUSED' });
    expect(sent('POST', '/me/subscriptions/s1/skip')).toHaveLength(0);

    release();
    await flush(8);
    expect(retentionSheet().open).toBe(false);
    expect(sheetEl()).toBeNull();
  });

  it('statusMut đang chạy từ "Vẫn huỷ": nút đó giữ focus; "Tạm dừng" + "Bỏ qua kỳ này" khoá; onClose không đóng được', async () => {
    const release = hold(STATUS);
    const c = await mount();
    await openRetention(c);
    click(btn('Vẫn huỷ', sheetEl()!));
    await flush(3);

    const cancel = btn('Đang xử lý…', sheetEl()!);
    expect(aria(cancel, 'aria-busy')).toBe('true');
    expect(aria(cancel, 'aria-disabled')).toBe('true');
    expect(cancel.disabled).toBe(false);
    expect(btn('Tạm dừng', sheetEl()!).disabled).toBe(true);
    expect(btn('Bỏ qua kỳ này', sheetEl()!).disabled).toBe(true);
    tryClose();
    expect(retentionSheet().open).toBe(true);
    click(btn('Tạm dừng', sheetEl()!));
    await flush(2);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(sent('POST', '/me/subscriptions/s1/status')[0]!.body).toEqual({ status: 'CANCELLED' });

    release();
    await flush(8);
    expect(retentionSheet().open).toBe(false);
  });

  it('bấm "Tạm dừng" ngay trên thẻ: chỉ nút đó hiện "Đang xử lý…" + aria-busy (còn bấm được DOM); Sửa/Huỷ và thẻ khác khoá', async () => {
    const release = hold(STATUS);
    subs = [SUB, { ...SUB, id: 's2' }];
    const c = await mount();
    click(cardBtns(cards(c)[0]!)[1]!);
    await flush(3);

    const [first, second] = cards(c).map(cardBtns) as [HTMLButtonElement[], HTMLButtonElement[]];
    expect(first[1]!.textContent).toBe('Đang xử lý…');
    expect(aria(first[1]!, 'aria-busy')).toBe('true');
    expect(aria(first[1]!, 'aria-disabled')).toBe('true');
    expect(first[1]!.disabled).toBe(false);
    expect(second[1]!.textContent).toBe('Tạm dừng');
    expect(second[1]!.disabled).toBe(true);
    expect(second[1]!.hasAttribute('aria-busy')).toBe(false);
    expect([first[0]!.disabled, first[2]!.disabled, second[0]!.disabled, second[2]!.disabled]).toEqual([false, false, false, false]);
    expect([first[0]!, first[2]!, second[0]!, second[2]!].map((b) => aria(b, 'aria-disabled'))).toEqual(['true', 'true', 'true', 'true']);
    expect(sheetEl()).toBeNull();

    click(first[1]!);
    click(second[1]!);
    await flush(2);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(sent('POST', '/me/subscriptions/s2/status')).toHaveLength(0);

    release();
    await flush(8);
    const [after] = cards(c).map(cardBtns) as [HTMLButtonElement[]];
    expect(after.map((b) => b.disabled)).toEqual([false, false, false]);
    expect(after.map((b) => b.hasAttribute('aria-disabled'))).toEqual([false, false, false]);
    expect(after[1]!.textContent).toBe('Tạm dừng');
    expect(after[1]!.hasAttribute('aria-busy')).toBe(false);
  });

  it('"Tiếp tục" ở gói đang dừng cũng hiện "Đang xử lý…"; lỗi thì nhả khoá, trả nhãn cũ và báo lỗi', async () => {
    const release = hold(STATUS);
    failures[STATUS] = { status: 400, message: 'Không đổi được trạng thái' };
    subs = [{ ...SUB, status: 'PAUSED' }];
    const c = await mount();
    click(cardBtns(cards(c)[0]!)[1]!);
    await flush(3);
    expect(cardBtns(cards(c)[0]!)[1]!.textContent).toBe('Đang xử lý…');
    expect(aria(cardBtns(cards(c)[0]!)[1]!, 'aria-busy')).toBe('true');
    expect(cardBtns(cards(c)[0]!).map((b) => b.disabled)).toEqual([false, false, false]);
    expect(cardBtns(cards(c)[0]!).map((b) => aria(b, 'aria-disabled'))).toEqual(['true', 'true', 'true']);

    release();
    await flush(8);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Không đổi được trạng thái');
    const [edit, toggle, cancel] = cardBtns(cards(c)[0]!);
    expect(toggle!.textContent).toBe('Tiếp tục');
    expect([edit!.disabled, toggle!.disabled, cancel!.disabled]).toEqual([false, false, false]);
    expect(toggle!.hasAttribute('aria-busy')).toBe(false);
  });

  it('số tiền / % / số lượng / ngày dùng số đều (tabular-nums)', async () => {
    const c = await mount();
    const leaf = (text: string) =>
      Array.from(c.querySelectorAll('p, div, s, span')).find((e) => e.childElementCount === 0 && e.textContent === text) as HTMLElement;
    const intro = Array.from(c.querySelectorAll('p')).find((p) => p.textContent?.includes('tiết kiệm 14% mỗi đơn')) as HTMLElement;
    const lines = [
      intro,
      leaf('Đang giảm 14% cho đơn định kỳ'),
      leaf('Hương sả · SL 2'),
      leaf('Mỗi 4 tuần · 137.600đ'),
      leaf('160.000đ'),
      leaf('Tiết kiệm 14%'),
      leaf('Lần kế: 15/10/2026'),
    ];
    lines.forEach((el, i) => {
      expect(el, `dòng số ${i}`).toBeDefined();
      expect(el.classList.contains('tabular-nums'), el.textContent ?? '').toBe(true);
    });
    expect(leaf('160.000đ').tagName).toBe('S');
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

  it('đang lưu: nút lưu aria-busy + aria-disabled (giữ focus, không disabled DOM); số lượng, chu kỳ, cách trả, địa chỉ đều khoá và bấm không đổi lựa chọn', async () => {
    let release!: () => void;
    patchGate = new Promise<void>((r) => { release = r; });
    await openEditSheet();
    click(btn('Tăng số lượng'));
    await flush(2);
    click(btn('Lưu thay đổi'));
    await flush(3);
    const saving = btn('Đang lưu…');
    expect(saving.disabled).toBe(false);
    expect(saving.getAttribute('aria-disabled')).toBe('true');
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

describe('SubscriptionsPanel: khoá đồng bộ chạm đúp, một việc mỗi lúc trên mọi gói (W78B)', () => {
  const RETENTION_TITLE = 'Giữ lại lịch định kỳ?';
  const STATUS = 'POST /me/subscriptions/s1/status';
  const SKIP = 'POST /me/subscriptions/s1/skip';
  const LIST = 'GET /me/subscriptions';
  const sheetEl = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
  const retentionSheet = () => sheetSpy.calls.filter((c) => c.title === RETENTION_TITLE).at(-1)!;
  const cards = (c: HTMLElement) => Array.from(c.querySelectorAll('li'));
  const cardBtns = (li: Element) => Array.from(li.querySelectorAll('button')) as HTMLButtonElement[];
  const inSheet = (label: string) => btn(label, sheetEl()!);
  const listCalls = () => sent('GET', '/me/subscriptions');
  const aria = (b: HTMLElement, name: string) => b.getAttribute(name);
  // Hai cú bấm trong cùng một `act`: React chưa kịp vẽ lại giữa chúng nên `isPending` còn cũ, chỉ ref đồng bộ mới chặn được.
  const together = (...els: HTMLElement[]) =>
    act(() => {
      for (const el of els) el.click();
    });
  async function openRetention(c: HTMLElement) {
    click(btn('Huỷ', c));
    await flush(6);
    expect(sheetEl()?.textContent).toContain(RETENTION_TITLE);
  }

  it('chạm đúp "Tạm dừng" trên thẻ trong một khung hình: chỉ một lệnh; xong thì tải lại danh sách một lần', async () => {
    const release = hold(STATUS);
    const c = await mount();
    const pause = cardBtns(cards(c)[0]!)[1]!;
    together(pause, pause);
    await flush(3);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(sent('POST', '/me/subscriptions/s1/status')[0]!.body).toEqual({ status: 'PAUSED' });
    const before = listCalls().length;
    release();
    await flush(8);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(listCalls().length).toBe(before + 1);
  });

  it('"Tiếp tục" ở gói đang dừng chạm đúp trong một khung hình: chỉ một lệnh ACTIVE', async () => {
    subs = [{ ...SUB, status: 'PAUSED' }];
    const release = hold(STATUS);
    const c = await mount();
    const resume = cardBtns(cards(c)[0]!)[1]!;
    expect(resume.textContent).toBe('Tiếp tục');
    together(resume, resume);
    await flush(3);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(sent('POST', '/me/subscriptions/s1/status')[0]!.body).toEqual({ status: 'ACTIVE' });
    release();
    await flush(8);
  });

  it('hai thẻ khác nhau, "Tạm dừng" cả hai trong một khung hình: chỉ gói đầu được gửi (một việc mỗi lúc)', async () => {
    subs = [SUB, { ...SUB, id: 's2' }];
    const release = hold(STATUS);
    const c = await mount();
    const [first, second] = cards(c).map((li) => cardBtns(li)[1]!) as [HTMLButtonElement, HTMLButtonElement];
    together(first, second);
    await flush(3);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(sent('POST', '/me/subscriptions/s2/status')).toHaveLength(0);
    release();
    await flush(8);
  });

  it('lệnh xong nhưng danh sách mới chưa về: nút thẻ vẫn khoá và báo bận, bấm thêm không gửi lệnh; danh sách về thì mở khoá và gửi lại được', async () => {
    const c = await mount();
    const releaseList = hold(LIST);
    const pause = () => cardBtns(cards(c)[0]!)[1]!;
    click(pause());
    await flush(6);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(pause().getAttribute('aria-busy')).toBe('true');
    expect(pause().textContent).toBe('Đang xử lý…');
    click(pause());
    await flush(3);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    releaseList();
    await flush(8);
    expect(pause().hasAttribute('aria-busy')).toBe(false);
    click(pause());
    await flush(6);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(2);
  });

  it('lệnh lỗi nhả khoá: bấm lại gửi lệnh lần hai', async () => {
    failures[STATUS] = { status: 400, message: 'Không đổi được trạng thái' };
    const c = await mount();
    click(cardBtns(cards(c)[0]!)[1]!);
    await flush(8);
    expect(c.textContent).toContain('Không đổi được trạng thái');
    click(cardBtns(cards(c)[0]!)[1]!);
    await flush(8);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(2);
  });

  it('chạm đúp "Vẫn huỷ" trong sheet cùng khung hình: một lệnh CANCELLED; sheet đóng ngay khi lệnh xong dù danh sách còn đang tải lại', async () => {
    const c = await mount();
    await openRetention(c);
    const confirm = inSheet('Vẫn huỷ');
    const releaseList = hold(LIST);
    together(confirm, confirm);
    await flush(6);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(sent('POST', '/me/subscriptions/s1/status')[0]!.body).toEqual({ status: 'CANCELLED' });
    expect(retentionSheet().open).toBe(false);
    expect(sheetEl()).toBeNull();
    releaseList();
    await flush(8);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
  });

  it('chạm đúp "Bỏ qua kỳ này" cùng khung hình: một lệnh skip, báo thành công một lần, sheet đóng', async () => {
    const c = await mount();
    await openRetention(c);
    const skip = inSheet('Bỏ qua kỳ này');
    together(skip, skip);
    await flush(8);
    expect(sent('POST', '/me/subscriptions/s1/skip')).toHaveLength(1);
    expect(c.textContent?.match(/Đã bỏ qua kỳ này/g)).toHaveLength(1);
    expect(sheetEl()).toBeNull();
  });

  it.each([
    ['"Tạm dừng" rồi "Vẫn huỷ"', 'Tạm dừng', 'Vẫn huỷ', 'PAUSED'],
    ['"Vẫn huỷ" rồi "Tạm dừng"', 'Vẫn huỷ', 'Tạm dừng', 'CANCELLED'],
  ] as const)('hai nút khác nhau trong sheet, %s cùng khung hình: chỉ lệnh đầu gọi API, sheet đóng khi lệnh đầu xong', async (_label, first, second, status) => {
    const release = hold(STATUS);
    const c = await mount();
    await openRetention(c);
    together(inSheet(first), inSheet(second));
    await flush(3);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(sent('POST', '/me/subscriptions/s1/status')[0]!.body).toEqual({ status });
    expect(sent('POST', '/me/subscriptions/s1/skip')).toHaveLength(0);
    release();
    await flush(8);
    expect(sheetEl()).toBeNull();
  });

  it.each([
    ['"Bỏ qua kỳ này" rồi "Vẫn huỷ"', 'Bỏ qua kỳ này', 'Vẫn huỷ'],
    ['"Bỏ qua kỳ này" rồi "Tạm dừng"', 'Bỏ qua kỳ này', 'Tạm dừng'],
    ['"Vẫn huỷ" rồi "Bỏ qua kỳ này"', 'Vẫn huỷ', 'Bỏ qua kỳ này'],
  ] as const)('khoá chéo hai lệnh khác loại, %s cùng khung hình: chỉ lệnh đầu gọi API', async (_label, first, second) => {
    const releaseSkip = hold(SKIP);
    const releaseStatus = hold(STATUS);
    const c = await mount();
    await openRetention(c);
    together(inSheet(first), inSheet(second));
    await flush(3);
    const skipFirst = first === 'Bỏ qua kỳ này';
    expect(sent('POST', '/me/subscriptions/s1/skip')).toHaveLength(skipFirst ? 1 : 0);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(skipFirst ? 0 : 1);
    releaseSkip();
    releaseStatus();
    await flush(8);
  });

  it('skip lỗi nhả khoá chung: sau đó "Vẫn huỷ" gọi được và sheet đóng', async () => {
    failures[SKIP] = { status: 400, message: 'Không bỏ qua được kỳ này' };
    const c = await mount();
    await openRetention(c);
    click(inSheet('Bỏ qua kỳ này'));
    await flush(8);
    expect(sheetEl()?.querySelector('[role="alert"]')?.textContent).toContain('Không bỏ qua được kỳ này');
    click(inSheet('Vẫn huỷ'));
    await flush(8);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(sheetEl()).toBeNull();
  });

  it('lời báo "Đã bỏ qua kỳ này" của lệnh trước biến mất ngay khi một lệnh mới bắt đầu, không chờ máy chủ trả lời', async () => {
    const c = await mount();
    await openRetention(c);
    click(inSheet('Bỏ qua kỳ này'));
    await flush(8);
    expect(c.textContent).toContain('Đã bỏ qua kỳ này');
    const release = hold(STATUS);
    click(btn('Tạm dừng', c));
    await flush(2);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(c.textContent).not.toContain('Đã bỏ qua kỳ này');
    release();
    await flush(8);
  });

  it('lệnh gửi từ sheet xong mà danh sách mới còn treo: sheet đóng, focus về đúng nút "Huỷ" của thẻ (không rơi về body), thẻ không giả vờ đang xoay', async () => {
    const c = await mount();
    const [edit, toggle, cancel] = cardBtns(cards(c)[0]!) as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    click(cancel);
    await flush(6);
    expect(sheetEl()?.textContent).toContain(RETENTION_TITLE);
    const releaseList = hold(LIST);
    click(inSheet('Tạm dừng'));
    await flush(8);
    expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
    expect(sheetEl()).toBeNull();
    // Danh sách mới chưa về nên lệnh còn isPending và các nút thẻ còn khoá, nhưng bằng aria-disabled để nút mở sheet nhận lại được focus.
    expect(document.activeElement).toBe(cancel);
    expect(cancel.disabled).toBe(false);
    expect([aria(edit, 'aria-disabled'), aria(cancel, 'aria-disabled')]).toEqual(['true', 'true']);
    expect(toggle.textContent).toBe('Tạm dừng');
    expect(toggle.hasAttribute('aria-busy')).toBe(false);

    releaseList();
    await flush(8);
    expect(cancel.hasAttribute('aria-disabled')).toBe(false);
    expect(toggle.hasAttribute('aria-disabled')).toBe(false);
  });

  it('đang có lệnh chờ danh sách mới: bấm "Sửa" hoặc "Huỷ" trên thẻ không mở sheet nào (aria-disabled không tự chặn, phải có guard)', async () => {
    const c = await mount();
    const releaseList = hold(LIST);
    click(cardBtns(cards(c)[0]!)[1]!);
    await flush(3);
    const [edit, , cancel] = cardBtns(cards(c)[0]!);
    click(edit!);
    click(cancel!);
    await flush(4);
    expect(sheetEl()).toBeNull();
    releaseList();
    await flush(8);
  });

  it('"Thử lại" ở lỗi tải danh sách trả refetch: chạm đúp cùng khung hình chỉ tải lại một lần, nút báo bận tới khi xong', async () => {
    listFailsOnce = true;
    const c = await mount();
    const releaseList = hold(LIST);
    const before = listCalls().length;
    const retry = btn('Thử lại', c);
    together(retry, retry);
    await flush(3);
    expect(listCalls().length).toBe(before + 1);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    releaseList();
    await flush(8);
    expect(c.textContent).toContain('Nước xả vải Tubu');
    expect(listCalls().length).toBe(before + 1);
  });
});

describe('SubscriptionEditSheet (web): khoá đồng bộ chạm đúp (W78B)', () => {
  const SUB_NEW = { ...SUB, nextRunAt: '2026-11-07T03:00:00.000Z', lastOrderAt: '2026-10-10T03:00:00.000Z' };
  const openEditSheet = async () => {
    const c = await mount();
    click(btn('Sửa', c));
    await flush(6);
    click(btn('Tăng số lượng'));
    await flush(2);
    return c;
  };

  beforeEach(() => {
    subs = [SUB_NEW];
  });

  it('chạm đúp "Lưu thay đổi" trong một khung hình: một PATCH, một lần báo, sheet đóng một lần', async () => {
    let release!: () => void;
    patchGate = new Promise<void>((r) => { release = r; });
    const c = await openEditSheet();
    const save = btn('Lưu thay đổi');
    act(() => {
      save.click();
      save.click();
    });
    await flush(3);
    expect(sent('PATCH', '/me/subscriptions/s1')).toHaveLength(1);
    release();
    await flush(8);
    expect(sent('PATCH', '/me/subscriptions/s1')).toHaveLength(1);
    expect(c.textContent?.match(/Đã cập nhật gói định kỳ/g)).toHaveLength(1);
    expect(document.body.textContent).not.toContain('Sửa gói định kỳ');
  });

  it('lưu lỗi nhả khoá: bấm lại gửi PATCH lần hai', async () => {
    failures['PATCH /me/subscriptions/s1'] = { status: 409, message: 'Trùng gói' };
    await openEditSheet();
    click(btn('Lưu thay đổi'));
    await flush(8);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Trùng gói');
    click(btn('Lưu thay đổi'));
    await flush(8);
    expect(sent('PATCH', '/me/subscriptions/s1')).toHaveLength(2);
  });
});

describe('SubscriptionsPanel: khoá giữ tới khi danh sách làm mới về, có hạn 4 giây (W83B)', () => {
  const RETENTION_TITLE = 'Giữ lại lịch định kỳ?';
  const LIST = 'GET /me/subscriptions';
  const sheetEl = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
  const cardBtns = () => Array.from(document.querySelector('li')!.querySelectorAll('button')) as HTMLButtonElement[];
  const together = (...els: HTMLElement[]) =>
    act(() => {
      for (const el of els) el.click();
    });
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  async function openRetention(c: HTMLElement) {
    click(btn('Huỷ', c));
    await flush(6);
    expect(sheetEl()?.textContent).toContain(RETENTION_TITLE);
  }

  describe('danh sách không bao giờ về', () => {
    beforeEach(() => {
      // shouldAdvanceTime để `flush` (setTimeout 0) và bộ đếm giờ của react-query vẫn chạy; chỉ cần giả setTimeout để tua tới hạn.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    });
    afterEach(() => vi.useRealTimers());

    it('"Tạm dừng" trên thẻ: còn khoá ở 3 giây (bấm thêm không gửi lệnh), nhả sau 4 giây dù danh sách chưa về', async () => {
      const c = await mount();
      hold(LIST);
      click(cardBtns()[1]!);
      await flush(6);
      expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
      await advance(3_000);
      expect(cardBtns()[1]!.getAttribute('aria-busy')).toBe('true');
      together(cardBtns()[1]!, cardBtns()[1]!);
      expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
      await advance(1_500);
      await flush(4);
      expect(cardBtns()[1]!.hasAttribute('aria-busy')).toBe(false);
      expect(c.textContent).toContain('Nước xả vải Tubu');
      click(cardBtns()[1]!);
      await flush(6);
      expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(2);
    });

    it('"Vẫn huỷ" trong sheet: sheet đóng ngay, nút thẻ còn khoá ở 3 giây, nhả sau 4 giây', async () => {
      const c = await mount();
      await openRetention(c);
      hold(LIST);
      click(btn('Vẫn huỷ', sheetEl()!));
      await flush(6);
      expect(sent('POST', '/me/subscriptions/s1/status')).toHaveLength(1);
      expect(sheetEl()).toBeNull();
      await advance(3_000);
      expect(cardBtns()[2]!.getAttribute('aria-disabled')).toBe('true');
      await advance(1_500);
      await flush(4);
      expect(cardBtns()[2]!.hasAttribute('aria-disabled')).toBe(false);
    });

    it('"Bỏ qua kỳ này": nút thẻ còn khoá ở 3 giây, nhả sau 4 giây', async () => {
      const c = await mount();
      await openRetention(c);
      hold(LIST);
      click(btn('Bỏ qua kỳ này', sheetEl()!));
      await flush(6);
      expect(sent('POST', '/me/subscriptions/s1/skip')).toHaveLength(1);
      await advance(3_000);
      expect(cardBtns()[2]!.getAttribute('aria-disabled')).toBe('true');
      await advance(1_500);
      await flush(4);
      expect(cardBtns()[2]!.hasAttribute('aria-disabled')).toBe(false);
    });
  });

  it('lưu ở sheet "Sửa" xong mà danh sách chưa về: "Sửa" không mở lại sheet trên số liệu cũ; danh sách về thì mở với số lượng MỚI', async () => {
    const c = await mount();
    const edit = btn('Sửa', c);
    click(edit);
    await flush(6);
    const qty = () => btn('Giảm số lượng').nextElementSibling?.textContent;
    expect(qty()).toBe('2');
    click(btn('Tăng số lượng'));
    await flush(2);
    const releaseList = hold(LIST);
    click(btn('Lưu thay đổi'));
    await flush(8);
    expect(sent('PATCH', '/me/subscriptions/s1')[0]!.body).toEqual({ quantity: 3 });
    expect(document.body.textContent).not.toContain('Sửa gói định kỳ');
    expect(edit.getAttribute('aria-disabled')).toBe('true');
    expect(edit.disabled).toBe(false);
    click(edit);
    await flush(4);
    expect(document.body.textContent).not.toContain('Sửa gói định kỳ');
    subs = [{ ...SUB, quantity: 3 }];
    releaseList();
    await flush(8);
    expect(edit.hasAttribute('aria-disabled')).toBe(false);
    click(edit);
    await flush(6);
    expect(qty()).toBe('3');
  });

  describe('"Thử lại" danh sách (truy vấn ĐÃ có dữ liệu rồi mới lỗi)', () => {
    // Truy vấn chưa có dữ liệu thì react-query gộp hai lần refetch làm một, nên chỉ ca còn dữ liệu cũ mà lần làm mới lỗi mới chứng minh được khoá của nút
    // (refetch thứ hai sẽ huỷ rồi chạy lại).
    async function mountThenRefreshError() {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const r = render(<SubscriptionsPanel />, qc);
      mounted.push(r);
      await flush(8);
      expect(r.container.textContent).toContain('Nước xả vải Tubu');
      listFailsOnce = true;
      await act(async () => {
        await qc.invalidateQueries({ queryKey: ['subscriptions'] });
      });
      await flush(2);
      const retry = btn('Thử lại', r.container);
      expect(retry).toBeTruthy();
      return { c: r.container, retry };
    }

    it('chạm đúp trong cùng một khung hình chỉ tải lại một lần; nút báo bận tới khi danh sách về', async () => {
      const { c, retry } = await mountThenRefreshError();
      const releaseList = hold(LIST);
      const before = sent('GET', '/me/subscriptions').length;
      together(retry, retry);
      await flush(3);
      expect(sent('GET', '/me/subscriptions').length - before).toBe(1);
      expect(retry.getAttribute('aria-busy')).toBe('true');
      releaseList();
      await flush(8);
      expect(c.textContent).toContain('Nước xả vải Tubu');
      expect(sent('GET', '/me/subscriptions').length - before).toBe(1);
    });

    it('hai cú chạm ở hai lần act liên tiếp (lượt tải chưa về) vẫn chỉ một lần', async () => {
      const { c, retry } = await mountThenRefreshError();
      const releaseList = hold(LIST);
      const before = sent('GET', '/me/subscriptions').length;
      click(retry);
      await flush(2);
      click(retry);
      await flush(2);
      expect(sent('GET', '/me/subscriptions').length - before).toBe(1);
      releaseList();
      await flush(8);
      expect(c.textContent).toContain('Nước xả vải Tubu');
    });
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

describe('SubscriptionsPanel web: phân loại không có tên', () => {
  const qtyLine = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('div.text-xs.tabular-nums')).map((d) => d.textContent).find((t) => /SL \d/.test(t ?? ''));
  const editDescription = () => (sheetSpy.calls.filter((c) => c.title === 'Sửa gói định kỳ').at(-1) as unknown as { description?: string }).description;

  it('có tên: "phân loại · SL n" và mô tả sheet sửa "tên · phân loại" như trước', async () => {
    const c = await mount();
    expect(qtyLine(c)).toBe('Hương sả · SL 2');
    click(btn('Sửa', c));
    await flush(4);
    expect(editDescription()).toBe('Nước xả vải Tubu · Hương sả');
  });

  it('tên trống hoặc toàn khoảng trắng: chỉ "SL n" (không " · " mở đầu), mô tả sheet sửa chỉ tên sản phẩm', async () => {
    for (const variationName of ['', '   ']) {
      subs = [{ ...SUB, variationName }];
      const c = await mount();
      expect(qtyLine(c)).toBe('SL 2');
      click(btn('Sửa', c));
      await flush(4);
      expect(editDescription()).toBe('Nước xả vải Tubu');
      mounted.forEach((m) => m.unmount());
      mounted = [];
      sheetSpy.calls.length = 0;
    }
  });
});
