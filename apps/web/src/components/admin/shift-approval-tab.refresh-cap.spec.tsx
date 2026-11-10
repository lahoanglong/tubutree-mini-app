// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShiftApprovalTab } from './shift-approval-tab';
import { answerAsk, answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';

// W96B: duyệt/từ chối/duyệt tất cả/ca chuẩn giữ khoá tới khi danh sách về nhưng tối đa 4 giây; lệnh bị từ chối vì dữ liệu đã cũ
// (400/404/409) thì tải lại rồi mới nhả (lệnh có ô nhập giờ/tên: chỉ 404/409, còn 400 là lỗi nhập hiện trong tờ); lời lỗi của tờ "Chỉnh giờ & duyệt" hiện NGAY TRONG tờ (lớp nền che lời báo của trang).
// Web chặt hơn Mini ở hạn 4 giây và tải lại khi bị từ chối: Mini admin.tsx chỉ khoá useLockedMutation.
// Spec chạy trên QueryClient trần: các ca "lỗi 5xx" chỉ chứng minh lệnh không tự chờ/gọi tải lại; trên production MutationCache vẫn làm cũ khoá admin-* sau mỗi lệnh.

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
const TPL = [
  { id: 't1', name: 'Ca sáng', startMin: 480, endMin: 720, active: true, sortOrder: 0 },
  { id: 't2', name: 'Ca chiều', startMin: 780, endMin: 1020, active: true, sortOrder: 1 },
];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const never = () => new Promise<Response>(() => undefined);

type Route = () => Promise<Response> | Response;
const routes: Record<'list' | 'tplList' | 'approve' | 'reject' | 'bulk' | 'tplAdd' | 'tplDel', Route> = {
  list: () => json(200, [shift('a')]),
  tplList: () => json(200, TPL),
  approve: () => json(200, { ok: true }),
  reject: () => json(200, { ok: true }),
  bulk: () => json(200, { approved: 1 }),
  tplAdd: () => json(200, { id: 't9' }),
  tplDel: () => json(200, { deleted: true }),
};
const calls: { method: string; url: string }[] = [];
const count = (method: string, part: string) => calls.filter((c) => c.method === method && c.url.includes(part)).length;
const listGets = () => calls.filter((c) => c.method === 'GET' && /\/admin\/shifts\?/.test(c.url)).length;
const tplGets = () => count('GET', '/admin/shift-templates');
const approves = () => count('POST', '/admin/shifts/a/approve');
const rejects = () => count('POST', '/admin/shifts/a/reject');
const bulks = () => count('POST', 'bulk-approve');
const tplAdds = () => count('POST', '/admin/shift-templates');
const tplDels = () => count('DELETE', '/admin/shift-templates');

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  routes.list = () => json(200, [shift('a')]);
  routes.tplList = () => json(200, TPL);
  routes.approve = () => json(200, { ok: true });
  routes.reject = () => json(200, { ok: true });
  routes.bulk = () => json(200, { approved: 1 });
  routes.tplAdd = () => json(200, { id: 't9' });
  routes.tplDel = () => json(200, { deleted: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'POST' && url.includes('bulk-approve')) return routes.bulk();
      if (method === 'POST' && /\/admin\/shifts\/a\/approve/.test(url)) return routes.approve();
      if (method === 'POST' && /\/admin\/shifts\/a\/reject/.test(url)) return routes.reject();
      if (method === 'POST' && url.includes('/admin/shift-templates')) return routes.tplAdd();
      if (method === 'DELETE' && url.includes('/admin/shift-templates')) return routes.tplDel();
      if (url.includes('/admin/shift-templates')) return routes.tplList();
      if (/\/admin\/shifts\?/.test(url)) return routes.list();
      throw new Error(`fetch chưa giả: ${method} ${url}`);
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

const mount = async () => {
  mounted = render(<ShiftApprovalTab />);
  await flush();
  return mounted.container;
};
const approveBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[aria-label^="Duyệt ca"]');
const rejectBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[aria-label^="Từ chối ca"]');
const bulkBtn = (c: HTMLElement) => byText(c, 'button', /^Duyệt tất cả/) as HTMLButtonElement;
const isBusy = (b: HTMLElement | null) => b?.getAttribute('aria-busy') === 'true';
const alertText = (root: ParentNode) => Array.from(root.querySelectorAll('[role="alert"]')).map((a) => a.textContent).join(' | ');
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const tap = (...els: HTMLElement[]) =>
  act(async () => {
    for (const e of els) e.click();
  });
const holdList = () => {
  const g = gate();
  routes.list = () => g.promise.then(() => json(200, [shift('a')]));
  return g;
};
const holdTplList = () => {
  const g = gate();
  routes.tplList = () => g.promise.then(() => json(200, TPL));
  return g;
};

const doApprove = async (c: HTMLElement) => {
  click(approveBtn(c));
  await flush(3);
};
const doReject = async (c: HTMLElement) => {
  click(rejectBtn(c));
  await flush();
  answerAsk('Trùng lịch');
  await flush(3);
};
const doBulk = async (c: HTMLElement) => {
  click(bulkBtn(c));
  await flush();
  answerConfirm(true);
  await flush(3);
};
const openTpl = async (c: HTMLElement) => {
  click(byText(c, 'button', 'Ca chuẩn'));
  await flush();
};
const addTplBtn = () => byText(document.body, 'button', 'Thêm ca chuẩn') as HTMLButtonElement;
const delTplBtn = (name: string) => document.querySelector<HTMLButtonElement>(`[aria-label="Xoá ca chuẩn ${name}"]`)!;
const nameInput = () => document.querySelector<HTMLInputElement>('[role=dialog] input[placeholder^="Tên ca"]')!;
const addTemplate = async () => {
  typeInto(nameInput(), 'Ca tối');
  click(addTplBtn());
  await flush(3);
};
const openAdjust = async (c: HTMLElement) => {
  click(c.querySelector('[aria-label^="Chỉnh giờ"]'));
  await flush();
};
const adjustBtn = () => byText(document.body, 'button', 'Duyệt với giờ đã chỉnh') as HTMLButtonElement;

describe('hạn 4 giây: danh sách làm mới không về thì khoá vẫn nhả', () => {
  it('Duyệt: còn bận ở 3,5 giây và chạm lại không gửi; nhả sau hạn 4 giây và duyệt lại được', async () => {
    const c = await mount();
    useHangTimers();
    routes.list = never;
    await doApprove(c);
    expect(approves()).toBe(1);
    await advance(3_500);
    expect(isBusy(approveBtn(c))).toBe(true);
    await tap(approveBtn(c)!);
    expect(approves()).toBe(1);
    await advance(1_000);
    await flush();
    expect(isBusy(approveBtn(c))).toBe(false);
    await doApprove(c);
    expect(approves()).toBe(2);
  });

  it('Từ chối: còn bận ở 3,5 giây, nhả sau hạn 4 giây và từ chối lại được', async () => {
    const c = await mount();
    useHangTimers();
    routes.list = never;
    await doReject(c);
    expect(rejects()).toBe(1);
    await advance(3_500);
    expect(isBusy(rejectBtn(c))).toBe(true);
    click(rejectBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    await advance(1_000);
    await flush();
    expect(isBusy(rejectBtn(c))).toBe(false);
    await doReject(c);
    expect(rejects()).toBe(2);
  });

  it('Duyệt tất cả: còn bận ở 3,5 giây, nhả sau hạn 4 giây và duyệt lại được', async () => {
    const c = await mount();
    useHangTimers();
    routes.list = never;
    await doBulk(c);
    expect(bulks()).toBe(1);
    await advance(3_500);
    expect(isBusy(bulkBtn(c))).toBe(true);
    click(bulkBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    await advance(1_000);
    await flush();
    expect(isBusy(bulkBtn(c))).toBe(false);
    await doBulk(c);
    expect(bulks()).toBe(2);
  });

  it('Thêm ca chuẩn: danh sách ca chuẩn không về thì còn bận ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    const c = await mount();
    await openTpl(c);
    useHangTimers();
    routes.tplList = never;
    await addTemplate();
    expect(tplAdds()).toBe(1);
    await advance(3_500);
    expect(isBusy(addTplBtn())).toBe(true);
    await advance(1_000);
    await flush();
    expect(isBusy(addTplBtn())).toBe(false);
  });

  it('Xoá ca chuẩn: danh sách ca chuẩn không về thì còn bận ở 3,5 giây, nhả sau hạn 4 giây và xoá lại được', async () => {
    const c = await mount();
    await openTpl(c);
    useHangTimers();
    routes.tplList = never;
    click(delTplBtn('Ca sáng'));
    await flush(3);
    expect(tplDels()).toBe(1);
    await advance(3_500);
    expect(isBusy(delTplBtn('Ca sáng'))).toBe(true);
    await advance(1_000);
    await flush();
    expect(isBusy(delTplBtn('Ca sáng'))).toBe(false);
    click(delTplBtn('Ca sáng'));
    await flush(3);
    expect(tplDels()).toBe(2);
  });

  it('danh sách làm mới hỏng 500: không unhandled rejection, khoá nhả, lệnh vẫn báo đã duyệt', async () => {
    const c = await mount();
    const seen = await captureUnhandledRejections(async () => {
      routes.list = () => json(500, { message: 'x' });
      await doApprove(c);
    });
    expect(seen).toEqual([]);
    expect(c.textContent).toContain('Đã duyệt ca.');
    expect(c.textContent).toContain('Máy chủ đang bận');
  });
});

describe('lệnh bị từ chối vì dữ liệu đã cũ (400/404/409): tải lại rồi mới nhả khoá', () => {
  const STALE = 'Ca không ở trạng thái chờ duyệt.';

  it.each([[400], [404], [409]])('Duyệt bị %i: hiện lỗi trước, tải lại danh sách, nhả khi danh sách về; chạm lại lúc đó không gửi', async (status) => {
    const c = await mount();
    routes.approve = () => json(status, { message: STALE });
    const list = holdList();
    await doApprove(c);
    expect(alertText(c)).toContain(STALE);
    expect(listGets()).toBe(2);
    expect(isBusy(approveBtn(c))).toBe(true);
    await tap(approveBtn(c)!);
    expect(approves()).toBe(1);
    list.resolve();
    await flush();
    expect(isBusy(approveBtn(c))).toBe(false);
    expect(listGets()).toBe(2);
  });

  it.each([[400], [404], [409]])('Từ chối bị %i: hiện lỗi trước, tải lại danh sách, nhả khi danh sách về', async (status) => {
    const c = await mount();
    routes.reject = () => json(status, { message: STALE });
    const list = holdList();
    await doReject(c);
    expect(alertText(c)).toContain(STALE);
    expect(listGets()).toBe(2);
    expect(isBusy(rejectBtn(c))).toBe(true);
    list.resolve();
    await flush();
    expect(isBusy(rejectBtn(c))).toBe(false);
  });

  it.each([[400], [404], [409]])('Duyệt tất cả bị %i: hiện lỗi trước, tải lại danh sách, nhả khi danh sách về', async (status) => {
    const c = await mount();
    routes.bulk = () => json(status, { message: STALE });
    const list = holdList();
    await doBulk(c);
    expect(alertText(c)).toContain(STALE);
    expect(listGets()).toBe(2);
    expect(isBusy(bulkBtn(c))).toBe(true);
    list.resolve();
    await flush();
    expect(isBusy(bulkBtn(c))).toBe(false);
  });

  it('ca đã được người khác duyệt: lời lỗi vẫn còn sau khi danh sách tải lại làm nút Duyệt biến mất', async () => {
    const c = await mount();
    routes.approve = () => json(400, { message: STALE });
    routes.list = () => json(200, [shift('a', 'APPROVED')]);
    await doApprove(c);
    expect(approveBtn(c)).toBeNull();
    expect(c.textContent).toContain('Đã duyệt');
    expect(alertText(c)).toContain(STALE);
  });

  it('bị từ chối mà danh sách tải lại treo: vẫn nhả khoá sau hạn 4 giây', async () => {
    const c = await mount();
    useHangTimers();
    routes.approve = () => json(409, { message: STALE });
    routes.list = never;
    await doApprove(c);
    await advance(3_500);
    expect(isBusy(approveBtn(c))).toBe(true);
    await advance(1_000);
    await flush();
    expect(isBusy(approveBtn(c))).toBe(false);
  });

  it.each([
    ['máy chủ 500', () => json(500, { message: 'Máy chủ đang bận' })],
    ['quyền 403', () => json(403, { message: 'Không đủ quyền.' })],
    ['mất mạng', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const)('Duyệt lỗi %s: hiện lỗi, nhả khoá ngay để thử lại, không chờ tải lại danh sách (spec chạy QueryClient trần, không có MutationCache như production)', async (_name, reply) => {
    const c = await mount();
    routes.approve = reply as Route;
    await doApprove(c);
    expect(alertText(c)).not.toBe('');
    expect(listGets()).toBe(1);
    expect(isBusy(approveBtn(c))).toBe(false);
    routes.approve = () => json(200, { ok: true });
    await doApprove(c);
    expect(approves()).toBe(2);
  });

  it('Từ chối và Duyệt tất cả lỗi 500: lệnh không tự gọi tải lại danh sách (QueryClient trần của spec không có MutationCache như production)', async () => {
    const c = await mount();
    routes.reject = () => json(500, { message: 'x' });
    routes.bulk = () => json(500, { message: 'x' });
    await doReject(c);
    await doBulk(c);
    expect(rejects()).toBe(1);
    expect(bulks()).toBe(1);
    expect(listGets()).toBe(1);
  });

  it.each([
    ['Duyệt', 'approve'],
    ['Từ chối', 'reject'],
    ['Duyệt tất cả', 'bulk'],
  ] as const)('%s bị 409 sau khi đổi tuần: tải lại đúng tuần của lệnh, không phải tuần đang xem', async (name, key) => {
    const c = await mount();
    const urls = () => calls.filter((x) => x.method === 'GET' && /\/admin\/shifts\?/.test(x.url)).map((x) => x.url);
    const weekUrl = urls()[0]!;
    const held = gate();
    routes[key] = () => held.promise.then(() => json(409, { message: STALE }));
    if (name === 'Duyệt') click(approveBtn(c));
    else if (name === 'Từ chối') {
      click(rejectBtn(c));
      await flush();
      answerAsk('Trùng lịch');
    } else {
      click(bulkBtn(c));
      await flush();
      answerConfirm(true);
    }
    await flush(3);
    click(c.querySelector('[aria-label="Tuần sau"]'));
    await flush();
    const nextUrl = urls().find((u) => u !== weekUrl)!;
    expect(nextUrl).toBeDefined();
    held.resolve();
    await flush(3);
    expect(urls().filter((u) => u === weekUrl)).toHaveLength(2);
    expect(urls().filter((u) => u === nextUrl)).toHaveLength(1);
  });

  it('Thêm ca chuẩn bị 400 (giờ kết thúc không sau giờ bắt đầu): hiện lỗi trong tờ, lệnh KHÔNG tự tải lại danh sách ca chuẩn, nhả khoá ngay', async () => {
    const c = await mount();
    await openTpl(c);
    routes.tplAdd = () => json(400, { message: 'Giờ kết thúc phải sau giờ bắt đầu.' });
    const list = holdTplList();
    await addTemplate();
    expect(alertText(document.body)).toContain('Giờ kết thúc phải sau giờ bắt đầu.');
    expect(tplGets()).toBe(1);
    expect(isBusy(addTplBtn())).toBe(false);
    routes.tplAdd = () => json(200, { id: 'tN' });
    click(addTplBtn());
    await flush(3);
    expect(count('POST', '/admin/shift-templates')).toBe(2);
    list.resolve();
    await flush();
  });

  it('Thêm ca chuẩn bị 409 (trùng tên): hiện lỗi trong tờ, tải lại danh sách ca chuẩn, nhả khi danh sách về', async () => {
    const c = await mount();
    await openTpl(c);
    expect(tplGets()).toBe(1);
    routes.tplAdd = () => json(409, { message: 'Đã có ca chuẩn cùng tên.' });
    const list = holdTplList();
    await addTemplate();
    expect(alertText(document.body)).toContain('Đã có ca chuẩn cùng tên.');
    expect(tplGets()).toBe(2);
    expect(isBusy(addTplBtn())).toBe(true);
    list.resolve();
    await flush();
    expect(isBusy(addTplBtn())).toBe(false);
  });

  it('Xoá ca chuẩn bị 400 (không có ô nhập, nên vẫn là dữ liệu cũ): hiện lỗi trong tờ, tải lại danh sách ca chuẩn, nhả khi danh sách về', async () => {
    const c = await mount();
    await openTpl(c);
    routes.tplDel = () => json(400, { message: 'Ca chuẩn đang được dùng.' });
    const list = holdTplList();
    click(delTplBtn('Ca sáng'));
    await flush(3);
    expect(alertText(document.body)).toContain('Ca chuẩn đang được dùng.');
    expect(tplGets()).toBe(2);
    expect(isBusy(delTplBtn('Ca sáng'))).toBe(true);
    list.resolve();
    await flush();
    expect(isBusy(delTplBtn('Ca sáng'))).toBe(false);
  });

  it('Xoá ca chuẩn bị 404 (đã bị xoá): hiện lỗi trong tờ, tải lại danh sách ca chuẩn, nhả khi danh sách về', async () => {
    const c = await mount();
    await openTpl(c);
    routes.tplDel = () => json(404, { message: 'Không tìm thấy ca chuẩn.' });
    const list = holdTplList();
    click(delTplBtn('Ca sáng'));
    await flush(3);
    expect(alertText(document.body)).toContain('Không tìm thấy ca chuẩn.');
    expect(tplGets()).toBe(2);
    expect(isBusy(delTplBtn('Ca sáng'))).toBe(true);
    list.resolve();
    await flush();
    expect(isBusy(delTplBtn('Ca sáng'))).toBe(false);
  });

  it('Thêm/Xoá ca chuẩn lỗi 500: lệnh không tự gọi tải lại danh sách ca chuẩn (QueryClient trần của spec không có MutationCache như production)', async () => {
    const c = await mount();
    await openTpl(c);
    routes.tplAdd = () => json(500, { message: 'x' });
    routes.tplDel = () => json(500, { message: 'x' });
    await addTemplate();
    click(delTplBtn('Ca sáng'));
    await flush(3);
    expect(tplGets()).toBe(1);
  });
});

describe('lời lỗi của tờ "Chỉnh giờ & duyệt" hiện trong tờ, không nằm sau lớp nền', () => {
  it('lỗi 500: lời lỗi trong tờ, không ở trang; mở lại tờ thì lời lỗi cũ biến mất', async () => {
    const c = await mount();
    routes.approve = () => json(500, { message: 'x' });
    await openAdjust(c);
    click(adjustBtn());
    await flush(3);
    expect(approves()).toBe(1);
    expect(alertText(document.querySelector('[role=dialog]')!)).toContain('Máy chủ đang bận');
    expect(alertText(c)).toBe('');
    expect(isBusy(adjustBtn())).toBe(false);
    click(document.querySelector('[aria-label="Đóng"]'));
    await flush();
    await openAdjust(c);
    expect(alertText(document.querySelector('[role=dialog]')!)).toBe('');
  });

  it('lỗi 400 (giờ kết thúc không sau giờ bắt đầu): lời lỗi trong tờ, lệnh KHÔNG tự tải lại danh sách, tờ nhả ngay để sửa giờ', async () => {
    const c = await mount();
    routes.approve = () => json(400, { message: 'Giờ kết thúc phải sau giờ bắt đầu.' });
    const list = holdList();
    await openAdjust(c);
    click(adjustBtn());
    await flush(3);
    expect(alertText(document.querySelector('[role=dialog]')!)).toContain('Giờ kết thúc phải sau giờ bắt đầu.');
    expect(alertText(c)).toBe('');
    expect(listGets()).toBe(1);
    expect(isBusy(adjustBtn())).toBe(false);
    routes.approve = () => json(200, { ok: true });
    click(adjustBtn());
    await flush(3);
    expect(approves()).toBe(2);
    list.resolve();
    await flush();
  });

  it('lỗi 409: lời lỗi trong tờ và danh sách được tải lại; tờ nhả khi danh sách về', async () => {
    const c = await mount();
    routes.approve = () => json(409, { message: 'Ca không ở trạng thái chờ duyệt.' });
    const list = holdList();
    await openAdjust(c);
    click(adjustBtn());
    await flush(3);
    expect(alertText(document.querySelector('[role=dialog]')!)).toContain('Ca không ở trạng thái chờ duyệt.');
    expect(listGets()).toBe(2);
    expect(isBusy(adjustBtn())).toBe(true);
    list.resolve();
    await flush();
    expect(isBusy(adjustBtn())).toBe(false);
  });

  it('duyệt thành công đóng tờ và không để lại lời lỗi', async () => {
    const c = await mount();
    await openAdjust(c);
    click(adjustBtn());
    await flush(3);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(c.textContent).toContain('Đã duyệt ca.');
  });
});

describe('số giờ dùng tabular-nums', () => {
  it('dòng giờ của ca, nút Duyệt tất cả và dòng ca chuẩn', async () => {
    const c = await mount();
    const withClass = (root: ParentNode, text: string) => {
      const el = Array.from(root.querySelectorAll('div, span, button')).find((x) => x.textContent?.includes(text) && !Array.from(x.children).some((k) => k.textContent?.includes(text)));
      return el?.closest('.tabular-nums') ?? null;
    };
    expect(withClass(c, '08:00–12:00')).not.toBeNull();
    expect(bulkBtn(c).classList.contains('tabular-nums')).toBe(true);
    await openTpl(c);
    expect(withClass(document.body, 'Ca sáng · 08:00–12:00')).not.toBeNull();
  });
});
