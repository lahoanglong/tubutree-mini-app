// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { ShiftApprovalTab } from './shift-approval-tab';
import { answerAsk, answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// W79B: khoá đồng bộ cho duyệt/từ chối/duyệt tất cả/ca chuẩn (Mini ↔ web, W79A). Mỗi cú gọi mạng có thể giữ lại bằng một cổng.

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<ShiftApprovalTab />);
  mounted.push(r);
  await flush();
  return r.container;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const staff = { id: 's1', fullName: 'Lan', phone: '0911111111', avatarUrl: null };
const shift = (id: string, status = 'PENDING') => ({
  id,
  staffId: 's1',
  staff,
  workDate: '2026-10-19T00:00:00.000Z',
  startAt: '2026-10-19T01:00:00.000Z',
  endAt: '2026-10-19T05:00:00.000Z',
  templateId: null,
  status,
  approvedStart: null,
  approvedEnd: null,
  rejectReason: null,
  cancelReason: null,
  isEmergency: false,
  evidenceUrl: null,
  cancelPenalty: false,
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

type Gates = {
  approve?: Record<string, Promise<void>>;
  reject?: Record<string, Promise<void>>;
  bulk?: Promise<void>;
  /** Giữ lần tải lại danh sách ca SAU lần đầu. */
  list?: Promise<void>;
  tplAdd?: Promise<void>;
  tplDelete?: Promise<void>;
  /** Giữ lần tải lại danh sách ca chuẩn SAU lần đầu. */
  tplList?: Promise<void>;
  /** Lỗi 500 cho lệnh POST có đường dẫn chứa chuỗi này (một lần). */
  failOnce?: string;
};

function stub(shifts: unknown[], templates: unknown[] = [], gates: Gates = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let listLoads = 0;
  let tplLoads = 0;
  let failed = false;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (gates.failOnce && method === 'POST' && url.includes(gates.failOnce) && !failed) {
        failed = true;
        return json({ message: 'Máy chủ đang bận' }, 500);
      }
      if (method === 'POST' && url.includes('bulk-approve')) {
        await gates.bulk;
        return json({ approved: 2 });
      }
      const id = /\/admin\/shifts\/([^/]+)\/(approve|reject)/.exec(url);
      if (method === 'POST' && id) {
        await (id[2] === 'approve' ? gates.approve?.[id[1]!] : gates.reject?.[id[1]!]);
        return json({ ok: true });
      }
      if (method === 'POST' && url.includes('/admin/shift-templates')) {
        await gates.tplAdd;
        return json({ id: 't9' });
      }
      if (method === 'DELETE') {
        await gates.tplDelete;
        return json({ deleted: true });
      }
      if (url.includes('/admin/shift-templates')) {
        tplLoads += 1;
        if (tplLoads > 1) await gates.tplList;
        return json(templates);
      }
      listLoads += 1;
      if (listLoads > 1) await gates.list;
      return json(shifts);
    }),
  );
  return { calls, to: (p: string, m = 'POST') => calls.filter((c) => c.url.includes(p) && c.method === m) };
}

const approveBtn = (c: HTMLElement, i = 0) => c.querySelectorAll<HTMLButtonElement>('[aria-label^="Duyệt ca"]')[i]!;
const rejectBtn = (c: HTMLElement, i = 0) => c.querySelectorAll<HTMLButtonElement>('[aria-label^="Từ chối ca"]')[i]!;
const bulkBtn = (c: HTMLElement) => byText(c, 'button', /^Duyệt tất cả/) as HTMLButtonElement;
const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};

describe('ShiftApprovalTab: duyệt một ca', () => {
  it('chạm đúp "Duyệt" cùng một khung hình chỉ gửi một lệnh; nút aria-busy + aria-disabled, không disabled; xong thì ca hết nút', async () => {
    const gate = deferred();
    const api = stub([shift('a')], [], { approve: { a: gate.promise } });
    const c = await mount();
    await tap(approveBtn(c), approveBtn(c));
    await flush(1);
    expect(api.to('/admin/shifts/a/approve')).toHaveLength(1);
    const b = approveBtn(c);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    expect(rejectBtn(c).getAttribute('aria-disabled')).toBe('true');
    gate.resolve();
    await flush();
    expect(c.textContent).toContain('Đã duyệt ca.');
  });

  it('khoá giữ tới khi danh sách ca mới về: duyệt xong mà danh sách chưa làm mới thì nút vẫn bận, không gửi lần hai', async () => {
    const list = deferred();
    const api = stub([shift('a')], [], { list: list.promise });
    const c = await mount();
    click(approveBtn(c));
    await flush();
    expect(api.to('/admin/shifts/a/approve')).toHaveLength(1);
    expect(approveBtn(c).getAttribute('aria-busy')).toBe('true');
    await tap(approveBtn(c));
    expect(api.to('/admin/shifts/a/approve')).toHaveLength(1);
    list.resolve();
    await flush();
    expect(approveBtn(c).hasAttribute('aria-busy')).toBe(false);
  });

  it('lệnh lỗi nhả khoá: báo trong vùng alert và bấm lại gửi được lần hai', async () => {
    const api = stub([shift('a')], [], { failOnce: '/approve' });
    const c = await mount();
    click(approveBtn(c));
    await flush();
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(approveBtn(c).hasAttribute('aria-busy')).toBe(false);
    click(approveBtn(c));
    await flush();
    expect(api.to('/admin/shifts/a/approve')).toHaveLength(2);
    expect(c.textContent).toContain('Đã duyệt ca.');
  });

  it('hai ca khác nhau duyệt song song; ca B xong trước thì ca A vẫn hiện bận', async () => {
    const a = deferred();
    const b = deferred();
    const api = stub([shift('a'), shift('b')], [], { approve: { a: a.promise, b: b.promise } });
    const c = await mount();
    await tap(approveBtn(c, 0), approveBtn(c, 1));
    await flush(1);
    expect(api.to('/approve')).toHaveLength(2);
    b.resolve();
    await flush();
    expect(approveBtn(c, 0).getAttribute('aria-busy')).toBe('true');
    a.resolve();
    await flush();
    expect(c.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

describe('ShiftApprovalTab: duyệt, từ chối và duyệt tất cả loại trừ nhau', () => {
  it('một ca đang duyệt: "Duyệt tất cả" aria-disabled (không disabled) tới khi xong, rồi bỏ', async () => {
    const gate = deferred();
    stub([shift('a'), shift('b')], [], { approve: { a: gate.promise } });
    const c = await mount();
    expect(bulkBtn(c).hasAttribute('aria-disabled')).toBe(false);
    click(approveBtn(c, 0));
    await flush(2);
    expect(bulkBtn(c).getAttribute('aria-disabled')).toBe('true');
    expect(bulkBtn(c).getAttribute('aria-busy')).toBe('true');
    expect(bulkBtn(c).disabled).toBe(false);
    gate.resolve();
    await flush();
    expect(bulkBtn(c).hasAttribute('aria-disabled')).toBe(false);
  });

  it('ca đang duyệt: bấm "Từ chối" không mở hộp thoại', async () => {
    const gate = deferred();
    stub([shift('a')], [], { approve: { a: gate.promise } });
    const c = await mount();
    click(approveBtn(c));
    await flush(1);
    click(rejectBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    gate.resolve();
    await flush();
  });

  it('hộp từ chối đã mở, trong lúc đó ca bị duyệt: xác nhận từ chối bị bỏ, không gửi /reject', async () => {
    const gate = deferred();
    const api = stub([shift('a')], [], { approve: { a: gate.promise } });
    const c = await mount();
    click(rejectBtn(c));
    await flush();
    click(approveBtn(c));
    await flush(1);
    answerAsk('Trùng lịch');
    await flush();
    expect(api.to('/admin/shifts/a/reject')).toHaveLength(0);
    gate.resolve();
    await flush();
  });

  it('từ chối: chạm đúp xác nhận gửi một lệnh, rồi nhả khoá', async () => {
    const api = stub([shift('a')]);
    const c = await mount();
    click(rejectBtn(c));
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea'), 'Trùng lịch');
    await act(async () => {
      const accept = confirmDialog()!.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!;
      accept.click();
      accept.click();
    });
    await flush();
    expect(api.to('/admin/shifts/a/reject')).toHaveLength(1);
    expect(c.textContent).toContain('Đã từ chối ca.');
  });

  it('"Duyệt tất cả" đang chạy: nút của từng ca bận và bấm vào không gửi /approve', async () => {
    const gate = deferred();
    const api = stub([shift('a'), shift('b')], [], { bulk: gate.promise });
    const c = await mount();
    click(bulkBtn(c));
    await flush();
    answerConfirm(true);
    await flush(1);
    expect(api.to('/bulk-approve')).toHaveLength(1);
    expect(bulkBtn(c).getAttribute('aria-busy')).toBe('true');
    expect(approveBtn(c, 0).getAttribute('aria-busy')).toBe('true');
    expect(approveBtn(c, 1).getAttribute('aria-busy')).toBe('true');
    await tap(approveBtn(c, 0), rejectBtn(c, 1), bulkBtn(c));
    expect(api.to('/approve')).toHaveLength(0);
    expect(confirmDialog()).toBeNull();
    gate.resolve();
    await flush();
    expect(c.textContent).toContain('Đã duyệt 2 ca.');
    expect(bulkBtn(c).hasAttribute('aria-busy')).toBe(false);
  });

  it('một ca đang duyệt: "Duyệt tất cả" không mở hộp thoại; hộp đã mở rồi mà ca bị duyệt thì xác nhận bị bỏ', async () => {
    const gate = deferred();
    const api = stub([shift('a'), shift('b')], [], { approve: { a: gate.promise } });
    const c = await mount();
    click(approveBtn(c, 0));
    await flush(1);
    click(bulkBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    gate.resolve();
    await flush();
    // Hộp mở trước, ca duyệt sau.
    click(bulkBtn(c));
    await flush();
    const gate2 = deferred();
    api.calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        api.calls.push({ url, method: init?.method ?? 'GET' });
        if (init?.method === 'POST' && url.includes('/approve')) await gate2.promise;
        return new Response(JSON.stringify(init?.method === 'POST' ? { ok: true } : [shift('a'), shift('b')]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    click(approveBtn(c, 1));
    await flush(1);
    answerConfirm(true);
    await flush();
    expect(api.calls.filter((x) => x.url.includes('bulk-approve'))).toHaveLength(0);
    gate2.resolve();
    await flush();
  });
});

describe('ShiftApprovalTab: tờ chỉnh giờ & duyệt', () => {
  const openAdjust = async (c: HTMLElement) => {
    click(c.querySelector('[aria-label^="Chỉnh giờ"]'));
    await flush();
  };
  const footerBtn = () => byText(document.body, 'button', 'Duyệt với giờ đã chỉnh') as HTMLButtonElement;

  it('chạm đúp "Duyệt với giờ đã chỉnh" gửi một lệnh; đang gửi thì Esc không đóng tờ, nút không disabled', async () => {
    const gate = deferred();
    const api = stub([shift('a')], [], { approve: { a: gate.promise } });
    const c = await mount();
    await openAdjust(c);
    await tap(footerBtn(), footerBtn());
    await flush(1);
    expect(api.to('/admin/shifts/a/approve')).toHaveLength(1);
    expect(footerBtn().getAttribute('aria-busy')).toBe('true');
    expect(footerBtn().getAttribute('aria-disabled')).toBe('true');
    expect(footerBtn().disabled).toBe(false);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    gate.resolve();
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('duyệt ca B xong không đóng tờ chỉnh giờ của ca A đang gõ dở, giờ gõ còn nguyên', async () => {
    const gate = deferred();
    const api = stub([shift('a'), shift('b')], [], { approve: { b: gate.promise } });
    const c = await mount();
    click(approveBtn(c, 1));
    await flush(2);
    expect(api.to('/admin/shifts/b/approve')).toHaveLength(1);
    click(c.querySelectorAll('[aria-label^="Chỉnh giờ"]')[0]!);
    await flush();
    const times = () => document.querySelectorAll<HTMLInputElement>('[role=dialog] input[type=time]');
    typeInto(times()[0]!, '08:30');
    typeInto(times()[1]!, '11:45');
    gate.resolve();
    await flush();
    expect(c.textContent).toContain('Đã duyệt ca.');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect([times()[0]!.value, times()[1]!.value]).toEqual(['08:30', '11:45']);
  });

  it('chưa gửi: Esc đóng tờ như thường', async () => {
    stub([shift('a')]);
    const c = await mount();
    await openAdjust(c);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('ShiftApprovalTab: làm mới đúng tuần của lệnh', () => {
  const listUrls = (api: ReturnType<typeof stub>) => api.calls.filter((x) => x.method === 'GET' && /\/admin\/shifts\?/.test(x.url)).map((x) => x.url);

  it('duyệt ca của tuần này rồi sang tuần sau khi lệnh còn bay: lệnh xong thì tuần CŨ được tải lại, không phải tuần đang xem', async () => {
    const gate = deferred();
    const api = stub([shift('a')], [], { approve: { a: gate.promise } });
    const c = await mount();
    const weekUrl = listUrls(api)[0]!;
    click(approveBtn(c));
    await flush(2);
    click(c.querySelector('[aria-label="Tuần sau"]'));
    await flush();
    const nextUrl = listUrls(api).find((u) => u !== weekUrl)!;
    expect(nextUrl).toBeDefined();
    const loads = (url: string) => listUrls(api).filter((u) => u === url).length;
    expect([loads(weekUrl), loads(nextUrl)]).toEqual([1, 1]);
    gate.resolve();
    await flush();
    expect(loads(weekUrl)).toBe(2);
    expect(loads(nextUrl)).toBe(1);
  });

  it('"Duyệt tất cả" và "Từ chối" cũng làm mới đúng tuần của lệnh khi đổi tuần giữa chừng', async () => {
    const bulk = deferred();
    const reject = deferred();
    const api = stub([shift('a'), shift('b')], [], { bulk: bulk.promise, reject: { b: reject.promise } });
    const c = await mount();
    const weekUrl = listUrls(api)[0]!;
    click(bulkBtn(c));
    await flush();
    answerConfirm(true);
    await flush(2);
    click(c.querySelector('[aria-label="Tuần sau"]'));
    await flush();
    bulk.resolve();
    await flush();
    expect(listUrls(api).filter((u) => u === weekUrl)).toHaveLength(2);
    click(c.querySelector('[aria-label="Tuần trước"]'));
    await flush();
    click(rejectBtn(c, 1));
    await flush();
    answerAsk('Trùng ca');
    await flush(2);
    click(c.querySelector('[aria-label="Tuần sau"]'));
    await flush();
    const before = listUrls(api).filter((u) => u === weekUrl).length;
    reject.resolve();
    await flush();
    expect(listUrls(api).filter((u) => u === weekUrl).length).toBe(before + 1);
  });
});

describe('ShiftApprovalTab: ca chuẩn', () => {
  const TPL = [
    { id: 't1', name: 'Ca sáng', startMin: 480, endMin: 720, active: true, sortOrder: 0 },
    { id: 't2', name: 'Ca chiều', startMin: 780, endMin: 1020, active: true, sortOrder: 1 },
  ];
  const openTpl = async (c: HTMLElement) => {
    click(byText(c, 'button', 'Ca chuẩn'));
    await flush();
  };
  const nameInput = () => document.querySelector<HTMLInputElement>('[role=dialog] input[placeholder^="Tên ca"]')!;
  const addBtn = () => byText(document.body, 'button', 'Thêm ca chuẩn') as HTMLButtonElement;
  const delBtn = (name: string) => document.querySelector<HTMLButtonElement>(`[aria-label="Xoá ca chuẩn ${name}"]`)!;

  it('chạm đúp "Thêm ca chuẩn" gửi một lệnh, nút aria-busy; chữ gõ thêm lúc chờ không bị xoá khi thành công', async () => {
    const gate = deferred();
    const api = stub([], TPL, { tplAdd: gate.promise });
    const c = await mount();
    await openTpl(c);
    typeInto(nameInput(), 'Ca tối');
    await tap(addBtn(), addBtn());
    await flush(1);
    expect(api.to('/admin/shift-templates')).toHaveLength(1);
    expect(addBtn().getAttribute('aria-busy')).toBe('true');
    expect(addBtn().getAttribute('aria-disabled')).toBe('true');
    expect(addBtn().disabled).toBe(false);
    typeInto(nameInput(), 'Ca tối muộn');
    gate.resolve();
    await flush();
    expect(nameInput().value).toBe('Ca tối muộn');
  });

  it('thêm xong mà ô vẫn đúng chữ đã gửi thì xoá ô', async () => {
    stub([], TPL);
    const c = await mount();
    await openTpl(c);
    typeInto(nameInput(), 'Ca tối');
    click(addBtn());
    await flush();
    expect(nameInput().value).toBe('');
  });

  it('đang thêm: Esc không đóng tờ ca chuẩn', async () => {
    const gate = deferred();
    stub([], TPL, { tplAdd: gate.promise });
    const c = await mount();
    await openTpl(c);
    typeInto(nameInput(), 'Ca tối');
    click(addBtn());
    await flush(1);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    gate.resolve();
    await flush();
  });

  it('chạm đúp "Xoá" một ca chuẩn gửi một lệnh; ca khác cũng bị khoá lúc đó, dòng đang xoá aria-busy', async () => {
    const gate = deferred();
    const api = stub([], TPL, { tplDelete: gate.promise });
    const c = await mount();
    await openTpl(c);
    await tap(delBtn('Ca sáng'), delBtn('Ca sáng'), delBtn('Ca chiều'));
    await flush(1);
    expect(api.to('/admin/shift-templates', 'DELETE')).toHaveLength(1);
    expect(delBtn('Ca sáng').getAttribute('aria-busy')).toBe('true');
    expect(delBtn('Ca sáng').getAttribute('aria-disabled')).toBe('true');
    expect(delBtn('Ca chiều').hasAttribute('aria-busy')).toBe(false);
    expect(delBtn('Ca chiều').getAttribute('aria-disabled')).toBe('true');
    expect(delBtn('Ca chiều').disabled).toBe(false);
    gate.resolve();
    await flush();
    expect(delBtn('Ca chiều').hasAttribute('aria-disabled')).toBe(false);
  });

  it('thêm xong mà danh sách ca chuẩn chưa làm mới thì nút vẫn bận và Esc không đóng tờ; rồi nhả', async () => {
    const list = deferred();
    const api = stub([], TPL, { tplList: list.promise });
    const c = await mount();
    await openTpl(c);
    typeInto(nameInput(), 'Ca tối');
    click(addBtn());
    await flush(2);
    expect(api.to('/admin/shift-templates')).toHaveLength(1);
    expect(addBtn().getAttribute('aria-busy')).toBe('true');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    list.resolve();
    await flush();
    expect(addBtn().hasAttribute('aria-busy')).toBe(false);
  });

  it('xoá xong mà danh sách ca chuẩn chưa làm mới thì dòng vẫn bận và dòng khác vẫn aria-disabled; rồi nhả', async () => {
    const list = deferred();
    const api = stub([], TPL, { tplList: list.promise });
    const c = await mount();
    await openTpl(c);
    click(delBtn('Ca sáng'));
    await flush(2);
    expect(api.to('/admin/shift-templates', 'DELETE')).toHaveLength(1);
    expect(delBtn('Ca sáng').getAttribute('aria-busy')).toBe('true');
    expect(delBtn('Ca chiều').getAttribute('aria-disabled')).toBe('true');
    await tap(delBtn('Ca chiều'));
    expect(api.to('/admin/shift-templates', 'DELETE')).toHaveLength(1);
    list.resolve();
    await flush();
    expect(delBtn('Ca chiều').hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('ShiftApprovalTab: Thử lại tải danh sách ca', () => {
  // Đã có dữ liệu cũ (lần làm mới lỗi): `refetch()` không đưa truy vấn về trạng thái chờ nên nút còn nguyên trong lúc tải lại.
  // Chưa có dữ liệu thì khối lỗi biến mất ngay khi bấm và test aria-busy xanh giả.
  it('bấm Thử lại khi lần tải lại còn chạy: nút aria-busy + aria-disabled, chạm đúp chỉ tải một lần, xong thì hết khối lỗi', async () => {
    let mode: 'ok' | 'fail' | 'hold' = 'ok';
    let loads = 0;
    const gate = deferred();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
        if (url.includes('/admin/shift-templates')) return json([]);
        loads += 1;
        if (mode === 'fail') return json({ message: 'Máy chủ đang bận' }, 500);
        if (mode === 'hold') await gate.promise;
        return json([shift('a')]);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const r = render(<ShiftApprovalTab />, client);
    mounted.push(r);
    await flush();
    mode = 'fail';
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['admin-shifts'] });
    });
    await flush();
    const retry = byText(r.container, 'button', 'Thử lại') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    mode = 'hold';
    const before = loads;
    await tap(retry, retry);
    await flush(1);
    expect(loads - before).toBe(1);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    mode = 'ok';
    gate.resolve();
    await flush();
    expect(byText(r.container, 'button', 'Thử lại')).toBeNull();
  });
});
