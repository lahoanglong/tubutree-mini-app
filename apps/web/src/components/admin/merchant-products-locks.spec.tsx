// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { MerchantProductsTab } from './merchant-products-tab';

// Wave 96B: admin "Duyệt SP đối tác" (duyệt/từ chối, gỡ liên kết, xác nhận hàng ký gửi: quyết định về tiền của đối tác). Một việc mỗi lúc, giữ khoá tới khi
// danh sách làm mới về (tối đa 4 giây), bị từ chối vì trạng thái đã đổi thì tải lại và lời báo đứng ở cấp tab để không mất khi dòng biến mất.
// Chạy trên QueryClient trần (test-utils/dom), không có MutationCache của production: ở production mọi lệnh settle (kể cả lỗi) đều làm cũ khoá admin-*, nên "không tải lại"
// ở đây chỉ nói màn KHÔNG tự gọi tải lại và KHÔNG chờ nó. Quy tắc 400/404/409 chỉ quyết định việc chờ tải lại trước khi nhả khoá.

const PRODUCT = (id: string, name: string) => ({
  id,
  name,
  slug: id,
  basePrice: 150000,
  salePrice: null,
  thumbnail: null,
  brand: 'Nhà Xanh',
  category: 'Tinh dầu',
  description: null,
  ingredients: null,
  certifications: [],
  ecoBadges: [],
  approvalStatus: 'PENDING_REVIEW',
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-10-14T01:00:00.000Z',
});
const LINK = {
  id: 'l1',
  linkedAt: '2026-10-14T03:00:00.000Z',
  takeover: true,
  stockAtLink: 37,
  consignmentConfirmedAt: null,
  originProductId: 'po',
  product: { id: 'pm1', name: 'Tiêu đen Shop A', slug: 'tieu-den', thumbnail: null, isActive: true, approvalStatus: 'APPROVED', storefront: { id: 'sf-a', title: 'Shop A', subdomain: 'shopa' } },
  variation: { pancakeId: 'seed-200', name: '200g', stock: 150 },
  originProduct: { id: 'po', name: 'Tiêu đen Chư Sê', slug: 'tieu-den-chu-se', brand: 'BH.Nong', isActive: false },
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const page = (data: unknown[], total = data.length) => ({ data, meta: { page: 1, limit: 100, total } });
const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

type Route = () => Promise<Response> | Response;
let calls: { method: string; url: string }[] = [];
let routes: Record<string, Route> = {};
let pendingRows: unknown[] = [];
let linkedRows: unknown[] = [];
let mounted: Rendered | null = null;

beforeEach(() => {
  calls = [];
  pendingRows = [PRODUCT('p1', 'Tinh dầu sả chanh')];
  linkedRows = [];
  routes = {
    '/admin/merchant-products/pending': () => json(200, page(pendingRows)),
    '/admin/merchant-products/linked': () => json(200, page(linkedRows)),
    '/admin/merchant-products/p1/review': () => json(200, { id: 'p1', approvalStatus: 'APPROVED' }),
    '/admin/merchant-products/p2/review': () => json(200, { id: 'p2', approvalStatus: 'APPROVED' }),
    '/admin/merchant-products/pm1/unlink': () => json(200, { ok: true, originProductId: 'po' }),
    '/admin/merchant-fulfilment/links/l1/confirm-consignment': () => json(200, { id: 'l1', consignmentConfirmedAt: '2026-10-14T05:00:00.000Z' }),
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

const posts = (part: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(part)).length;
const gets = (part: string) => calls.filter((c) => c.method === 'GET' && c.url.includes(part)).length;
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
const approveBtn = (root: ParentNode) => btn(root, /Đang xử lý|Duyệt xuất bản/);
const alerts = (root: ParentNode) => Array.from(root.querySelectorAll('[role="alert"]')).map((a) => a.textContent ?? '');

async function mount() {
  mounted = render(<MerchantProductsTab />);
  await flush();
  return mounted.container;
}
const holdPendingReload = (g: { promise: Promise<void> }) => {
  let loads = 0;
  routes['/admin/merchant-products/pending'] = async () => {
    if (++loads > 1) await g.promise;
    return json(200, page(pendingRows));
  };
};
const holdLinkedReload = (g: { promise: Promise<void> }) => {
  let loads = 0;
  routes['/admin/merchant-products/linked'] = async () => {
    loads += 1;
    if (loads > 2) await g.promise;
    return json(200, page(linkedRows));
  };
};

describe('Duyệt / Từ chối sản phẩm đối tác', () => {
  it('chạm đúp cùng một khung hình chỉ gửi một lệnh duyệt; nút aria-busy/aria-disabled, không disabled (giữ focus)', async () => {
    const g = gate();
    routes['/admin/merchant-products/p1/review'] = async () => {
      await g.promise;
      return json(200, { id: 'p1', approvalStatus: 'APPROVED' });
    };
    const c = await mount();
    const approve = btn(c, 'Duyệt xuất bản');
    approve.focus();
    await tap(approve, approve);
    await flush(1);
    expect(posts('/p1/review')).toBe(1);
    expect(aria(btn(c, /Đang xử lý/))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(document.activeElement).toBe(btn(c, /Đang xử lý/));
    await tap(btn(c, /Đang xử lý/));
    expect(posts('/p1/review')).toBe(1);
    g.resolve();
    await flush();
  });

  it('giữ khoá tới khi danh sách làm mới về: bấm lại trong lúc chờ không gửi lệnh thứ hai; về rồi mới bấm được', async () => {
    const g = gate();
    holdPendingReload(g);
    const c = await mount();
    await tap(btn(c, 'Duyệt xuất bản'));
    await flush();
    expect(posts('/p1/review')).toBe(1);
    expect(gets('/merchant-products/pending')).toBe(2);
    expect(aria(approveBtn(c)).disabled).toBe('true');
    await tap(approveBtn(c));
    expect(posts('/p1/review')).toBe(1);
    g.resolve();
    await flush();
    expect(aria(approveBtn(c)).disabled).toBeNull();
    await tap(approveBtn(c));
    await flush();
    expect(posts('/p1/review')).toBe(2);
  });

  it('danh sách làm mới treo: lệnh hết "Đang xử lý" sau 4 giây, không sớm hơn (hàng vẫn khoá vì danh sách còn đang tải)', async () => {
    useHangTimers();
    holdPendingReload({ promise: new Promise(() => {}) });
    const c = await mount();
    await tap(btn(c, 'Duyệt xuất bản'));
    await flush();
    await advance(3_500);
    expect(byText(c, 'button', /Đang xử lý/)).not.toBeNull();
    await advance(700);
    expect(byText(c, 'button', /Đang xử lý/)).toBeNull();
    expect(aria(approveBtn(c)).disabled).toBe('true');
  });

  it('Xác nhận từ chối: chạm đúp chỉ gửi một lệnh, kèm lý do đã trim; nút aria-busy', async () => {
    const g = gate();
    routes['/admin/merchant-products/p1/review'] = async () => {
      await g.promise;
      return json(200, { id: 'p1', approvalStatus: 'REJECTED' });
    };
    const c = await mount();
    await tap(btn(c, 'Từ chối'));
    typeInto(c.querySelector('input[aria-label="Lý do từ chối"]'), '  Thiếu giấy tờ ');
    const confirm = btn(c, 'Xác nhận từ chối');
    await tap(confirm, confirm);
    await flush(1);
    expect(posts('/p1/review')).toBe(1);
    const call = calls.find((x) => x.method === 'POST')!;
    expect(call.url).toContain('/p1/review');
    expect(aria(btn(c, 'Xác nhận từ chối'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    g.resolve();
    await flush();
  });

  it('hai sản phẩm khác nhau duyệt cùng lúc không chặn nhau', async () => {
    pendingRows = [PRODUCT('p1', 'Tinh dầu sả chanh'), PRODUCT('p2', 'Xà phòng bồ hòn')];
    const g = gate();
    routes['/admin/merchant-products/p1/review'] = async () => {
      await g.promise;
      return json(200, {});
    };
    routes['/admin/merchant-products/p2/review'] = async () => {
      await g.promise;
      return json(200, {});
    };
    const c = await mount();
    const [a, b] = buttons(c, 'Duyệt xuất bản');
    await tap(a!, b!);
    await flush(1);
    expect(posts('/p1/review')).toBe(1);
    expect(posts('/p2/review')).toBe(1);
    g.resolve();
    await flush();
  });

  it('409: lời báo hiện ngay (khi danh sách còn đang tải lại), tải lại danh sách, khoá giữ tới khi danh sách về', async () => {
    const g = gate();
    holdPendingReload(g);
    routes['/admin/merchant-products/p1/review'] = () => json(409, { statusCode: 409, code: 'MERCHANT_PRODUCT_CONTENT_CHANGED', message: 'Đối tác vừa sửa.' });
    const c = await mount();
    await tap(btn(c, 'Duyệt xuất bản'));
    await flush();
    expect(gets('/merchant-products/pending')).toBe(2);
    expect(alerts(c).join('|')).toContain('Đối tác vừa sửa sản phẩm này sau lúc bạn mở danh sách');
    expect(aria(approveBtn(c)).disabled).toBe('true');
    await tap(approveBtn(c));
    expect(posts('/p1/review')).toBe(1);
    g.resolve();
    await flush();
    expect(aria(approveBtn(c)).disabled).toBeNull();
  });

  it('404 (sản phẩm không còn): tải lại danh sách; dòng biến mất thì lời báo vẫn còn ở đầu tab', async () => {
    routes['/admin/merchant-products/p1/review'] = () => json(404, { statusCode: 404, message: 'Không tìm thấy sản phẩm.' });
    let loads = 0;
    routes['/admin/merchant-products/pending'] = () => json(200, page(++loads === 1 ? pendingRows : []));
    const c = await mount();
    await tap(btn(c, 'Duyệt xuất bản'));
    await flush();
    await flush();
    expect(loads).toBe(2);
    expect(byText(c, 'button', 'Duyệt xuất bản')).toBeNull();
    expect(alerts(c).join('|')).toContain('Không tìm thấy sản phẩm');
  });

  it('500: màn không tự tải lại, báo lỗi dưới nút, nhả khoá để bấm lại', async () => {
    routes['/admin/merchant-products/p1/review'] = () => json(500, { statusCode: 500, message: 'Lỗi máy chủ.' });
    const c = await mount();
    await tap(btn(c, 'Duyệt xuất bản'));
    await flush();
    expect(gets('/merchant-products/pending')).toBe(1);
    expect(alerts(c).join('|')).toContain('Lỗi máy chủ.');
    expect(aria(btn(c, 'Duyệt xuất bản')).busy).toBeNull();
    await tap(btn(c, 'Duyệt xuất bản'));
    await flush();
    expect(posts('/p1/review')).toBe(2);
  });
});

describe('Gỡ liên kết mã Pancake', () => {
  beforeEach(() => {
    pendingRows = [];
    linkedRows = [{ ...LINK, takeover: false }];
  });
  const openUnlink = async (c: HTMLElement) => {
    await tap(btn(c, 'Gỡ liên kết'));
    typeInto(c.querySelector('input[aria-label="Lý do gỡ liên kết (gửi đối tác)"]'), 'Sai thương hiệu');
  };

  it('chạm đúp Xác nhận gỡ chỉ gửi một lệnh; nút aria-busy/aria-disabled, không disabled', async () => {
    const g = gate();
    routes['/admin/merchant-products/pm1/unlink'] = async () => {
      await g.promise;
      return json(200, { ok: true, originProductId: 'po' });
    };
    const c = await mount();
    await openUnlink(c);
    const confirm = btn(c, 'Xác nhận gỡ');
    confirm.focus();
    await tap(confirm, confirm);
    await flush(1);
    expect(posts('/pm1/unlink')).toBe(1);
    expect(aria(btn(c, /Đang gỡ/))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(document.activeElement).toBe(btn(c, /Đang gỡ/));
    g.resolve();
    await flush();
  });

  it('giữ khoá tới khi danh sách liên kết làm mới về', async () => {
    const g = gate();
    holdLinkedReload(g);
    const c = await mount();
    await openUnlink(c);
    await tap(btn(c, 'Xác nhận gỡ'));
    await flush();
    expect(posts('/pm1/unlink')).toBe(1);
    expect(aria(btn(c, /Đang gỡ/)).disabled).toBe('true');
    await tap(btn(c, /Đang gỡ/));
    expect(posts('/pm1/unlink')).toBe(1);
    g.resolve();
    await flush();
    expect(aria(btn(c, 'Xác nhận gỡ')).disabled).toBeNull();
  });

  it('danh sách liên kết làm mới treo: hết "Đang gỡ" sau 4 giây, không sớm hơn', async () => {
    useHangTimers();
    holdLinkedReload({ promise: new Promise(() => {}) });
    const c = await mount();
    await openUnlink(c);
    await tap(btn(c, 'Xác nhận gỡ'));
    await flush();
    await advance(3_500);
    expect(byText(c, 'button', /Đang gỡ/)).not.toBeNull();
    await advance(700);
    expect(byText(c, 'button', /Đang gỡ/)).toBeNull();
  });

  it('liên kết đã gỡ (400) hoặc không còn (404): tải lại hai danh sách; lời báo hiện ngay và còn ở đầu khối khi dòng biến mất', async () => {
    for (const status of [400, 404]) {
      calls = [];
      let linkedLoads = 0;
      routes['/admin/merchant-products/linked'] = () => json(200, page(++linkedLoads <= 2 ? linkedRows : []));
      routes['/admin/merchant-products/pm1/unlink'] = () => json(status, { statusCode: status, message: status === 400 ? 'Sản phẩm này không còn liên kết mã Pancake nào.' : 'Không tìm thấy sản phẩm.' });
      mounted?.unmount();
      const c = await mount();
      await openUnlink(c);
      const pendingBefore = gets('/merchant-products/pending');
      await tap(btn(c, 'Xác nhận gỡ'));
      await flush();
      await flush();
      expect(gets('/merchant-products/pending')).toBeGreaterThan(pendingBefore);
      expect(byText(c, 'button', 'Gỡ liên kết')).toBeNull();
      expect(byText(c, 'button', 'Xác nhận gỡ')).toBeNull();
      expect(alerts(c).join('|')).toMatch(status === 400 ? /không còn liên kết mã Pancake nào/ : /Không tìm thấy sản phẩm/);
    }
  });

  it('500: màn không tự tải lại, lỗi hiện dưới dòng, nhả khoá', async () => {
    routes['/admin/merchant-products/pm1/unlink'] = () => json(500, { statusCode: 500, message: 'Lỗi máy chủ.' });
    const c = await mount();
    await openUnlink(c);
    const before = gets('/merchant-products/linked');
    await tap(btn(c, 'Xác nhận gỡ'));
    await flush();
    expect(gets('/merchant-products/linked')).toBe(before);
    expect(c.textContent).toContain('Lỗi máy chủ.');
    expect(aria(btn(c, 'Xác nhận gỡ')).busy).toBeNull();
  });
});

describe('Xác nhận hàng ký gửi', () => {
  beforeEach(() => {
    pendingRows = [];
    linkedRows = [LINK];
  });
  const openAsk = async (c: HTMLElement) => {
    await tap(byText(c, 'button', 'Xác nhận hàng ký gửi')!);
  };

  it('chạm đúp Xác nhận ký gửi chỉ gửi một lệnh; nút aria-busy/aria-disabled, không disabled', async () => {
    const g = gate();
    routes['/admin/merchant-fulfilment/links/l1/confirm-consignment'] = async () => {
      await g.promise;
      return json(200, { id: 'l1', consignmentConfirmedAt: '2026-10-14T05:00:00.000Z' });
    };
    const c = await mount();
    await openAsk(c);
    const confirm = btn(c, 'Xác nhận ký gửi');
    confirm.focus();
    await tap(confirm, confirm);
    await flush(1);
    expect(posts('/confirm-consignment')).toBe(1);
    expect(aria(btn(c, /Đang xác nhận/))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(document.activeElement).toBe(btn(c, /Đang xác nhận/));
    g.resolve();
    await flush();
  });

  it('giữ khoá tới khi danh sách liên kết làm mới về', async () => {
    const g = gate();
    holdLinkedReload(g);
    const c = await mount();
    await openAsk(c);
    await tap(btn(c, 'Xác nhận ký gửi'));
    await flush();
    expect(posts('/confirm-consignment')).toBe(1);
    expect(aria(btn(c, /Đang xác nhận/)).disabled).toBe('true');
    await tap(btn(c, /Đang xác nhận/));
    expect(posts('/confirm-consignment')).toBe(1);
    g.resolve();
    await flush();
    expect(byText(c, 'button', 'Xác nhận hàng ký gửi')).not.toBeNull();
  });

  it('danh sách liên kết làm mới treo: hết "Đang xác nhận" sau 4 giây, không sớm hơn', async () => {
    useHangTimers();
    holdLinkedReload({ promise: new Promise(() => {}) });
    const c = await mount();
    await openAsk(c);
    await tap(btn(c, 'Xác nhận ký gửi'));
    await flush();
    await advance(3_500);
    expect(byText(c, 'button', /Đang xác nhận/)).not.toBeNull();
    await advance(700);
    expect(byText(c, 'button', /Đang xác nhận/)).toBeNull();
  });

  it('liên kết đã gỡ (400) / không còn (404): tải lại danh sách liên kết, lời báo hiện ngay và còn lại khi dòng biến mất', async () => {
    for (const status of [400, 404]) {
      calls = [];
      let linkedLoads = 0;
      routes['/admin/merchant-products/linked'] = () => json(200, page(++linkedLoads <= 2 ? linkedRows : []));
      routes['/admin/merchant-fulfilment/links/l1/confirm-consignment'] = () => json(status, { statusCode: status, message: status === 400 ? 'Liên kết đã gỡ.' : 'Không tìm thấy liên kết.' });
      mounted?.unmount();
      const c = await mount();
      await openAsk(c);
      const before = gets('/merchant-products/linked');
      await tap(btn(c, 'Xác nhận ký gửi'));
      await flush();
      await flush();
      expect(gets('/merchant-products/linked')).toBeGreaterThan(before);
      expect(byText(c, 'button', 'Xác nhận ký gửi')).toBeNull();
      expect(byText(c, 'button', 'Xác nhận hàng ký gửi')).toBeNull();
      expect(alerts(c).join('|')).toMatch(status === 400 ? /Liên kết đã gỡ/ : /Không tìm thấy liên kết/);
    }
  });

  it('500: màn không tự tải lại, lỗi dưới khối, nhả khoá', async () => {
    routes['/admin/merchant-fulfilment/links/l1/confirm-consignment'] = () => json(500, { statusCode: 500, message: 'Lỗi máy chủ.' });
    const c = await mount();
    await openAsk(c);
    const before = gets('/merchant-products/linked');
    await tap(btn(c, 'Xác nhận ký gửi'));
    await flush();
    expect(gets('/merchant-products/linked')).toBe(before);
    expect(c.textContent).toContain('Lỗi máy chủ.');
    expect(aria(btn(c, 'Xác nhận ký gửi')).busy).toBeNull();
  });
});

describe('Tải thêm và Thử lại', () => {
  it('Tải thêm: chạm đúp cùng khung hình chỉ tải một trang; nút aria-busy, không disabled', async () => {
    pendingRows = [PRODUCT('p1', 'Tinh dầu sả chanh')];
    const g = gate();
    let loads = 0;
    routes['/admin/merchant-products/pending'] = async () => {
      loads += 1;
      if (loads > 1) await g.promise;
      return json(200, { data: pendingRows, meta: { page: loads, limit: 100, total: 250 } });
    };
    const c = await mount();
    const more = btn(c, 'Tải thêm');
    more.focus();
    await tap(more, more);
    await flush(1);
    expect(loads).toBe(2);
    expect(aria(btn(c, /Đang tải…/))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    g.resolve();
    await flush();
  });

  it('Thử lại sau lỗi tải danh sách: chạm đúp chỉ tải lại một lần', async () => {
    let loads = 0;
    const g = gate();
    routes['/admin/merchant-products/pending'] = async () => {
      loads += 1;
      if (loads === 1) return json(500, { message: 'hỏng' });
      await g.promise;
      return json(200, page([]));
    };
    const c = await mount();
    const retry = btn(c, 'Thử lại');
    await tap(retry, retry);
    await flush(1);
    expect(loads).toBe(2);
    g.resolve();
    await flush();
  });
});
