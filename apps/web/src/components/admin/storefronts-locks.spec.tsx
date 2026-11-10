// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerAsk, answerConfirm, byText, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';
import { StorefrontsTab } from './storefronts-tab';
import type { AdminStorefrontDetail, AdminStorefrontRow } from '@/lib/admin-storefronts-client';

// Wave 96B: admin "Gian hàng" (duyệt/Bỏ duyệt, Gỡ đăng, Đăng lại, Đã xem). Một việc mỗi lúc, giữ khoá tới khi danh sách làm mới về (tối đa 4 giây),
// bị từ chối vì dữ liệu đã cũ (400/404/409) thì tải lại, nút giữ focus dùng aria-busy/aria-disabled thay disabled.
// Gỡ đăng có ô lý do người dùng nhập: 400 là lỗi nhập, chỉ hiện trong ngăn và không tải lại; chỉ 404/409 là dữ liệu cũ.

const ROW = (over: Partial<AdminStorefrontRow> = {}): AdminStorefrontRow => ({
  id: 's1', slug: 'linh123', title: 'Shop của Linh', type: 'CTV', isPartner: false, isPublished: true, publishedAt: '2026-10-01T00:00:00.000Z',
  approved: false, approvedAt: null, contentChangedAt: null, takenDownAt: null, takenDownReason: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
  ownerUserId: 'u1', owner: { id: 'u1', fullName: 'Linh', phone: '0900000001', role: 'AFFILIATE', isBlocked: false },
  itemCount: 3, publicVisible: true, hiddenReason: null,
  ...over,
});
const DETAIL = (over: Partial<AdminStorefrontDetail> = {}): AdminStorefrontDetail => ({
  ...ROW({ itemCount: 1 }), headerNote: 'Hàng sống xanh', avatarUrl: null, coverUrl: null, subdomain: null, collections: [],
  ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

type Route = () => Promise<Response> | Response;
let calls: { method: string; url: string }[] = [];
let routes: Record<string, Route> = {};
let rows: AdminStorefrontRow[] = [];
let detail: AdminStorefrontDetail = DETAIL();
let mounted: Rendered | null = null;

beforeEach(() => {
  calls = [];
  rows = [ROW()];
  detail = DETAIL();
  routes = {
    '/admin/storefronts?': () => json(200, { data: rows, meta: { page: 1, limit: 50, total: rows.length }, changedAfterApproval: 0 }),
    '/admin/storefronts/s1': () => json(200, detail),
    '/admin/storefronts/s1/approval': () => json(200, ROW()),
    '/admin/storefronts/s1/take-down': () => json(200, ROW()),
    '/admin/storefronts/s1/reinstate': () => json(200, ROW()),
    '/admin/storefronts/s1/content-seen': () => json(200, ROW()),
    '/admin/ops/inbox': () => json(200, { generatedAt: '2026-10-28T03:00:00.000Z', items: [] }),
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
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const posts = (part: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(part)).length;
const listGets = () => calls.filter((c) => c.method === 'GET' && c.url.includes('/admin/storefronts?')).length;
const detailGets = () => calls.filter((c) => c.method === 'GET' && c.url.endsWith('/admin/storefronts/s1')).length;
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
const alerts = (root: ParentNode) => Array.from(root.querySelectorAll('[role="alert"]')).map((a) => a.textContent ?? '');
const drawer = () => document.body.querySelector<HTMLElement>('[role="dialog"]')!;

async function mount() {
  mounted = render(<StorefrontsTab />);
  await flush();
  return mounted.container;
}
async function openDrawer(c: HTMLElement) {
  click(byText(c, 'button', 'Xem'));
  await flush();
  return drawer();
}
const holdListReload = (g: { promise: Promise<void> }) => {
  let loads = 0;
  routes['/admin/storefronts?'] = async () => {
    if (++loads > 1) await g.promise;
    return json(200, { data: rows, meta: { page: 1, limit: 50, total: rows.length }, changedAfterApproval: 0 });
  };
};

describe('Duyệt nhanh và Đã xem trên thẻ danh sách', () => {
  it('chạm đúp Duyệt cùng một khung hình chỉ gửi một lệnh; nút aria-busy/aria-disabled, không disabled', async () => {
    const g = gate();
    routes['/admin/storefronts/s1/approval'] = async () => {
      await g.promise;
      return json(200, ROW());
    };
    const c = await mount();
    const approve = btn(c, 'Duyệt');
    approve.focus();
    await tap(approve, approve);
    await flush(1);
    expect(posts('/s1/approval')).toBe(1);
    expect(aria(btn(c, 'Duyệt'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(document.activeElement).toBe(btn(c, 'Duyệt'));
    g.resolve();
    await flush();
  });

  it('giữ khoá tới khi danh sách làm mới về', async () => {
    const g = gate();
    holdListReload(g);
    const c = await mount();
    await tap(btn(c, 'Duyệt'));
    await flush();
    expect(posts('/s1/approval')).toBe(1);
    expect(aria(btn(c, 'Duyệt')).disabled).toBe('true');
    await tap(btn(c, 'Duyệt'));
    expect(posts('/s1/approval')).toBe(1);
    g.resolve();
    await flush();
    expect(aria(btn(c, 'Duyệt')).disabled).toBeNull();
  });

  it('danh sách làm mới treo: nhả khoá sau 4 giây, không sớm hơn', async () => {
    useHangTimers();
    holdListReload({ promise: new Promise(() => {}) });
    const c = await mount();
    await tap(btn(c, 'Duyệt'));
    await flush();
    await advance(3_500);
    expect(aria(btn(c, 'Duyệt')).disabled).toBe('true');
    await advance(700);
    expect(aria(btn(c, 'Duyệt')).disabled).toBeNull();
  });

  it('gian hàng không còn (404): tải lại danh sách, lời báo hiện ngay và còn lại khi thẻ biến mất; 500 thì mã không tự tải lại (QueryClient trần, chưa có MutationCache của production)', async () => {
    routes['/admin/storefronts/s1/approval'] = () => json(404, { statusCode: 404, message: 'Không tìm thấy gian hàng.' });
    let loads = 0;
    routes['/admin/storefronts?'] = () => json(200, { data: ++loads === 1 ? rows : [], meta: { page: 1, limit: 50, total: 0 }, changedAfterApproval: 0 });
    const c = await mount();
    await tap(btn(c, 'Duyệt'));
    await flush();
    await flush();
    expect(loads).toBe(2);
    expect(c.querySelector('article')).toBeNull();
    expect(alerts(c).join('|')).toContain('Không tìm thấy gian hàng.');

    routes['/admin/storefronts/s1/approval'] = () => json(500, { statusCode: 500, message: 'Lỗi máy chủ.' });
    routes['/admin/storefronts?'] = () => json(200, { data: rows, meta: { page: 1, limit: 50, total: 1 }, changedAfterApproval: 0 });
    mounted?.unmount();
    const c2 = await mount();
    const before = listGets();
    await tap(btn(c2, 'Duyệt'));
    await flush();
    expect(listGets()).toBe(before);
    expect(alerts(c2).join('|')).toContain('Lỗi máy chủ');
    expect(aria(btn(c2, 'Duyệt')).busy).toBeNull();
  });

  it('Đã xem: chạm đúp chỉ gửi một lệnh; nút aria, không disabled', async () => {
    rows = [ROW({ approved: true, approvedAt: '2026-10-01T00:00:00.000Z', contentChangedAt: '2026-10-20T03:30:00.000Z' })];
    const g = gate();
    routes['/admin/storefronts/s1/content-seen'] = async () => {
      await g.promise;
      return json(200, ROW({ approved: true }));
    };
    const c = await mount();
    const seen = btn(c, 'Đã xem');
    await tap(seen, seen);
    await flush(1);
    expect(posts('/content-seen')).toBe(1);
    expect(aria(btn(c, 'Đã xem'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    g.resolve();
    await flush();
  });
});

describe('Ngăn chi tiết: Duyệt gian hàng, Bỏ duyệt, Gỡ đăng, Đăng lại, Đã xem', () => {
  it('Duyệt gian hàng: chạm đúp chỉ gửi một lệnh; mọi nút hành động aria-disabled, không disabled', async () => {
    const g = gate();
    routes['/admin/storefronts/s1/approval'] = async () => {
      await g.promise;
      return json(200, ROW());
    };
    const c = await mount();
    const d = await openDrawer(c);
    const approve = btn(d, 'Duyệt gian hàng');
    approve.focus();
    await tap(approve, approve);
    await flush(1);
    expect(posts('/s1/approval')).toBe(1);
    expect(aria(btn(d, 'Duyệt gian hàng'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(aria(btn(d, 'Gỡ đăng')).disabled).toBe('true');
    expect(document.activeElement).toBe(btn(d, 'Duyệt gian hàng'));
    g.resolve();
    await flush();
  });

  it('giữ khoá tới khi chi tiết và danh sách làm mới về; hạn 4 giây', async () => {
    useHangTimers();
    let detailLoads = 0;
    routes['/admin/storefronts/s1'] = () => {
      if (++detailLoads > 1) return new Promise<Response>(() => {});
      return json(200, detail);
    };
    const c = await mount();
    const d = await openDrawer(c);
    await tap(btn(d, 'Duyệt gian hàng'));
    await flush();
    await advance(3_500);
    expect(aria(btn(d, 'Duyệt gian hàng')).disabled).toBe('true');
    await tap(btn(d, 'Duyệt gian hàng'));
    expect(posts('/s1/approval')).toBe(1);
    await advance(700);
    expect(aria(btn(d, 'Duyệt gian hàng')).disabled).toBeNull();
  });

  it('Gỡ đăng: hỏi lý do, gửi một lệnh dù bấm nút hai lần; trong lúc ghi sổ bấm Gỡ đăng không mở hộp thoại', async () => {
    const g = gate();
    routes['/admin/storefronts/s1/take-down'] = async () => {
      await g.promise;
      return json(200, ROW());
    };
    const c = await mount();
    const d = await openDrawer(c);
    click(btn(d, 'Gỡ đăng'));
    await flush();
    answerAsk('Dùng ảnh của nhãn khác');
    await flush(3);
    expect(posts('/take-down')).toBe(1);
    expect(aria(btn(d, 'Gỡ đăng'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    click(btn(d, 'Gỡ đăng'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(posts('/take-down')).toBe(1);
    g.resolve();
    await flush();
  });

  it('Gỡ đăng bị máy chủ báo 400 (lý do không hợp lệ): lời lỗi trong ngăn, KHÔNG tải lại chi tiết hay danh sách, nhả khoá ngay để sửa lý do', async () => {
    routes['/admin/storefronts/s1/take-down'] = () => json(400, { statusCode: 400, message: 'Cần nhập lý do gỡ đăng để báo chủ gian hàng.' });
    const c = await mount();
    const d = await openDrawer(c);
    const list0 = listGets();
    const detail0 = detailGets();
    click(btn(d, 'Gỡ đăng'));
    await flush();
    answerAsk('Lý do hợp lệ với giao diện');
    await flush(3);
    expect(posts('/take-down')).toBe(1);
    expect(alerts(d).join('|')).toContain('Cần nhập lý do gỡ đăng');
    expect(detailGets()).toBe(detail0);
    expect(listGets()).toBe(list0);
    expect(aria(btn(d, 'Gỡ đăng')).busy).toBeNull();
  });

  it.each([404, 409])('Gỡ đăng bị máy chủ báo %i (gian hàng không còn / đã đổi): vẫn là dữ liệu cũ, tải lại chi tiết và danh sách', async (status) => {
    routes['/admin/storefronts/s1/take-down'] = () => json(status, { statusCode: status, message: 'Gian hàng đã được xử lý ở nơi khác.' });
    const c = await mount();
    const d = await openDrawer(c);
    const list0 = listGets();
    const detail0 = detailGets();
    click(btn(d, 'Gỡ đăng'));
    await flush();
    answerAsk('Dùng ảnh của nhãn khác');
    await flush(3);
    expect(alerts(d).join('|')).toContain('Gian hàng đã được xử lý ở nơi khác.');
    expect(detailGets()).toBeGreaterThan(detail0);
    expect(listGets()).toBeGreaterThan(list0);
  });

  it('Bỏ duyệt (không có ô nhập) bị báo 400 vì gian hàng đã đổi loại: vẫn là dữ liệu cũ, tải lại chi tiết và danh sách', async () => {
    detail = DETAIL({ approved: true, approvedAt: '2026-10-01T00:00:00.000Z' });
    routes['/admin/storefronts/s1/approval'] = () => json(400, { statusCode: 400, message: 'Chỉ gian hàng CTV mới cần duyệt.' });
    const c = await mount();
    const d = await openDrawer(c);
    const detail0 = detailGets();
    click(btn(d, 'Bỏ duyệt'));
    await flush();
    answerConfirm(true);
    await flush(3);
    expect(alerts(d).join('|')).toContain('Chỉ gian hàng CTV mới cần duyệt.');
    expect(detailGets()).toBeGreaterThan(detail0);
  });

  it('Đăng lại và Đã xem (không có ô nhập) bị báo 400 vì gian hàng đã đổi: vẫn là dữ liệu cũ, tải lại chi tiết', async () => {
    detail = DETAIL({ isPublished: false, publicVisible: false, takenDownAt: '2026-10-05T00:00:00.000Z', takenDownReason: 'Ảnh vi phạm' });
    routes['/admin/storefronts/s1/reinstate'] = () => json(400, { statusCode: 400, message: 'Gian hàng không ở trạng thái đã gỡ.' });
    const c = await mount();
    const d = await openDrawer(c);
    const detail0 = detailGets();
    click(btn(d, 'Đăng lại'));
    await flush();
    answerConfirm(true);
    await flush(3);
    expect(alerts(d).join('|')).toContain('Gian hàng không ở trạng thái đã gỡ.');
    expect(detailGets()).toBeGreaterThan(detail0);
  });

  it('Đã xem trong ngăn bị báo 400: vẫn là dữ liệu cũ, tải lại chi tiết', async () => {
    detail = DETAIL({ approved: true, approvedAt: '2026-10-01T00:00:00.000Z', contentChangedAt: '2026-10-20T03:30:00.000Z' });
    rows = [ROW({ approved: true })];
    routes['/admin/storefronts/s1/content-seen'] = () => json(400, { statusCode: 400, message: 'Mốc đã xem không hợp lệ.' });
    const c = await mount();
    const d = await openDrawer(c);
    const detail0 = detailGets();
    await tap(btn(d, 'Đã xem'));
    await flush();
    expect(alerts(d).join('|')).toContain('Mốc đã xem không hợp lệ.');
    expect(detailGets()).toBeGreaterThan(detail0);
  });

  it('Bỏ duyệt và Đăng lại: không mở hộp xác nhận khi đang ghi sổ', async () => {
    detail = DETAIL({ approved: true, approvedAt: '2026-10-01T00:00:00.000Z' });
    const g = gate();
    routes['/admin/storefronts/s1/approval'] = async () => {
      await g.promise;
      return json(200, ROW());
    };
    const c = await mount();
    const d = await openDrawer(c);
    click(btn(d, 'Bỏ duyệt'));
    await flush();
    answerConfirm(true);
    await flush(3);
    expect(posts('/s1/approval')).toBe(1);
    click(btn(d, 'Bỏ duyệt'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    g.resolve();
    await flush();
  });

  it('Đăng lại: chạm đúp chỉ gửi một lệnh', async () => {
    detail = DETAIL({ isPublished: false, publicVisible: false, takenDownAt: '2026-10-05T00:00:00.000Z', takenDownReason: 'Ảnh vi phạm' });
    const g = gate();
    routes['/admin/storefronts/s1/reinstate'] = async () => {
      await g.promise;
      return json(200, ROW());
    };
    const c = await mount();
    const d = await openDrawer(c);
    click(btn(d, 'Đăng lại'));
    await flush();
    answerConfirm(true);
    await flush(3);
    expect(posts('/reinstate')).toBe(1);
    expect(aria(btn(d, 'Đăng lại'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    click(btn(d, 'Đăng lại'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(posts('/reinstate')).toBe(1);
    g.resolve();
    await flush();
  });

  it('Đã xem trong ngăn: chạm đúp chỉ gửi một lệnh', async () => {
    detail = DETAIL({ approved: true, approvedAt: '2026-10-01T00:00:00.000Z', contentChangedAt: '2026-10-20T03:30:00.000Z' });
    rows = [ROW({ approved: true })];
    const g = gate();
    routes['/admin/storefronts/s1/content-seen'] = async () => {
      await g.promise;
      return json(200, ROW({ approved: true }));
    };
    const c = await mount();
    const d = await openDrawer(c);
    const seen = btn(d, 'Đã xem');
    await tap(seen, seen);
    await flush(1);
    expect(posts('/content-seen')).toBe(1);
    expect(aria(btn(d, 'Đã xem')).disabled).toBe('true');
    g.resolve();
    await flush();
  });

  it('gian hàng không còn (404): lời báo hiện ngay trong ngăn, tải lại chi tiết và danh sách; 403 thì mã không tự tải lại (QueryClient trần, chưa có MutationCache của production)', async () => {
    routes['/admin/storefronts/s1/approval'] = () => json(404, { statusCode: 404, message: 'Không tìm thấy gian hàng.' });
    const c = await mount();
    const d = await openDrawer(c);
    const list0 = listGets();
    const detail0 = detailGets();
    await tap(btn(d, 'Duyệt gian hàng'));
    await flush();
    expect(alerts(d).join('|')).toContain('Không tìm thấy gian hàng.');
    expect(detailGets()).toBeGreaterThan(detail0);
    expect(listGets()).toBeGreaterThan(list0);
    expect(aria(btn(d, 'Duyệt gian hàng')).busy).toBeNull();

    routes['/admin/storefronts/s1/approval'] = () => json(403, { statusCode: 403, message: 'Không đủ quyền.' });
    const list1 = listGets();
    const detail1 = detailGets();
    await tap(btn(d, 'Duyệt gian hàng'));
    await flush();
    expect(alerts(d).join('|')).toContain('Không đủ quyền.');
    expect(detailGets()).toBe(detail1);
    expect(listGets()).toBe(list1);
  });
});

describe('Tải thêm và Thử lại', () => {
  it('Tải thêm: chạm đúp cùng khung hình chỉ tải một trang; nút aria-busy, không disabled', async () => {
    const g = gate();
    let loads = 0;
    routes['/admin/storefronts?'] = async () => {
      loads += 1;
      if (loads > 1) await g.promise;
      return json(200, { data: rows, meta: { page: loads, limit: 50, total: 120 }, changedAfterApproval: 0 });
    };
    const c = await mount();
    const more = btn(c, /Tải thêm/);
    more.focus();
    await tap(more, more);
    await flush(1);
    expect(loads).toBe(2);
    expect(aria(btn(c, /Đang tải…/))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    g.resolve();
    await flush();
  });
});
