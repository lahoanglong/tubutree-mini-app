// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerAsk, answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { MerchantFulfilmentTab } from './merchant-fulfilment-tab';

// Wave 96B: admin "Đơn đối tác & đối soát" (đường TIỀN): Lập phiếu, Bật/Tắt đối tác, Lưu phí, Đã chuyển/Đã thu, Huỷ phiếu. Một việc mỗi lúc, giữ khoá tới khi
// danh sách làm mới về (tối đa 4 giây), bị từ chối vì dữ liệu đã cũ thì chờ tải lại, lời lỗi đứng ở đầu tab. Lập phiếu: 400/404/409; Đã chuyển và Huỷ phiếu có ô nhập
// (mã giao dịch, lý do) nên 400 là lỗi nhập, hiện trong dòng phiếu, chỉ 404/409 là phiếu đã đổi.
// Chạy trên QueryClient trần (test-utils/dom), không có MutationCache của production: ở production mọi lệnh settle (kể cả lỗi) đều làm cũ khoá admin-*, nên "không tải lại"
// ở đây chỉ nói màn KHÔNG tự gọi tải lại và KHÔNG chờ nó. Quy tắc 400/404/409 chỉ quyết định việc chờ tải lại trước khi nhả khoá.

const OVERVIEW = {
  slaConfig: { confirmHours: 24, shipHours: 48, deliverDays: 7 },
  defaultCommissionPct: 0.15,
  stores: [
    { storefrontId: 'sf1', title: 'Mật ong Linh', type: 'CTV', isPartner: true, owner: { fullName: 'Linh', phone: '0900000009' }, activeOrders: 3, overdueOrders: 1, settleableLines: 2, settleableAmount: 185000 },
    { storefrontId: 'sf3', title: 'Trà Shan giao hộ', type: 'MERCHANT', isPartner: false, owner: null, activeOrders: 0, overdueOrders: 0, settleableLines: 2, settleableAmount: 123760, commissionPct: 0.1, consignmentFeePct: 0.02, consignmentFeeFixed: 3400 },
  ],
  overdue: [],
};
const PAYOUT = {
  id: 'mp1',
  storefrontId: 'sf1',
  amount: 500000,
  status: 'PENDING',
  bankInfo: { bankName: 'BIDV', accountNo: '0123456789', accountName: 'NGUYEN LINH' },
  createdAt: '2026-10-12T03:00:00.000Z',
  lines: [],
  storefront: { id: 'sf1', title: 'Mật ong Linh' },
};

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
  routes = {
    '/admin/merchant-fulfilment/overview': () => json(200, OVERVIEW),
    '/admin/merchant-fulfilment/payouts?': () => json(200, { data: [PAYOUT], meta: { page: 1, limit: 20, total: 1 } }),
    '/admin/merchant-fulfilment/payouts': () => json(200, { ...PAYOUT, id: 'mp2' }),
    '/admin/merchant-fulfilment/payouts/mp1/paid': () => json(200, { ...PAYOUT, status: 'PAID' }),
    '/admin/merchant-fulfilment/payouts/mp1/cancel': () => json(200, { ...PAYOUT, status: 'CANCELLED' }),
    '/admin/storefronts/sf1/partner': () => json(200, { id: 'sf1', isPartner: false }),
    '/admin/merchant-fulfilment/stores/sf3/terms': () => json(200, {}),
    '/ops/inbox': () => json(200, { items: [] }),
  };
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
const overviewGets = () => count('GET', '/admin/merchant-fulfilment/overview');
const payoutGets = () => count('GET', '/admin/merchant-fulfilment/payouts?');
const creates = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/admin/merchant-fulfilment/payouts')).length;
const buttons = (root: ParentNode, text: string | RegExp) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')));
const btn = (root: ParentNode, text: string | RegExp) => buttons(root, text)[0]!;
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

async function mount() {
  mounted = render(<MerchantFulfilmentTab isAdmin />);
  await flush();
  return mounted.container;
}
const holdOverview = (g: { promise: Promise<void> }) => {
  let loads = 0;
  routes['/admin/merchant-fulfilment/overview'] = async () => {
    if (++loads > 1) await g.promise;
    return json(200, OVERVIEW);
  };
};

describe('Lập phiếu đối soát', () => {
  it('chạm đúp cùng một khung hình chỉ lập một phiếu; nút của mọi gian hàng aria-disabled, không disabled', async () => {
    const g = gate();
    routes['/admin/merchant-fulfilment/payouts'] = async () => {
      await g.promise;
      return json(200, { ...PAYOUT, id: 'mp2' });
    };
    const c = await mount();
    const [first, second] = buttons(c, 'Lập phiếu đối soát');
    first!.focus();
    await tap(first!, first!);
    await flush(1);
    expect(creates()).toBe(1);
    expect(aria(buttons(c, 'Lập phiếu đối soát')[0]!)).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(aria(second!).disabled).toBe('true');
    expect(aria(second!).dom).toBe(false);
    click(second!);
    await flush(1);
    expect(creates()).toBe(1);
    g.resolve();
    await flush();
  });

  it('lập xong mà tổng quan chưa làm mới: nút vẫn bận, chạm tiếp không lập phiếu thứ hai (trùng khoản); về rồi mới nhả', async () => {
    const g = gate();
    holdOverview(g);
    const c = await mount();
    click(buttons(c, 'Lập phiếu đối soát')[0]!);
    await flush();
    expect(overviewGets()).toBe(2);
    click(buttons(c, 'Lập phiếu đối soát')[0]!);
    await flush(2);
    expect(creates()).toBe(1);
    g.resolve();
    await flush();
    expect(aria(buttons(c, 'Lập phiếu đối soát')[0]!).disabled).toBeNull();
  });

  it('tổng quan không bao giờ về: còn bận ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    let loads = 0;
    routes['/admin/merchant-fulfilment/overview'] = () => (++loads > 1 ? new Promise<Response>(() => {}) : json(200, OVERVIEW));
    const c = await mount();
    click(buttons(c, 'Lập phiếu đối soát')[0]!);
    await advance(3_500);
    expect(aria(buttons(c, 'Lập phiếu đối soát')[0]!).disabled).toBe('true');
    await advance(700);
    expect(aria(buttons(c, 'Lập phiếu đối soát')[0]!).disabled).toBeNull();
    click(buttons(c, 'Lập phiếu đối soát')[0]!);
    await advance(50);
    expect(creates()).toBe(2);
  });

  it.each([400, 404, 409])('Lập phiếu: tổng bảng kê đã đổi (%i): lời lỗi hiện NGAY ở đầu tab, tải lại tổng quan và phiếu, giữ khoá tới khi về', async (status) => {
    const g = gate();
    holdOverview(g);
    routes['/admin/merchant-fulfilment/payouts'] = () => json(status, { message: 'Bảng kê vừa đổi, xem lại tổng tiền trước khi lập phiếu.' });
    const c = await mount();
    const before = payoutGets();
    click(buttons(c, 'Lập phiếu đối soát')[0]!);
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Bảng kê vừa đổi');
    expect(overviewGets()).toBe(2);
    expect(payoutGets()).toBe(before + 1);
    click(buttons(c, 'Lập phiếu đối soát')[0]!);
    await flush(2);
    expect(creates()).toBe(1);
    g.resolve();
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Bảng kê vừa đổi');
  });

  it('lỗi 500: nhắc tải lại trang, màn không tự tải lại danh sách, nhả khoá ngay', async () => {
    routes['/admin/merchant-fulfilment/payouts'] = () => json(500, { message: 'Máy chủ đang bận' });
    const c = await mount();
    click(buttons(c, 'Lập phiếu đối soát')[0]!);
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Tải lại trang để xem trạng thái hiện tại');
    expect(overviewGets()).toBe(1);
    expect(aria(buttons(c, 'Lập phiếu đối soát')[0]!).disabled).toBeNull();
    click(buttons(c, 'Lập phiếu đối soát')[0]!);
    await flush();
    expect(creates()).toBe(2);
  });
});

describe('Bật/Tắt đối tác', () => {
  it('xác nhận xong gửi một lệnh; tổng quan chưa về thì bấm tiếp không mở hộp xác nhận và không gửi lại; về rồi mới nhả', async () => {
    const g = gate();
    holdOverview(g);
    const c = await mount();
    click(btn(c, 'Tắt đối tác'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(count('POST', '/admin/storefronts/sf1/partner')).toBe(1);
    expect(aria(btn(c, 'Tắt đối tác'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    click(btn(c, 'Tắt đối tác'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    g.resolve();
    await flush();
    expect(aria(btn(c, 'Tắt đối tác')).disabled).toBeNull();
  });
});

describe('Lưu phí', () => {
  it('Enter hai lần cùng một khung hình chỉ gửi một lệnh; nút aria-busy, không disabled', async () => {
    const g = gate();
    routes['/admin/merchant-fulfilment/stores/sf3/terms'] = async () => {
      await g.promise;
      return json(200, {});
    };
    const c = await mount();
    const feesBtn = buttons(c, 'Sửa phí');
    click(feesBtn[feesBtn.length - 1]!);
    await flush();
    const form = Array.from(c.querySelectorAll('form')).find((f) => f.textContent?.includes('Lưu phí'))!;
    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await flush(1);
    expect(count('PATCH', '/stores/sf3/terms')).toBe(1);
    expect(aria(btn(form, 'Lưu phí'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    g.resolve();
    await flush();
  });
});

const payoutPaid = () => count('POST', '/payouts/mp1/paid');
const payoutCancel = () => count('POST', '/payouts/mp1/cancel');
async function fillRefAndConfirm(c: HTMLElement) {
  typeInto(c.querySelector('li input[required]'), 'FT0001');
  click(btn(c, 'Đã chuyển'));
  await flush();
  answerConfirm(true);
  await flush(1);
}

describe('Phiếu: Đã chuyển / Huỷ phiếu', () => {
  it('đang ghi sổ "Đã chuyển": Huỷ phiếu và Đã chuyển bấm lại không mở hộp xác nhận, không gửi lệnh; nút aria, không disabled', async () => {
    const g = gate();
    routes['/admin/merchant-fulfilment/payouts/mp1/paid'] = async () => {
      await g.promise;
      return json(200, { ...PAYOUT, status: 'PAID' });
    };
    const c = await mount();
    await fillRefAndConfirm(c);
    expect(payoutPaid()).toBe(1);
    await tap(btn(c, 'Huỷ phiếu'), btn(c, 'Đã chuyển'), btn(c, 'Đã chuyển'));
    await flush(1);
    expect(confirmDialog()).toBeNull();
    expect(payoutCancel()).toBe(0);
    expect(payoutPaid()).toBe(1);
    expect(aria(btn(c, 'Huỷ phiếu'))).toEqual({ busy: null, disabled: 'true', dom: false });
    expect(aria(btn(c, 'Đã chuyển'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    g.resolve();
    await flush();
  });

  it('ghi sổ xong mà danh sách phiếu chưa về: vẫn bận, không ghi sổ lần hai; về rồi mới nhả', async () => {
    const list = gate();
    let loads = 0;
    routes['/admin/merchant-fulfilment/payouts?'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, { data: [PAYOUT], meta: { page: 1, limit: 20, total: 1 } });
    };
    const c = await mount();
    await fillRefAndConfirm(c);
    await flush();
    expect(payoutGets()).toBe(2);
    click(btn(c, 'Đã chuyển'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(payoutPaid()).toBe(1);
    list.resolve();
    await flush();
    expect(aria(btn(c, 'Đã chuyển')).disabled).toBeNull();
  });

  it.each([404, 409])('Đã chuyển: phiếu đã đổi (%i): lời lỗi hiện NGAY ở đầu tab, tải lại phiếu và tổng quan, giữ khoá tới khi về; lời lỗi còn sau khi phiếu biến khỏi danh sách', async (status) => {
    const list = gate();
    let loads = 0;
    routes['/admin/merchant-fulfilment/payouts?'] = async () => {
      if (++loads > 1) await list.promise;
      return json(200, { data: loads > 1 ? [] : [PAYOUT], meta: { page: 1, limit: 20, total: loads > 1 ? 0 : 1 } });
    };
    routes['/admin/merchant-fulfilment/payouts/mp1/paid'] = () => json(status, { message: 'Phiếu đã bị huỷ, không đánh dấu đã chuyển được.' });
    const c = await mount();
    await fillRefAndConfirm(c);
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Phiếu đã bị huỷ');
    expect(payoutGets()).toBe(2);
    expect(overviewGets()).toBe(2);
    expect(aria(btn(c, 'Đã chuyển')).disabled).toBe('true');
    list.resolve();
    await flush();
    expect(byText(c, 'button', 'Đã chuyển')).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Phiếu đã bị huỷ');
  });

  // Mã giao dịch và lý do huỷ là ô người dùng nhập: máy chủ chỉ trả 400 khi ô trống/quá dài (trạng thái phiếu đã đổi là 404/409), nên 400 là lỗi nhập, không phải dữ liệu cũ.
  describe('400 vì ô nhập (mã giao dịch / lý do huỷ)', () => {
    const PAYOUT2 = { ...PAYOUT, id: 'mp2', storefrontId: 'sf3', storefront: { id: 'sf3', title: 'Trà Shan giao hộ' } };
    const twoPayouts = () => json(200, { data: [PAYOUT, PAYOUT2], meta: { page: 1, limit: 20, total: 2 } });
    const payoutRows = (c: HTMLElement) => Array.from(c.querySelectorAll('li')).filter((li) => li.querySelector('input[required]'));
    const outsideRows = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="alert"]')).filter((el) => !el.closest('li'));

    it('Đã chuyển bị 400: lời lỗi nằm trong đúng dòng phiếu (phiếu thứ hai), màn không tải lại và không chờ tải lại, không lời lỗi ở đầu tab, nhả khoá ngay để sửa rồi gửi lại', async () => {
      let attempts = 0;
      routes['/admin/merchant-fulfilment/payouts?'] = twoPayouts;
      routes['/admin/merchant-fulfilment/payouts/mp2/paid'] = () => (++attempts === 1 ? json(400, { message: 'Cần nhập mã giao dịch ngân hàng.' }) : json(200, { ...PAYOUT2, status: 'PAID' }));
      const c = await mount();
      const second = payoutRows(c)[1]!;
      typeInto(second.querySelector('input[required]'), 'FT0009');
      click(buttons(second, 'Đã chuyển')[0]!);
      await flush();
      answerConfirm(true);
      await flush();
      expect(payoutRows(c)[1]!.querySelector('[role="alert"]')?.textContent).toContain('Cần nhập mã giao dịch ngân hàng.');
      expect(outsideRows(c)).toEqual([]);
      expect(payoutGets()).toBe(1);
      expect(overviewGets()).toBe(1);
      expect(aria(buttons(payoutRows(c)[1]!, 'Đã chuyển')[0]!).disabled).toBeNull();
      click(buttons(payoutRows(c)[1]!, 'Đã chuyển')[0]!);
      await flush();
      answerConfirm(true);
      await flush();
      expect(count('POST', '/payouts/mp2/paid')).toBe(2);
      expect(payoutRows(c)[1]!.querySelector('[role="alert"]')).toBeNull();
    });

    it('Huỷ phiếu bị 400: lời lỗi nằm trong đúng dòng phiếu, màn không tải lại, không lời lỗi ở đầu tab, nhả khoá ngay', async () => {
      routes['/admin/merchant-fulfilment/payouts?'] = twoPayouts;
      routes['/admin/merchant-fulfilment/payouts/mp2/cancel'] = () => json(400, { message: 'Cần nhập lý do huỷ phiếu để báo gian hàng.' });
      const c = await mount();
      click(buttons(payoutRows(c)[1]!, 'Huỷ phiếu')[0]!);
      await flush();
      answerAsk('Sai tài khoản nhận');
      await flush();
      expect(count('POST', '/payouts/mp2/cancel')).toBe(1);
      expect(payoutRows(c)[1]!.querySelector('[role="alert"]')?.textContent).toContain('Cần nhập lý do huỷ phiếu');
      expect(outsideRows(c)).toEqual([]);
      expect(payoutGets()).toBe(1);
      expect(overviewGets()).toBe(1);
      expect(aria(buttons(payoutRows(c)[1]!, 'Huỷ phiếu')[0]!).disabled).toBeNull();
      routes['/admin/merchant-fulfilment/payouts/mp2/cancel'] = () => json(200, { ...PAYOUT2, status: 'CANCELLED' });
      click(buttons(payoutRows(c)[1]!, 'Huỷ phiếu')[0]!);
      await flush();
      answerAsk('Sai tài khoản nhận, nhập lại');
      await flush();
      expect(count('POST', '/payouts/mp2/cancel')).toBe(2);
      expect(payoutRows(c)[1]?.querySelector('[role="alert"]') ?? null).toBeNull();
    });

    it.each([404, 409])('Huỷ phiếu bị từ chối vì phiếu đã đổi (%i): lời lỗi ở đầu tab, tải lại phiếu và tổng quan, giữ khoá tới khi về, chạm lại không gửi lệnh thứ hai', async (status) => {
      const g = gate();
      holdOverview(g);
      routes['/admin/merchant-fulfilment/payouts/mp1/cancel'] = () => json(status, { message: 'Chỉ huỷ được phiếu chưa chuyển tiền.' });
      const c = await mount();
      click(btn(c, 'Huỷ phiếu'));
      await flush();
      answerAsk('Sai tài khoản nhận');
      await flush();
      expect(c.querySelector('[role="alert"]')?.textContent).toContain('Chỉ huỷ được phiếu chưa chuyển tiền.');
      expect(payoutGets()).toBe(2);
      expect(overviewGets()).toBe(2);
      click(btn(c, 'Huỷ phiếu'));
      await flush(2);
      expect(confirmDialog()).toBeNull();
      expect(payoutCancel()).toBe(1);
      g.resolve();
      await flush();
    });
  });

  it('ghi sổ lỗi 500: lời lỗi hiện, màn không tự tải lại, nhả khoá ngay để thử lại', async () => {
    routes['/admin/merchant-fulfilment/payouts/mp1/paid'] = () => json(500, { message: 'Máy chủ đang bận' });
    const c = await mount();
    await fillRefAndConfirm(c);
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ đang bận');
    expect(payoutGets()).toBe(1);
    expect(aria(btn(c, 'Đã chuyển')).disabled).toBeNull();
  });

  it('Huỷ phiếu: một lệnh; đang huỷ thì Đã chuyển bị chặn', async () => {
    const g = gate();
    routes['/admin/merchant-fulfilment/payouts/mp1/cancel'] = async () => {
      await g.promise;
      return json(200, { ...PAYOUT, status: 'CANCELLED' });
    };
    const c = await mount();
    click(btn(c, 'Huỷ phiếu'));
    await flush();
    answerAsk('Sai tài khoản nhận');
    await flush(1);
    expect(payoutCancel()).toBe(1);
    typeInto(c.querySelector('li input[required]'), 'FT0002');
    click(btn(c, 'Đã chuyển'));
    await flush(1);
    expect(confirmDialog()).toBeNull();
    expect(payoutPaid()).toBe(0);
    expect(aria(btn(c, 'Huỷ phiếu')).busy).toBe('true');
    g.resolve();
    await flush();
  });
});
