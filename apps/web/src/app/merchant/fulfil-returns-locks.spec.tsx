// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { FulfilOrdersTab } from './fulfil-orders-tab';
import { MerchantReturnsSection } from './merchant-returns';

// Wave 96B: cổng người bán, "Đơn cần giao" và "Hàng trả về": một việc mỗi đơn/lần, giữ khoá tới khi danh sách làm mới về (tối đa 4 giây), bị từ chối vì
// trạng thái đã đổi (400/404/409) thì tải lại, lời lỗi đứng ở cấp cha (không mất cùng thẻ đơn bị gỡ khỏi bộ lọc).

const order = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  code: `TF${id}`,
  status: 'CONFIRMED',
  subtotal: 200000,
  discount: 0,
  shippingFee: 30000,
  total: 230000,
  paymentMethod: 'COD',
  paymentStatus: 'PENDING',
  shippingAddress: { recipient: 'Hà My', phone: '0900000003', street: '9 Hai Bà Trưng', ward: 'Bến Nghé', district: 'Quận 1', province: 'TP.HCM' },
  note: null,
  merchantAcceptedAt: null,
  createdAt: '2026-11-01T03:00:00.000Z',
  items: [{ id: 'i1', productName: 'Mật ong', variationName: 'Mặc định', unitPrice: 100000, quantity: 2, total: 200000 }],
  sla: { state: null, dueAt: null },
  ...over,
});
const page = (orders: unknown[]) => ({ data: orders, meta: { page: 1, limit: 20, total: orders.length }, counts: {}, slaConfig: { confirmHours: 4, shipHours: 24, deliverDays: 7 } });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

type Route = () => Promise<Response> | Response;
let calls: { method: string; url: string }[] = [];
let routes: Record<string, Route> = {};
let mounted: Rendered | null = null;

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      const key = Object.keys(routes)
        .filter((k) => url.includes(k))
        .sort((a, b) => b.length - a.length)[0];
      if (!key) return json(500, { message: `no mock for ${method} ${url}` });
      return routes[key]!();
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const count = (method: string, part: string) => calls.filter((c) => c.method === method && c.url.includes(part)).length;
const listGets = () => count('GET', '/merchant/fulfil-orders?');
const btn = (root: ParentNode, text: string | RegExp) => byText(root, 'button', text) as HTMLButtonElement;
const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const aria = (b: HTMLElement) => ({ busy: b.getAttribute('aria-busy'), disabled: b.getAttribute('aria-disabled'), dom: (b as HTMLButtonElement).disabled });
const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`article[aria-label="Đơn TF${id}"]`)!;

async function mountOrders() {
  mounted = render(<FulfilOrdersTab />);
  await flush();
  return mounted.container;
}

describe('Đơn cần giao: Xác nhận đơn / Đã đóng gói / Khách đã nhận hàng', () => {
  it('chạm đúp "Xác nhận đơn" cùng một khung hình chỉ gửi một lệnh; nút aria-busy + aria-disabled, không disabled; Huỷ đơn cũng aria-disabled', async () => {
    const g = gate();
    routes['/merchant/fulfil-orders?'] = () => json(200, page([order('1')]));
    routes['/merchant/fulfil-orders/1/accept'] = async () => {
      await g.promise;
      return json(200, order('1', { merchantAcceptedAt: '2026-11-01T04:00:00.000Z' }));
    };
    const c = await mountOrders();
    const a = card(c, '1');
    btn(a, 'Xác nhận đơn').focus();
    await tap(btn(a, 'Xác nhận đơn'), btn(a, 'Xác nhận đơn'));
    await flush(1);
    expect(count('POST', '/merchant/fulfil-orders/1/accept')).toBe(1);
    expect(aria(btn(a, 'Xác nhận đơn'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(aria(btn(a, 'Huỷ đơn')).disabled).toBe('true');
    expect(aria(btn(a, 'Huỷ đơn')).dom).toBe(false);
    g.resolve();
    await flush();
  });

  it('đang xác nhận thì "Huỷ đơn" / "Nhập mã vận đơn" không mở form (guard trong handler, không chỉ aria)', async () => {
    const g = gate();
    routes['/merchant/fulfil-orders?'] = () => json(200, page([order('1')]));
    routes['/merchant/fulfil-orders/1/accept'] = async () => {
      await g.promise;
      return json(200, order('1'));
    };
    const c = await mountOrders();
    const a = card(c, '1');
    await tap(btn(a, 'Xác nhận đơn'), btn(a, 'Huỷ đơn'), btn(a, 'Nhập mã vận đơn'));
    await flush(1);
    expect(a.querySelector('form')).toBeNull();
    g.resolve();
    await flush();
  });

  it('xác nhận xong mà danh sách chưa làm mới: nút vẫn bận, chạm tiếp không gửi lệnh thứ hai; danh sách về thì nhả và hiện bước kế', async () => {
    const list = gate();
    let loads = 0;
    routes['/merchant/fulfil-orders?'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, page([order('1', loads > 1 ? { merchantAcceptedAt: '2026-11-01T04:00:00.000Z' } : {})]));
    };
    routes['/merchant/fulfil-orders/1/accept'] = () => json(200, order('1'));
    const c = await mountOrders();
    click(btn(card(c, '1'), 'Xác nhận đơn'));
    await flush();
    expect(listGets()).toBe(2);
    expect(aria(btn(card(c, '1'), 'Xác nhận đơn')).busy).toBe('true');
    click(btn(card(c, '1'), 'Xác nhận đơn'));
    await flush(2);
    expect(count('POST', '/merchant/fulfil-orders/1/accept')).toBe(1);
    list.resolve();
    await flush();
    expect(byText(card(c, '1'), 'button', 'Xác nhận đơn')).toBeNull();
    expect(aria(btn(card(c, '1'), 'Đã đóng gói')).busy).toBeNull();
  });

  it('danh sách không bao giờ về: còn bận ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    let loads = 0;
    routes['/merchant/fulfil-orders?'] = () => (++loads > 1 ? new Promise<Response>(() => {}) : json(200, page([order('1')])));
    routes['/merchant/fulfil-orders/1/accept'] = () => json(200, order('1'));
    const c = await mountOrders();
    click(btn(card(c, '1'), 'Xác nhận đơn'));
    await advance(3_500);
    expect(aria(btn(card(c, '1'), 'Xác nhận đơn')).busy).toBe('true');
    await advance(700);
    expect(aria(btn(card(c, '1'), 'Xác nhận đơn')).busy).toBeNull();
    click(btn(card(c, '1'), 'Xác nhận đơn'));
    await advance(50);
    expect(count('POST', '/merchant/fulfil-orders/1/accept')).toBe(2);
  });

  it.each([400, 404, 409])('Xác nhận đơn (không có ô nhập) bị từ chối vì đơn đã đổi trạng thái (%i): lời lỗi hiện NGAY ở đầu danh sách, tải lại, giữ khoá tới khi danh sách về; lời lỗi còn sau khi thẻ bị gỡ', async (status) => {
    const list = gate();
    let loads = 0;
    routes['/merchant/fulfil-orders?'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, page(loads > 1 ? [] : [order('1')]));
    };
    routes['/merchant/fulfil-orders/1/accept'] = () => json(status, { message: 'Đơn vừa được cập nhật ở nơi khác. Tải lại danh sách để xem trạng thái mới.' });
    const c = await mountOrders();
    click(btn(card(c, '1'), 'Xác nhận đơn'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Đơn vừa được cập nhật ở nơi khác');
    expect(listGets()).toBe(2);
    click(btn(card(c, '1'), 'Xác nhận đơn'));
    await flush(2);
    expect(count('POST', '/merchant/fulfil-orders/1/accept')).toBe(1);
    list.resolve();
    await flush();
    expect(c.querySelector('article[aria-label="Đơn TF1"]')).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Đơn vừa được cập nhật ở nơi khác');
  });

  it.each([
    ['pack', 'Đã đóng gói', { merchantAcceptedAt: '2026-11-01T04:00:00.000Z' }],
    ['deliver', 'Khách đã nhận hàng', { status: 'SHIPPING', merchantAcceptedAt: '2026-11-01T04:00:00.000Z', shippingCode: 'VD1', shippingPartner: 'GHN' }],
  ] as const)('%s (không có ô nhập) bị 400 vì đơn đã đổi bước: vẫn là dữ liệu cũ, lời lỗi kèm "Danh sách đã được làm mới." ở đầu danh sách và tải lại', async (path, label, over) => {
    const list = gate();
    let loads = 0;
    routes['/merchant/fulfil-orders?'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, page(loads > 1 ? [] : [order('1', over)]));
    };
    routes[`/merchant/fulfil-orders/1/${path}`] = () => json(400, { message: 'Chỉ đơn đang giao mới xác nhận "Đã giao" được.' });
    const c = await mountOrders();
    click(btn(card(c, '1'), label));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Danh sách đã được làm mới.');
    expect(listGets()).toBe(2);
    list.resolve();
    await flush();
  });

  it('lỗi 500: lời lỗi trên đúng thẻ, KHÔNG tải lại danh sách, nhả khoá ngay để thử lại', async () => {
    routes['/merchant/fulfil-orders?'] = () => json(200, page([order('1')]));
    routes['/merchant/fulfil-orders/1/accept'] = () => json(500, { message: 'Máy chủ đang bận' });
    const c = await mountOrders();
    click(btn(card(c, '1'), 'Xác nhận đơn'));
    await flush();
    expect(card(c, '1').textContent).toContain('Máy chủ đang bận');
    expect(listGets()).toBe(1);
    expect(aria(btn(card(c, '1'), 'Xác nhận đơn')).busy).toBeNull();
    click(btn(card(c, '1'), 'Xác nhận đơn'));
    await flush();
    expect(count('POST', '/merchant/fulfil-orders/1/accept')).toBe(2);
  });

  it('hai đơn khác nhau không chặn nhau', async () => {
    const g = gate();
    routes['/merchant/fulfil-orders?'] = () => json(200, page([order('1'), order('2')]));
    routes['/merchant/fulfil-orders/1/accept'] = async () => {
      await g.promise;
      return json(200, order('1'));
    };
    routes['/merchant/fulfil-orders/2/accept'] = () => json(200, order('2'));
    const c = await mountOrders();
    await tap(btn(card(c, '1'), 'Xác nhận đơn'), btn(card(c, '2'), 'Xác nhận đơn'));
    await flush(1);
    expect(count('POST', '/merchant/fulfil-orders/1/accept')).toBe(1);
    expect(count('POST', '/merchant/fulfil-orders/2/accept')).toBe(1);
    g.resolve();
    await flush();
  });
});

describe('Đơn cần giao: form mã vận đơn và huỷ đơn', () => {
  it('Enter hai lần cùng một khung hình ở form vận đơn chỉ gửi một lệnh; nút gửi aria-busy, không disabled', async () => {
    const g = gate();
    routes['/merchant/fulfil-orders?'] = () => json(200, page([order('1', { merchantAcceptedAt: '2026-11-01T04:00:00.000Z' })]));
    routes['/merchant/fulfil-orders/1/ship'] = async () => {
      await g.promise;
      return json(200, order('1', { status: 'SHIPPING' }));
    };
    const c = await mountOrders();
    const a = card(c, '1');
    click(btn(a, 'Nhập mã vận đơn'));
    await flush(1);
    const inputs = a.querySelectorAll<HTMLInputElement>('form input');
    typeInto(inputs[0]!, 'GHN');
    typeInto(inputs[1]!, 'VD123');
    const form = a.querySelector('form')!;
    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await flush(1);
    expect(count('POST', '/merchant/fulfil-orders/1/ship')).toBe(1);
    const b = btn(a, /Đang lưu/);
    expect(aria(b)).toEqual({ busy: 'true', disabled: 'true', dom: false });
    g.resolve();
    await flush();
  });

  it('huỷ đơn: nút Xác nhận huỷ vẫn disabled thật khi chưa có lý do (khác với bận); Enter hai lần chỉ huỷ một lần', async () => {
    const g = gate();
    routes['/merchant/fulfil-orders?'] = () => json(200, page([order('1')]));
    routes['/merchant/fulfil-orders/1/cancel'] = async () => {
      await g.promise;
      return json(200, order('1', { status: 'CANCELLED' }));
    };
    const c = await mountOrders();
    const a = card(c, '1');
    click(btn(a, 'Huỷ đơn'));
    await flush(1);
    expect(btn(a, 'Xác nhận huỷ đơn').disabled).toBe(true);
    typeInto(a.querySelector('form input'), 'Hết hàng');
    const form = a.querySelector('form')!;
    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await flush(1);
    expect(count('POST', '/merchant/fulfil-orders/1/cancel')).toBe(1);
    expect(aria(btn(a, /Đang huỷ/)).dom).toBe(false);
    expect(aria(btn(a, /Đang huỷ/)).busy).toBe('true');
    g.resolve();
    await flush();
  });

  it('"Khách đã nhận hàng" chạm đúp cùng khung hình chỉ gửi một lệnh deliver', async () => {
    const g = gate();
    routes['/merchant/fulfil-orders?'] = () => json(200, page([order('1', { status: 'SHIPPING', merchantAcceptedAt: '2026-11-01T04:00:00.000Z', shippingCode: 'VD1', shippingPartner: 'GHN' })]));
    routes['/merchant/fulfil-orders/1/deliver'] = async () => {
      await g.promise;
      return json(200, order('1', { status: 'DELIVERED' }));
    };
    const c = await mountOrders();
    const a = card(c, '1');
    await tap(btn(a, 'Khách đã nhận hàng'), btn(a, 'Khách đã nhận hàng'));
    await flush(1);
    expect(count('POST', '/merchant/fulfil-orders/1/deliver')).toBe(1);
    g.resolve();
    await flush();
  });
});

// Lệnh có ô người dùng nhập (ShipMerchantOrderDto, MerchantOrderReasonDto): 400 là lỗi nhập liệu (link tra cứu sai dạng, hãng vận chuyển chỉ gồm dấu cách),
// tải lại danh sách không sửa được nó. Lời lỗi phải nằm dưới form của đúng thẻ; chỉ 404/409 là dữ liệu cũ.
type InputCmd = 'ship' | 'cancel' | 'fail';
const ACCEPTED = '2026-11-01T04:00:00.000Z';
const INPUT_CMDS: Record<InputCmd, { over: Record<string, unknown>; open: string; fill: (form: HTMLFormElement) => void }> = {
  ship: {
    over: { merchantAcceptedAt: ACCEPTED },
    open: 'Nhập mã vận đơn',
    fill: (form) => {
      const inputs = form.querySelectorAll<HTMLInputElement>('input');
      typeInto(inputs[0]!, 'GHN');
      typeInto(inputs[1]!, 'VD123');
      typeInto(inputs[2]!, 'abc xyz');
    },
  },
  cancel: { over: {}, open: 'Huỷ đơn', fill: (form) => typeInto(form.querySelector('input'), 'Hết hàng') },
  fail: {
    over: { status: 'SHIPPING', merchantAcceptedAt: ACCEPTED, shippingCode: 'VD1', shippingPartner: 'GHN' },
    open: 'Giao không thành công',
    fill: (form) => typeInto(form.querySelector('input'), 'Khách không nghe máy'),
  },
};
const CMD_PATH: Record<InputCmd, string> = { ship: 'ship', cancel: 'cancel', fail: 'fail' };
const eightOrders = (target: InputCmd, drop = false) =>
  Array.from({ length: 8 }, (_, i) => String(i + 1))
    .filter((id) => !(drop && id === '8'))
    .map((id) => order(id, id === '8' ? INPUT_CMDS[target].over : {}));
const submitForm = async (form: HTMLFormElement) => {
  await act(async () => {
    form.requestSubmit();
  });
  await flush();
};
/** Mở form của lệnh trên thẻ đơn thứ 8 (xa đầu danh sách) rồi điền ô nhập. */
async function openInputForm(c: HTMLElement, cmd: InputCmd) {
  const a = card(c, '8');
  click(btn(a, INPUT_CMDS[cmd].open));
  await flush(1);
  const form = a.querySelector('form')!;
  INPUT_CMDS[cmd].fill(form);
  return { a, form };
}
/** Nút gửi của form: đổi chữ khi đang chạy nên tìm theo vai trò, không theo chữ. */
const submitBtn = (form: HTMLFormElement) => form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const topAlerts = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="alert"]')).filter((el) => !el.closest('article'));

describe('Đơn cần giao: lệnh có ô nhập liệu (Nhập mã vận đơn / Huỷ đơn / Giao không thành công)', () => {
  const INPUT_ERROR = 'Link tra cứu vận đơn không hợp lệ, ví dụ ghn.vn/tra-cuu/GHN123.';

  it.each(['ship', 'cancel', 'fail'] as const)(
    '%s: máy chủ trả 400 vì nhập sai: lời lỗi nằm dưới form của đúng thẻ (thẻ thứ 8), form còn mở, KHÔNG tải lại danh sách, không câu "Danh sách đã được làm mới", không có lời lỗi ở đầu danh sách',
    async (cmd) => {
      routes['/merchant/fulfil-orders?'] = () => json(200, page(eightOrders(cmd)));
      routes[`/merchant/fulfil-orders/8/${CMD_PATH[cmd]}`] = () => json(400, { message: INPUT_ERROR });
      const c = await mountOrders();
      const { a, form } = await openInputForm(c, cmd);
      await submitForm(form);
      const alert = a.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain(INPUT_ERROR);
      expect(form.compareDocumentPosition(alert!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(a.contains(form)).toBe(true);
      expect(topAlerts(c)).toEqual([]);
      expect(c.textContent).not.toContain('Danh sách đã được làm mới');
      expect(listGets()).toBe(1);
      expect(c.querySelectorAll('article')).toHaveLength(8);
    },
  );

  it.each(['ship', 'cancel', 'fail'] as const)('%s: sau lỗi nhập 400 khoá nhả ngay, sửa lại gửi tiếp được (lệnh thứ hai ra máy chủ) và lời lỗi cũ biến mất khi gửi lại', async (cmd) => {
    let attempts = 0;
    routes['/merchant/fulfil-orders?'] = () => json(200, page(eightOrders(cmd)));
    routes[`/merchant/fulfil-orders/8/${CMD_PATH[cmd]}`] = () => (++attempts === 1 ? json(400, { message: INPUT_ERROR }) : json(200, order('8', INPUT_CMDS[cmd].over)));
    const c = await mountOrders();
    const { a, form } = await openInputForm(c, cmd);
    await submitForm(form);
    expect(aria(submitBtn(form)).busy).toBeNull();
    await submitForm(form);
    expect(count('POST', `/merchant/fulfil-orders/8/${CMD_PATH[cmd]}`)).toBe(2);
    expect(a.textContent).not.toContain(INPUT_ERROR);
  });

  it('ship: hãng vận chuyển chỉ gồm dấu cách (trình duyệt cho qua `required`, DTO @Trim @IsNotEmpty từ chối): 400 hiện dưới form, không tải lại', async () => {
    let sent: { carrier?: string } = {};
    routes['/merchant/fulfil-orders?'] = () => json(200, page(eightOrders('ship')));
    routes['/merchant/fulfil-orders/8/ship'] = () => json(400, { message: 'Cần nhập hãng vận chuyển và mã vận đơn.' });
    const c = await mountOrders();
    const a = card(c, '8');
    click(btn(a, 'Nhập mã vận đơn'));
    await flush(1);
    const form = a.querySelector('form')!;
    const inputs = form.querySelectorAll<HTMLInputElement>('input');
    typeInto(inputs[0]!, '   ');
    typeInto(inputs[1]!, 'VD123');
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } };
    await submitForm(form);
    const post = fetchMock.mock.calls.find(([u, init]) => u.includes('/fulfil-orders/8/ship') && init?.method === 'POST');
    sent = JSON.parse(String(post?.[1]?.body ?? '{}'));
    expect(sent.carrier).toBe('');
    expect(a.querySelector('[role="alert"]')?.textContent).toContain('Cần nhập hãng vận chuyển');
    expect(topAlerts(c)).toEqual([]);
    expect(listGets()).toBe(1);
  });

  it.each([
    ['ship', 404],
    ['ship', 409],
    ['cancel', 404],
    ['cancel', 409],
    ['fail', 404],
    ['fail', 409],
  ] as const)('%s bị từ chối vì dữ liệu cũ (%i): lời lỗi kèm "Danh sách đã được làm mới." ở đầu danh sách (không lặp dưới form), tải lại, giữ khoá tới khi danh sách về, chạm lại chỉ gọi API một lần', async (cmd, status) => {
    const list = gate();
    let loads = 0;
    routes['/merchant/fulfil-orders?'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, page(eightOrders(cmd, loads > 1)));
    };
    routes[`/merchant/fulfil-orders/8/${CMD_PATH[cmd]}`] = () => json(status, { message: 'Đơn vừa được cập nhật ở nơi khác.' });
    const c = await mountOrders();
    const { a, form } = await openInputForm(c, cmd);
    await submitForm(form);
    expect(topAlerts(c)[0]?.textContent).toContain('Đơn vừa được cập nhật ở nơi khác. Danh sách đã được làm mới.');
    expect(a.querySelector('[role="alert"]')).toBeNull();
    expect(listGets()).toBe(2);
    expect(aria(submitBtn(form)).busy).toBe('true');
    await act(async () => {
      form.requestSubmit();
    });
    await flush(2);
    expect(count('POST', `/merchant/fulfil-orders/8/${CMD_PATH[cmd]}`)).toBe(1);
    list.resolve();
    await flush();
    expect(c.querySelector('article[aria-label="Đơn TF8"]')).toBeNull();
    expect(topAlerts(c)[0]?.textContent).toContain('Danh sách đã được làm mới.');
  });

  it.each(['ship', 'cancel', 'fail'] as const)('%s: lỗi 500 hiện dưới form của thẻ, không tải lại, nhả khoá ngay', async (cmd) => {
    routes['/merchant/fulfil-orders?'] = () => json(200, page(eightOrders(cmd)));
    routes[`/merchant/fulfil-orders/8/${CMD_PATH[cmd]}`] = () => json(500, { message: 'Máy chủ đang bận' });
    const c = await mountOrders();
    const { a, form } = await openInputForm(c, cmd);
    await submitForm(form);
    expect(a.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ đang bận');
    expect(topAlerts(c)).toEqual([]);
    expect(listGets()).toBe(1);
    expect(aria(submitBtn(form)).busy).toBeNull();
  });
});

const RETURNS = [
  { id: 'r1', status: 'APPROVED', createdAt: '2026-10-13T03:00:00Z', reviewedAt: '2026-10-13T05:00:00Z', receivedAt: null, reasonLabel: null, reason: 'Hỏng', fullReturn: false, shopFault: null, orderCode: 'TB-9', images: [], lines: [{ productName: 'Mật ong', variationName: null, quantity: 1 }] },
  { id: 'r2', status: 'APPROVED', createdAt: '2026-10-14T03:00:00Z', reviewedAt: '2026-10-14T05:00:00Z', receivedAt: null, reasonLabel: null, reason: 'Vỡ', fullReturn: true, shopFault: null, orderCode: 'TB-10', images: [], lines: [{ productName: 'Trà', variationName: null, quantity: 2 }] },
];
const returnsGets = () => count('GET', '/merchant/returns');
async function mountReturns() {
  mounted = render(<MerchantReturnsSection />);
  await flush();
  return mounted.container;
}

describe('Hàng trả về: Đã nhận hàng trả (cộng lại tồn kho)', () => {
  it('chạm đúp cùng một khung hình chỉ gửi một lệnh; mọi dòng aria-disabled, không disabled; chỉ dòng đang chạy báo "Đang ghi nhận…"', async () => {
    const g = gate();
    routes['/merchant/returns'] = () => json(200, RETURNS);
    routes['/merchant/returns/r1/received'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    const c = await mountReturns();
    const first = btn(c, 'Đã nhận hàng trả');
    await tap(first, first);
    await flush(1);
    expect(count('POST', '/merchant/returns/r1/received')).toBe(1);
    const busy = btn(c, /Đang ghi nhận/);
    expect(aria(busy)).toEqual({ busy: 'true', disabled: 'true', dom: false });
    const other = btn(c, 'Đã nhận hàng trả');
    expect(aria(other)).toEqual({ busy: null, disabled: 'true', dom: false });
    click(other);
    await flush(1);
    expect(count('POST', '/merchant/returns/r2/received')).toBe(0);
    g.resolve();
    await flush();
  });

  it('nhận xong mà danh sách chưa về: vẫn bận, chạm tiếp không gửi lại (tồn kho bị cộng hai lần)', async () => {
    const list = gate();
    let loads = 0;
    routes['/merchant/returns'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, RETURNS);
    };
    routes['/merchant/settlement'] = () => json(200, {});
    routes['/merchant/returns/r1/received'] = () => json(200, { ok: true });
    const c = await mountReturns();
    click(btn(c, 'Đã nhận hàng trả'));
    await flush();
    expect(returnsGets()).toBe(2);
    click(btn(c, 'Đã nhận hàng trả'));
    await flush(2);
    expect(count('POST', '/merchant/returns/')).toBe(1);
    list.resolve();
    await flush();
    expect(aria(btn(c, 'Đã nhận hàng trả')).disabled).toBeNull();
  });

  it('danh sách không bao giờ về: nhả sau hạn 4 giây', async () => {
    useHangTimers();
    let loads = 0;
    routes['/merchant/returns'] = () => (++loads > 1 ? new Promise<Response>(() => {}) : json(200, RETURNS));
    routes['/merchant/returns/r1/received'] = () => json(200, { ok: true });
    const c = await mountReturns();
    click(btn(c, 'Đã nhận hàng trả'));
    await advance(3_500);
    expect(aria(btn(c, /Đang ghi nhận/)).busy).toBe('true');
    await advance(700);
    expect(byText(c, 'button', /Đang ghi nhận/)).toBeNull();
  });

  it.each([400, 404, 409])('máy chủ từ chối (%i): lời lỗi hiện NGAY, tải lại danh sách hàng trả về, giữ khoá tới khi về', async (status) => {
    const list = gate();
    let loads = 0;
    routes['/merchant/returns'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, RETURNS);
    };
    routes['/merchant/returns/r1/received'] = () => json(status, { message: 'Yêu cầu trả hàng này đã được nhận.' });
    const c = await mountReturns();
    click(btn(c, 'Đã nhận hàng trả'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Yêu cầu trả hàng này đã được nhận.');
    expect(returnsGets()).toBe(2);
    click(btn(c, 'Đã nhận hàng trả'));
    await flush(2);
    expect(count('POST', '/merchant/returns/')).toBe(1);
    list.resolve();
    await flush();
  });

  it('lỗi 500: lời lỗi hiện, KHÔNG tải lại, nhả khoá ngay', async () => {
    routes['/merchant/returns'] = () => json(200, RETURNS);
    routes['/merchant/returns/r1/received'] = () => json(500, { message: 'Máy chủ đang bận' });
    const c = await mountReturns();
    click(btn(c, 'Đã nhận hàng trả'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ đang bận');
    expect(returnsGets()).toBe(1);
    expect(aria(btn(c, 'Đã nhận hàng trả')).disabled).toBeNull();
  });
});
