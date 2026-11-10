// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/export-csv', () => ({ downloadCsvFile: () => undefined }));
vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <button type="button" data-testid="proof" onClick={() => onChange(['data:image/jpeg;base64,AAAA'])}>
      Ảnh ({value.length})
    </button>
  ),
}));

import { PayrollAdminTab } from './payroll-admin-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';
import { currentVnYearMonth } from '@/lib/week';

// W96B: Chốt/Mở lại/Ghi đã trả/Đơn giá/Tính lại tháng/Sửa giờ phiên giữ khoá tới khi dữ liệu về nhưng tối đa 4 giây; lệnh bị từ chối vì
// dữ liệu đã cũ (400/404/409) thì tải lại rồi mới nhả (lệnh có ô nhập: chỉ 404/409, còn 400 là lỗi nhập hiện trong tờ); lời lỗi của tờ hiện trong tờ; Tính lại tháng khoá đồng bộ.
// Spec chạy trên QueryClient trần: các ca "lỗi 5xx" chỉ chứng minh lệnh không tự chờ/gọi tải lại; trên production MutationCache vẫn làm cũ khoá admin-* sau mỗi lệnh.
// Web chặt hơn Mini ở hạn 4 giây và tải lại khi bị từ chối: Mini admin.tsx chỉ khoá useLockedMutation. Mini không có "Tính lại tháng".

const { year, month } = currentVnYearMonth();
const mon = (status: string) => ({ year, month, totalMinutes: 125, gross: 500_000, totalFines: 20_000, net: 480_000, status, paidAt: null, proofImageUrl: null, note: null });
const row = (id: string, name: string, status: string) => ({
  staff: { id, fullName: name, phone: `09${id}00000` },
  month: mon(status),
  profile: { hourlyRate: 40_000, bankBin: null, bankAccountNo: '123', bankAccountName: 'LAN', qrImageUrl: null, active: true },
  qrImageUrl: 'https://img.example/qr.png',
});
const DETAIL = {
  month: mon('OPEN'),
  days: [{ id: 'd1', workDate: '2026-10-19T00:00:00.000Z', workedMinutes: 480, hourlyRate: 40_000, gross: 320_000, fines: 0, net: 320_000 }],
  profile: null,
  sessions: [{ id: 'ss1', shiftId: 'sh1', checkinAt: '2026-10-19T01:00:00.000Z', checkoutAt: '2026-10-19T09:00:00.000Z', isLate: false, closeReason: null }],
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const never = () => new Promise<Response>(() => undefined);

type Route = () => Promise<Response> | Response;
type Key = 'list' | 'detail' | 'finalize' | 'reopen' | 'paid' | 'rate' | 'recompute' | 'edit' | 'adjust';
let ROWS: unknown[] = [];
const routes: Record<Key, Route> = {} as Record<Key, Route>;
const calls: { method: string; url: string }[] = [];
const count = (method: string, part: string) => calls.filter((c) => c.method === method && c.url.includes(part)).length;
const listGets = () => calls.filter((c) => c.method === 'GET' && /\/admin\/payroll\?/.test(c.url)).length;
const detailGets = () => count('GET', '/detail');
const writes = (part: string) => calls.filter((c) => c.method !== 'GET' && c.url.includes(part)).length;
const allWrites = () => calls.filter((c) => c.method !== 'GET').length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  ROWS = [row('1', 'Lan', 'OPEN'), row('2', 'Mai', 'FINALIZED')];
  routes.list = () => json(200, ROWS);
  routes.detail = () => json(200, DETAIL);
  routes.finalize = () => json(200, { finalized: true });
  routes.reopen = () => json(200, { status: 'OPEN' });
  routes.paid = () => json(200, { paid: true });
  routes.rate = () => json(200, { hourlyRate: 50_000 });
  routes.recompute = () => json(200, mon('OPEN'));
  routes.edit = () => json(200, { updated: true });
  routes.adjust = () => json(200, { adjusted: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'GET' && url.includes('/detail')) return routes.detail();
      if (method === 'POST' && url.includes('/admin/payroll/adjust')) return routes.adjust();
      if (method === 'POST' && url.includes('/finalize')) return routes.finalize();
      if (method === 'POST' && url.includes('/reopen')) return routes.reopen();
      if (method === 'POST' && url.includes('/mark-paid')) return routes.paid();
      if (method === 'PUT' && url.includes('/rate')) return routes.rate();
      if (method === 'POST' && url.includes('/recompute')) return routes.recompute();
      if (method === 'POST' && url.includes('/attendance/session/')) return routes.edit();
      if (method === 'GET' && /\/admin\/payroll\?/.test(url)) return routes.list();
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
  mounted = render(<PayrollAdminTab />);
  await flush();
  return mounted.container;
};
const q = (root: ParentNode, label: string) => root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const isBusy = (b: HTMLElement | null) => b?.getAttribute('aria-busy') === 'true';
const isDisabledByAria = (b: HTMLElement) => b.getAttribute('aria-disabled') === 'true';
const alertText = (root: ParentNode) => Array.from(root.querySelectorAll('[role="alert"]')).map((a) => a.textContent).join(' | ');
const dialogEl = () => document.querySelector<HTMLElement>('[role=dialog]');
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const tap = (...els: HTMLElement[]) =>
  act(async () => {
    for (const e of els) e.click();
  });
const esc = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
const holdList = () => {
  const g = gate();
  routes.list = () => g.promise.then(() => json(200, ROWS));
  return g;
};
const holdDetail = () => {
  const g = gate();
  routes.detail = () => g.promise.then(() => json(200, DETAIL));
  return g;
};

const doFinalize = async (c: HTMLElement) => {
  click(q(c, 'Chốt · Lan'));
  await flush();
  answerConfirm(true);
  await flush(3);
};
const doReopen = async (c: HTMLElement) => {
  click(q(c, 'Mở lại · Mai'));
  await flush();
  answerConfirm(true);
  await flush(3);
};
const paidSave = () => byText(document.body, 'button', 'Đánh dấu đã trả') as HTMLButtonElement;
const doPaid = async (c: HTMLElement) => {
  click(q(c, 'Ghi đã trả lương · Mai'));
  await flush();
  click(document.querySelector('[data-testid="proof"]'));
  click(paidSave());
  await flush(3);
};
const rateSave = () => byText(document.body, 'button', 'Lưu đơn giá') as HTMLButtonElement;
const doRate = async (c: HTMLElement) => {
  click(q(c, 'Đơn giá · Lan'));
  await flush();
  typeInto(document.querySelector('[role=dialog] input[type=number]'), '50000');
  click(rateSave());
  await flush(3);
};
const doRecompute = async (c: HTMLElement) => {
  click(q(c, 'Tính lại tháng · Lan'));
  await flush();
  answerConfirm(true);
  await flush(3);
};
const openDetailEdit = async (c: HTMLElement) => {
  click(q(c, 'Xem giờ · Lan'));
  await flush();
  click(document.querySelector('[aria-label="Sửa giờ phiên 08:00"]'));
  const times = document.querySelectorAll<HTMLInputElement>('[role=dialog] input[type=time]');
  typeInto(times[0]!, '08:30');
  typeInto(times[1]!, '17:00');
};
const saveHours = () => byText(document.body, 'button', 'Lưu giờ') as HTMLButtonElement;
const doSaveHours = async () => {
  click(saveHours());
  await flush(3);
};

describe('hạn 4 giây: dữ liệu làm mới không về thì khoá vẫn nhả', () => {
  it('Chốt: bảng lương không về thì còn bận ở 3,5 giây (chạm lại không mở hộp), nhả sau hạn 4 giây và chốt lại được', async () => {
    const c = await mount();
    useHangTimers();
    routes.list = never;
    await doFinalize(c);
    expect(writes('/finalize')).toBe(1);
    await advance(3_500);
    expect(isBusy(q(c, 'Chốt · Lan'))).toBe(true);
    click(q(c, 'Chốt · Lan'));
    await flush();
    expect(confirmDialog()).toBeNull();
    await advance(1_000);
    await flush();
    expect(isBusy(q(c, 'Chốt · Lan'))).toBe(false);
    await doFinalize(c);
    expect(writes('/finalize')).toBe(2);
  });

  it('Mở lại: bảng lương không về thì còn bận ở 3,5 giây, nhả sau hạn 4 giây và mở lại được', async () => {
    const c = await mount();
    useHangTimers();
    routes.list = never;
    await doReopen(c);
    expect(writes('/reopen')).toBe(1);
    await advance(3_500);
    expect(isBusy(q(c, 'Mở lại · Mai'))).toBe(true);
    await advance(1_000);
    await flush();
    expect(isBusy(q(c, 'Mở lại · Mai'))).toBe(false);
    await doReopen(c);
    expect(writes('/reopen')).toBe(2);
  });

  it('Ghi đã trả: bảng lương không về thì các nút Chốt/Mở lại còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    const c = await mount();
    useHangTimers();
    routes.list = never;
    await doPaid(c);
    expect(writes('/mark-paid')).toBe(1);
    await advance(3_500);
    expect(isDisabledByAria(q(c, 'Chốt · Lan'))).toBe(true);
    await advance(1_000);
    await flush();
    expect(q(c, 'Chốt · Lan').hasAttribute('aria-disabled')).toBe(false);
  });

  it('Lưu đơn giá: bảng lương không về thì nút Đơn giá chưa mở lại tờ ở 3,5 giây, nhả sau hạn 4 giây và tờ mở được', async () => {
    const c = await mount();
    useHangTimers();
    routes.list = never;
    await doRate(c);
    expect(writes('/rate')).toBe(1);
    click(q(c, 'Đơn giá · Lan'));
    await flush();
    await advance(3_500);
    expect(dialogEl()).toBeNull();
    expect(writes('/rate')).toBe(1);
    await advance(1_000);
    await flush();
    click(q(c, 'Đơn giá · Lan'));
    await flush();
    expect(dialogEl()).not.toBeNull();
    expect(isBusy(rateSave())).toBe(false);
  });

  it('Tính lại tháng: bảng lương không về thì còn bận ở 3,5 giây, nhả sau hạn 4 giây và tính lại được', async () => {
    const c = await mount();
    useHangTimers();
    routes.list = never;
    await doRecompute(c);
    expect(writes('/recompute')).toBe(1);
    await advance(3_500);
    expect(isBusy(q(c, 'Tính lại tháng · Lan'))).toBe(true);
    click(q(c, 'Tính lại tháng · Lan'));
    await flush();
    expect(confirmDialog()).toBeNull();
    await advance(1_000);
    await flush();
    expect(isBusy(q(c, 'Tính lại tháng · Lan'))).toBe(false);
    await doRecompute(c);
    expect(writes('/recompute')).toBe(2);
  });

  it('Lưu giờ phiên: dữ liệu không về thì tờ còn không đóng được ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    const c = await mount();
    await openDetailEdit(c);
    useHangTimers();
    const held = gate();
    routes.detail = () => held.promise.then(() => json(200, DETAIL));
    routes.list = never;
    await doSaveHours();
    expect(writes('/attendance/session/ss1/edit')).toBe(1);
    await advance(3_500);
    esc();
    expect(dialogEl()).not.toBeNull();
    await advance(1_000);
    await flush();
    esc();
    expect(dialogEl()).toBeNull();
  });

  it('bảng lương tải lại hỏng 500: không unhandled rejection, khoá nhả, lệnh vẫn báo đã chốt', async () => {
    const c = await mount();
    const seen = await captureUnhandledRejections(async () => {
      routes.list = () => json(500, { message: 'x' });
      await doFinalize(c);
    });
    expect(seen).toEqual([]);
    expect(c.textContent).toContain('Đã chốt lương.');
  });
});

describe('lệnh bị từ chối vì dữ liệu đã cũ (400/404/409): tải lại rồi mới nhả khoá', () => {
  const STALE = 'Tháng lương đã chốt, tải lại.';

  it.each([[400], [404], [409]])('Chốt bị %i: hiện lỗi trước, tải lại đúng tháng, nhả khi bảng về; chạm lại lúc đó không mở hộp', async (status) => {
    const c = await mount();
    routes.finalize = () => json(status, { message: STALE });
    const list = holdList();
    await doFinalize(c);
    expect(alertText(c)).toContain(STALE);
    expect(listGets()).toBe(2);
    expect(isBusy(q(c, 'Chốt · Lan'))).toBe(true);
    click(q(c, 'Chốt · Lan'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(writes('/finalize')).toBe(1);
    list.resolve();
    await flush();
    expect(isBusy(q(c, 'Chốt · Lan'))).toBe(false);
    expect(listGets()).toBe(2);
  });

  it.each([[400], [404], [409]])('Mở lại bị %i: hiện lỗi trước, tải lại, nhả khi bảng về', async (status) => {
    const c = await mount();
    routes.reopen = () => json(status, { message: STALE });
    const list = holdList();
    await doReopen(c);
    expect(alertText(c)).toContain(STALE);
    expect(listGets()).toBe(2);
    expect(isBusy(q(c, 'Mở lại · Mai'))).toBe(true);
    list.resolve();
    await flush();
    expect(isBusy(q(c, 'Mở lại · Mai'))).toBe(false);
  });

  it('dòng đã được người khác chốt: lời lỗi còn sau khi bảng tải lại làm nút Chốt biến mất', async () => {
    const c = await mount();
    routes.finalize = () => json(400, { message: STALE });
    ROWS = [row('1', 'Lan', 'FINALIZED'), row('2', 'Mai', 'FINALIZED')];
    await doFinalize(c);
    expect(c.querySelector('[aria-label="Chốt · Lan"]')).toBeNull();
    expect(alertText(c)).toContain(STALE);
  });

  it.each([[404], [409]])('Ghi đã trả bị %i: lời lỗi trong tờ (không ở trang), tải lại bảng, nhả khi bảng về', async (status) => {
    const c = await mount();
    routes.paid = () => json(status, { message: 'Tháng này đã trả rồi.' });
    const list = holdList();
    await doPaid(c);
    expect(alertText(dialogEl()!)).toContain('Tháng này đã trả rồi.');
    expect(alertText(c)).toBe('');
    expect(listGets()).toBe(2);
    expect(isBusy(paidSave())).toBe(true);
    await tap(paidSave());
    expect(writes('/mark-paid')).toBe(1);
    list.resolve();
    await flush();
    expect(isBusy(paidSave())).toBe(false);
  });

  it('Ghi đã trả bị 400 (ảnh hoặc ghi chú không hợp lệ): lời lỗi trong tờ, lệnh KHÔNG tự tải lại, nhả khoá ngay để sửa rồi gửi lại', async () => {
    const c = await mount();
    routes.paid = () => json(400, { message: 'Ảnh xác nhận không hợp lệ.' });
    const list = holdList();
    await doPaid(c);
    expect(alertText(dialogEl()!)).toContain('Ảnh xác nhận không hợp lệ.');
    expect(alertText(c)).toBe('');
    expect(listGets()).toBe(1);
    expect(isBusy(paidSave())).toBe(false);
    routes.paid = () => json(200, { paid: true });
    click(paidSave());
    await flush(3);
    expect(writes('/mark-paid')).toBe(2);
    list.resolve();
    await flush();
  });

  it.each([[404], [409]])('Lưu đơn giá bị %i: lời lỗi trong tờ, tải lại bảng, nhả khi bảng về', async (status) => {
    const c = await mount();
    routes.rate = () => json(status, { message: 'Không tìm thấy nhân viên.' });
    const list = holdList();
    await doRate(c);
    expect(alertText(dialogEl()!)).toContain('Không tìm thấy nhân viên.');
    expect(listGets()).toBe(2);
    expect(isBusy(rateSave())).toBe(true);
    list.resolve();
    await flush();
    expect(isBusy(rateSave())).toBe(false);
  });

  it('Lưu đơn giá bị 400 (vượt trần đơn giá): lời lỗi trong tờ, lệnh KHÔNG tự tải lại, nhả khoá ngay để sửa số rồi lưu lại', async () => {
    const c = await mount();
    routes.rate = () => json(400, { message: 'Đơn giá không hợp lệ.' });
    const list = holdList();
    await doRate(c);
    expect(alertText(dialogEl()!)).toContain('Đơn giá không hợp lệ.');
    expect(alertText(c)).toBe('');
    expect(listGets()).toBe(1);
    expect(isBusy(rateSave())).toBe(false);
    routes.rate = () => json(200, { hourlyRate: 50_000 });
    click(rateSave());
    await flush(3);
    expect(writes('/rate')).toBe(2);
    list.resolve();
    await flush();
  });

  it('Tính lại tháng bị 400 (tháng đã chốt): hiện lỗi, tải lại bảng, nhả khi bảng về', async () => {
    const c = await mount();
    routes.recompute = () => json(400, { message: 'Tháng đã chốt không tính lại được.' });
    const list = holdList();
    await doRecompute(c);
    expect(alertText(c)).toContain('Tháng đã chốt không tính lại được.');
    expect(listGets()).toBe(2);
    expect(isBusy(q(c, 'Tính lại tháng · Lan'))).toBe(true);
    list.resolve();
    await flush();
    expect(isBusy(q(c, 'Tính lại tháng · Lan'))).toBe(false);
  });

  it('Lưu giờ phiên bị 404: lỗi trong tờ, tải lại chi tiết giờ công và bảng lương, nhả khi chi tiết về', async () => {
    const c = await mount();
    await openDetailEdit(c);
    expect(detailGets()).toBe(1);
    routes.edit = () => json(404, { message: 'Không tìm thấy phiên.' });
    const detail = holdDetail();
    await doSaveHours();
    expect(alertText(dialogEl()!)).toContain('Không tìm thấy phiên.');
    expect(detailGets()).toBe(2);
    expect(listGets()).toBe(2);
    expect(isBusy(saveHours())).toBe(true);
    await tap(saveHours());
    expect(writes('/attendance/session/ss1/edit')).toBe(1);
    detail.resolve();
    await flush();
    expect(isBusy(saveHours())).toBe(false);
  });

  it('Lưu giờ phiên bị 409: lỗi trong tờ, tải lại chi tiết giờ công và bảng lương, nhả khi chi tiết về', async () => {
    const c = await mount();
    await openDetailEdit(c);
    expect(detailGets()).toBe(1);
    routes.edit = () => json(409, { message: 'Phiên vừa được sửa ở nơi khác.' });
    const detail = holdDetail();
    await doSaveHours();
    expect(alertText(dialogEl()!)).toContain('Phiên vừa được sửa ở nơi khác.');
    expect(detailGets()).toBe(2);
    expect(listGets()).toBe(2);
    expect(isBusy(saveHours())).toBe(true);
    detail.resolve();
    await flush();
    expect(isBusy(saveHours())).toBe(false);
  });

  it('Lưu giờ phiên bị 400 (giờ ra không sau giờ vào): lỗi trong tờ, lệnh KHÔNG tự tải lại chi tiết hay bảng lương, nhả khoá ngay', async () => {
    const c = await mount();
    await openDetailEdit(c);
    routes.edit = () => json(400, { message: 'Giờ checkout phải sau giờ checkin.' });
    const detail = holdDetail();
    await doSaveHours();
    expect(alertText(dialogEl()!)).toContain('Giờ checkout phải sau giờ checkin.');
    expect(detailGets()).toBe(1);
    expect(listGets()).toBe(1);
    expect(isBusy(saveHours())).toBe(false);
    routes.edit = () => json(200, { updated: true });
    click(saveHours());
    await flush(3);
    expect(writes('/attendance/session/ss1/edit')).toBe(2);
    detail.resolve();
    await flush();
  });

  it.each([
    ['máy chủ 500', () => json(500, { message: 'x' })],
    ['quyền 403', () => json(403, { message: 'Không đủ quyền.' })],
    ['mất mạng', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const)('Chốt lỗi %s: hiện lỗi, nhả khoá ngay, không chờ tải lại bảng (spec chạy QueryClient trần, không có MutationCache như production)', async (_name, reply) => {
    const c = await mount();
    routes.finalize = reply as Route;
    await doFinalize(c);
    expect(alertText(c)).not.toBe('');
    expect(listGets()).toBe(1);
    expect(isBusy(q(c, 'Chốt · Lan'))).toBe(false);
  });

  it('Mở lại, Ghi đã trả, Đơn giá, Tính lại, Lưu giờ lỗi 500: lệnh không tự gọi tải lại (QueryClient trần của spec không có MutationCache như production)', async () => {
    const c = await mount();
    routes.reopen = () => json(500, { message: 'x' });
    routes.paid = () => json(500, { message: 'x' });
    routes.rate = () => json(500, { message: 'x' });
    routes.recompute = () => json(500, { message: 'x' });
    routes.edit = () => json(500, { message: 'x' });
    await doReopen(c);
    await doPaid(c);
    esc();
    await doRate(c);
    esc();
    await doRecompute(c);
    await openDetailEdit(c);
    await doSaveHours();
    expect(listGets()).toBe(1);
    expect(detailGets()).toBe(1);
  });
});

describe('lệnh bị từ chối sau khi đổi tháng: tải lại đúng tháng của lệnh, không phải tháng đang xem', () => {
  const lists = () => calls.filter((x) => x.method === 'GET' && /\/admin\/payroll\?/.test(x.url)).map((x) => x.url);

  it.each([
    ['Chốt', 'finalize'],
    ['Mở lại', 'reopen'],
    ['Tính lại tháng', 'recompute'],
  ] as const)('%s bị 409', async (name, key) => {
    const c = await mount();
    const monthUrl = lists()[0]!;
    const held = gate();
    routes[key] = () => held.promise.then(() => json(409, { message: 'Tháng đã đổi trạng thái.' }));
    if (name === 'Chốt') click(q(c, 'Chốt · Lan'));
    else if (name === 'Mở lại') click(q(c, 'Mở lại · Mai'));
    else click(q(c, 'Tính lại tháng · Lan'));
    await flush();
    answerConfirm(true);
    await flush(3);
    click(c.querySelector('[aria-label="Tháng trước"]'));
    await flush();
    const prevUrl = lists().find((u) => u !== monthUrl)!;
    expect(prevUrl).toBeDefined();
    held.resolve();
    await flush(3);
    expect(lists().filter((u) => u === monthUrl)).toHaveLength(2);
    expect(lists().filter((u) => u === prevUrl)).toHaveLength(1);
  });
});

describe('Thưởng/phạt: bảng lương tải lại khi tờ bị từ chối vì bảng đã cũ', () => {
  const openAdjust = async (c: HTMLElement) => {
    click(q(c, 'Thưởng/phạt · Lan'));
    const until = Date.now() + 4000;
    while (Date.now() < until && !document.querySelector('[role=dialog] [data-adjust-submit]')) await flush(1);
    await flush();
  };
  const submitAdjust = async () => {
    click(byText(dialogEl()!, 'button[aria-pressed]', 'Phạt'));
    typeInto(dialogEl()!.querySelector('input[inputmode=numeric]'), '50000');
    typeInto(dialogEl()!.querySelector('textarea'), 'Đi trễ');
    click(dialogEl()!.querySelector('[data-adjust-submit]'));
    await flush();
    answerConfirm(true);
    await flush(3);
  };

  it.each([[404], [409]])('%i (bảng đã cũ): lời lỗi trong tờ và bảng lương được tải lại một lần', async (status) => {
    const c = await mount();
    routes.adjust = () => json(status, { message: 'Tháng lương đã chốt/đã trả.' });
    await openAdjust(c);
    await submitAdjust();
    expect(alertText(dialogEl()!)).toContain('Tháng lương đã chốt/đã trả.');
    expect(writes('/admin/payroll/adjust')).toBe(1);
    expect(listGets()).toBe(2);
  });

  it('400 (số tiền hoặc lý do không hợp lệ): lời lỗi trong tờ, lệnh KHÔNG tự tải lại bảng lương', async () => {
    const c = await mount();
    routes.adjust = () => json(400, { message: 'Số tiền điều chỉnh phải khác 0.' });
    await openAdjust(c);
    await submitAdjust();
    expect(alertText(dialogEl()!)).toContain('Số tiền điều chỉnh phải khác 0.');
    expect(writes('/admin/payroll/adjust')).toBe(1);
    expect(listGets()).toBe(1);
  });

  it('500: bảng lương không được gọi tải lại (QueryClient trần của spec không có MutationCache như production)', async () => {
    const c = await mount();
    routes.adjust = () => json(500, { message: 'x' });
    await openAdjust(c);
    await submitAdjust();
    expect(alertText(dialogEl()!)).toContain('Máy chủ đang bận');
    expect(listGets()).toBe(1);
  });
});

describe('Tính lại tháng khoá đồng bộ', () => {
  it('đang tính: nút aria-busy (không disabled), nút của dòng khác aria-disabled, chạm lại không mở hộp và chỉ có đúng một lần gọi API', async () => {
    ROWS = [row('1', 'Lan', 'OPEN'), row('3', 'Hà', 'OPEN')];
    const cc = await mount();
    const held = gate();
    routes.recompute = () => held.promise.then(() => json(200, mon('OPEN')));
    click(q(cc, 'Tính lại tháng · Lan'));
    await flush();
    answerConfirm(true);
    await flush(2);
    expect(writes('/recompute')).toBe(1);
    const lan = q(cc, 'Tính lại tháng · Lan');
    const ha = q(cc, 'Tính lại tháng · Hà');
    expect(isBusy(lan)).toBe(true);
    expect(lan.disabled).toBe(false);
    expect(isDisabledByAria(lan)).toBe(true);
    expect(isBusy(ha)).toBe(false);
    expect(isDisabledByAria(ha)).toBe(true);
    expect(ha.disabled).toBe(false);
    await tap(lan, lan, ha);
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(writes('/recompute')).toBe(1);
    held.resolve();
    await flush();
    expect(allWrites()).toBe(1);
    expect(isBusy(q(cc, 'Tính lại tháng · Lan'))).toBe(false);
  });

  it('hộp xác nhận bật hai lần sát nhau: chỉ gửi một lệnh', async () => {
    const c = await mount();
    click(q(c, 'Tính lại tháng · Lan'));
    await flush();
    await act(async () => {
      const accept = confirmDialog()!.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!;
      accept.click();
      accept.click();
    });
    await flush(3);
    expect(writes('/recompute')).toBe(1);
  });

  it('tính lại lỗi 500 nhả khoá: báo lỗi và tính lại được lần hai', async () => {
    const c = await mount();
    routes.recompute = () => json(500, { message: 'x' });
    await doRecompute(c);
    expect(alertText(c)).not.toBe('');
    expect(isBusy(q(c, 'Tính lại tháng · Lan'))).toBe(false);
    routes.recompute = () => json(200, mon('OPEN'));
    await doRecompute(c);
    expect(writes('/recompute')).toBe(2);
  });
});

describe('lời lỗi của tờ hiện trong tờ, không nằm sau lớp nền', () => {
  it('Lưu đơn giá lỗi 500: lời lỗi trong tờ, không ở trang; mở lại tờ thì lời lỗi cũ biến mất', async () => {
    const c = await mount();
    routes.rate = () => json(500, { message: 'x' });
    await doRate(c);
    expect(alertText(dialogEl()!)).toContain('Máy chủ đang bận');
    expect(alertText(c)).toBe('');
    click(dialogEl()!.querySelector('[aria-label="Đóng"]'));
    await flush();
    click(q(c, 'Đơn giá · Lan'));
    await flush();
    expect(alertText(dialogEl()!)).toBe('');
  });

  it('Ghi đã trả lỗi 500: lời lỗi trong tờ; thành công đóng tờ và báo ở trang', async () => {
    const c = await mount();
    routes.paid = () => json(500, { message: 'x' });
    await doPaid(c);
    expect(alertText(dialogEl()!)).toContain('Máy chủ đang bận');
    routes.paid = () => json(200, { paid: true });
    click(paidSave());
    await flush(3);
    expect(dialogEl()).toBeNull();
    expect(c.textContent).toContain('Đã đánh dấu đã trả lương.');
  });
});

describe('lời lỗi cũ của tờ không dính sang lần mở sau', () => {
  it('Ghi đã trả: lỗi 500 rồi đóng và mở lại tờ thì không còn lời lỗi', async () => {
    const c = await mount();
    routes.paid = () => json(500, { message: 'x' });
    await doPaid(c);
    expect(alertText(dialogEl()!)).not.toBe('');
    click(dialogEl()!.querySelector('[aria-label="Đóng"]'));
    await flush();
    click(q(c, 'Ghi đã trả lương · Mai'));
    await flush();
    expect(alertText(dialogEl()!)).toBe('');
  });
});

describe('số giờ và tiền dùng tabular-nums', () => {
  const tab = (root: ParentNode, text: string) => {
    const el = Array.from(root.querySelectorAll('div, span, p, strong')).find((x) => x.textContent?.includes(text) && !Array.from(x.children).some((k) => k.textContent?.includes(text)));
    return el?.closest('.tabular-nums') ?? null;
  };

  it('dòng giờ/đơn giá, thực nhận, tiền phạt của từng nhân viên', async () => {
    const c = await mount();
    expect(tab(c, '2h05 · 40.000đ/h')).not.toBeNull();
    expect(tab(c, '480.000đ')).not.toBeNull();
    expect(tab(c, '−20.000đ')).not.toBeNull();
  });

  it('tờ QR chuyển lương và tờ "Xác nhận đã chuyển" hiện số tiền tabular-nums', async () => {
    const c = await mount();
    click(q(c, 'QR chuyển · Lan'));
    await flush();
    expect(tab(dialogEl()!, '480.000đ')).not.toBeNull();
    click(dialogEl()!.querySelector('[aria-label="Đóng"]'));
    await flush();
    click(q(c, 'Ghi đã trả lương · Lan'));
    await flush();
    expect(tab(dialogEl()!, '480.000đ')).not.toBeNull();
  });

  it('tờ Giờ công: tổng, thực nhận, giờ từng ngày và giờ từng phiên', async () => {
    const c = await mount();
    click(q(c, 'Xem giờ · Lan'));
    await flush();
    const d = dialogEl()!;
    expect(tab(d, 'Tổng:')).not.toBeNull();
    expect(tab(d, '8h00')).not.toBeNull();
    expect(tab(d, '08:00 → 16:00')).not.toBeNull();
  });

  it('ô đơn giá', async () => {
    const c = await mount();
    click(q(c, 'Đơn giá · Lan'));
    await flush();
    expect(dialogEl()!.querySelector('input[type=number]')!.classList.contains('tabular-nums')).toBe(true);
  });
});

// Lệnh lưu đã xong và tờ đã đóng nhưng khoá còn giữ tới khi dữ liệu mới về: mở lại tờ lúc này nạp dữ liệu CŨ (đơn giá, giờ phiên) rồi Lưu ghi đè giá trị vừa lưu.
describe('không mở lại tờ khi lệnh lưu còn chờ dữ liệu mới', () => {
  const rateOf = (c: HTMLElement, label: string) => q(c, label);
  const rowWithRate = (id: string, name: string, status: string, hourlyRate: number) => {
    const base = row(id, name, status);
    return { ...base, profile: { ...base.profile, hourlyRate } };
  };

  it('Đơn giá: bảng lương chưa về thì nút Đơn giá của mọi dòng báo bận (aria-disabled, không disabled) và không mở tờ; bảng về thì mở tờ với đơn giá mới', async () => {
    const c = await mount();
    ROWS = [rowWithRate('1', 'Lan', 'OPEN', 50_000), row('2', 'Mai', 'FINALIZED')];
    const list = holdList();
    await doRate(c);
    expect(writes('/rate')).toBe(1);
    expect(dialogEl()).toBeNull();
    for (const label of ['Đơn giá · Lan', 'Đơn giá · Mai']) {
      const b = rateOf(c, label);
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('aria-busy')).toBe('true');
      expect(b.disabled).toBe(false);
      click(b);
      await flush();
      expect(dialogEl()).toBeNull();
    }
    list.resolve();
    await flush(3);
    expect(rateOf(c, 'Đơn giá · Lan').hasAttribute('aria-disabled')).toBe(false);
    click(rateOf(c, 'Đơn giá · Lan'));
    await flush();
    expect(dialogEl()!.querySelector<HTMLInputElement>('input[type=number]')!.value).toBe('50000');
    expect(writes('/rate')).toBe(1);
  });

  it('Sửa giờ phiên: chi tiết chưa về thì nút Sửa giờ cũ không mở form (khỏi nạp giờ cũ); chi tiết về thì mở form với giờ mới', async () => {
    const c = await mount();
    await openDetailEdit(c);
    const held = gate();
    routes.detail = () =>
      held.promise.then(() =>
        json(200, { ...DETAIL, sessions: [{ ...DETAIL.sessions[0], checkinAt: '2026-10-19T01:30:00.000Z', checkoutAt: '2026-10-19T10:00:00.000Z' }] }),
      );
    await doSaveHours();
    expect(writes('/attendance/session/ss1/edit')).toBe(1);
    const stale = document.querySelector<HTMLButtonElement>('[aria-label="Sửa giờ phiên 08:00"]')!;
    expect(stale.getAttribute('aria-disabled')).toBe('true');
    expect(stale.getAttribute('aria-busy')).toBe('true');
    expect(stale.disabled).toBe(false);
    click(stale);
    await flush();
    expect(document.querySelectorAll('[role=dialog] input[type=time]')).toHaveLength(0);
    held.resolve();
    await flush(3);
    click(document.querySelector('[aria-label="Sửa giờ phiên 08:30"]'));
    await flush();
    const times = document.querySelectorAll<HTMLInputElement>('[role=dialog] input[type=time]');
    expect([times[0]!.value, times[1]!.value]).toEqual(['08:30', '17:00']);
  });

  it('Ghi đã trả: bảng lương chưa về thì nút Ghi đã trả lương không mở lại tờ; bảng về thì mở được', async () => {
    const c = await mount();
    const list = holdList();
    await doPaid(c);
    expect(writes('/mark-paid')).toBe(1);
    const b = q(c, 'Ghi đã trả lương · Mai');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.disabled).toBe(false);
    click(b);
    await flush();
    expect(dialogEl()).toBeNull();
    list.resolve();
    await flush(3);
    click(q(c, 'Ghi đã trả lương · Mai'));
    await flush();
    expect(dialogEl()).not.toBeNull();
    expect(writes('/mark-paid')).toBe(1);
  });
});
