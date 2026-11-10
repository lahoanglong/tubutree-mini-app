// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminPayrollRow } from '@tubutree/app-core/api/payroll';
import { PayrollAdjustSheet } from './payroll-adjust-sheet';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { currentVnYearMonth } from '@/lib/week';

// W96B: Thưởng/phạt không xoá được nên khoá đồng bộ phủ cả đường hỏi lẫn đường gửi, kể cả nhánh 409 "khoản giống hệt" (Huỷ → tính lại):
// nút báo bận bằng aria-busy/aria-disabled (không disabled khi đang chạy), nhả ở MỌI đường, lệnh bị từ chối vì bảng đã cũ thì tải lại bảng.
// Mini không có màn Thưởng/phạt; đây là hành vi riêng của web.

const { year, month } = currentVnYearMonth();
const ROW = {
  staff: { id: '1', fullName: 'Lan', phone: '0900000001' },
  month: { year, month, totalMinutes: 125, gross: 500_000, totalFines: 0, net: 480_000, status: 'OPEN', paidAt: null, proofImageUrl: null, note: null },
  profile: { hourlyRate: 40_000, bankBin: null, bankAccountNo: '123', bankAccountName: 'LAN', qrImageUrl: null, active: true },
  qrImageUrl: null,
} as unknown as AdminPayrollRow;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const DUP = { statusCode: 409, code: 'PAYROLL_ADJUST_DUPLICATE', message: 'Đã có khoản trừ 50.000đ giống hệt vừa ghi — lần gửi này CHƯA được ghi.' };

type Route = (body: Record<string, unknown> | undefined) => Promise<Response> | Response;
const routes: { adjust: Route; recompute: Route } = { adjust: () => json(200, { adjusted: true }), recompute: () => json(200, {}) };
const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
const adjusts = () => calls.filter((c) => c.url.includes('/admin/payroll/adjust'));
const recomputes = () => calls.filter((c) => c.url.includes('/recompute'));

const onClose = vi.fn();
const onDone = vi.fn();
const onStale = vi.fn<() => unknown>();
let mounted: Rendered | null = null;

beforeEach(() => {
  calls.length = 0;
  onClose.mockReset();
  onDone.mockReset();
  onStale.mockReset();
  onStale.mockImplementation(() => Promise.resolve());
  routes.adjust = () => json(200, { adjusted: true });
  routes.recompute = () => json(200, {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, url, body });
      if (url.includes('/admin/payroll/adjust')) return routes.adjust(body);
      if (url.includes('/recompute')) return routes.recompute(body);
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
  mounted = render(<PayrollAdjustSheet row={ROW} year={year} month={month} onClose={onClose} onDone={onDone} onStale={onStale} />);
  await flush();
};
const sheet = () => document.querySelector<HTMLElement>('[role=dialog]')!;
const submitBtn = () => sheet().querySelector<HTMLButtonElement>('[data-adjust-submit]')!;
const fill = () => {
  click(byText(sheet(), 'button[aria-pressed]', 'Phạt'));
  typeInto(sheet().querySelector('input[inputmode=numeric]'), '50000');
  typeInto(sheet().querySelector('textarea'), 'Đi trễ');
};
const isBusy = (b: HTMLElement) => b.getAttribute('aria-busy') === 'true';
const alertText = (root: ParentNode) => Array.from(root.querySelectorAll('[role="alert"]')).map((a) => a.textContent).join(' | ');
const tap = (...els: HTMLElement[]) =>
  act(async () => {
    for (const e of els) e.click();
  });
const esc = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const review = async () => {
  click(submitBtn());
  await flush();
};
const writeAfterConfirm = async () => {
  await review();
  answerConfirm(true);
  await flush(3);
};

describe('đang gửi khoản', () => {
  it('nút báo bận bằng aria-busy + aria-disabled, KHÔNG disabled (giữ focus), đổi chữ; chạm lại không mở hộp và chỉ có một lần ghi', async () => {
    await mount();
    fill();
    const held = gate();
    routes.adjust = () => held.promise.then(() => json(200, { adjusted: true }));
    await writeAfterConfirm();
    expect(adjusts()).toHaveLength(1);
    const b = submitBtn();
    expect(b.textContent).toBe('Đang ghi…');
    expect(isBusy(b)).toBe(true);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    expect(b.classList.contains('aria-disabled:opacity-60')).toBe(true);
    await tap(b, b);
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(adjusts()).toHaveLength(1);
    held.resolve();
    await flush(3);
    expect(adjusts()).toHaveLength(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('chưa hợp lệ (thiếu lý do) vẫn disabled thật: lý do cứng khác với bận', async () => {
    await mount();
    expect(submitBtn().disabled).toBe(true);
    click(byText(sheet(), 'button[aria-pressed]', 'Phạt'));
    typeInto(sheet().querySelector('input[inputmode=numeric]'), '50000');
    expect(submitBtn().disabled).toBe(true);
    typeInto(sheet().querySelector('textarea'), 'Đi trễ');
    expect(submitBtn().disabled).toBe(false);
  });

  it('hai lần chạm sát nhau trước khi hộp xác nhận mở: chỉ một hộp, xác nhận một lần gửi đúng một khoản', async () => {
    await mount();
    fill();
    await tap(submitBtn(), submitBtn());
    await flush();
    expect(document.querySelectorAll('[role=alertdialog]')).toHaveLength(1);
    answerConfirm(true);
    await flush(3);
    expect(adjusts()).toHaveLength(1);
  });

  it('lệnh ghi lỗi 500: lời lỗi trong tờ, nhả khoá và ghi lại được (tờ không gọi tải lại bảng)', async () => {
    await mount();
    fill();
    routes.adjust = () => json(500, { message: 'x' });
    await writeAfterConfirm();
    expect(alertText(sheet())).toContain('Máy chủ đang bận');
    expect(isBusy(submitBtn())).toBe(false);
    expect(onStale).not.toHaveBeenCalled();
    routes.adjust = () => json(200, { adjusted: true });
    await writeAfterConfirm();
    expect(adjusts()).toHaveLength(2);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('bỏ hộp xác nhận: nhả khoá, mở lại hộp được và không ghi gì', async () => {
    await mount();
    fill();
    await review();
    answerConfirm(false);
    await flush();
    expect(adjusts()).toHaveLength(0);
    expect(isBusy(submitBtn())).toBe(false);
    await review();
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(true);
    await flush(3);
    expect(adjusts()).toHaveLength(1);
  });
});

describe('khoản giống hệt (409): Huỷ → tính lại vẫn giữ khoá', () => {
  const duplicateThenCancel = async () => {
    await mount();
    fill();
    routes.adjust = () => json(409, DUP);
    await writeAfterConfirm();
    expect(confirmDialog()!.textContent).toContain('CHƯA được ghi');
  };

  it('trong lúc tính lại sau khi Huỷ: nút aria-busy, chạm lại không mở hộp/không ghi thêm, Esc không đóng tờ; xong thì nhả và hỏi lại được', async () => {
    await duplicateThenCancel();
    const held = gate();
    routes.recompute = () => held.promise.then(() => json(200, {}));
    answerConfirm(false);
    await flush(2);
    expect(recomputes()).toHaveLength(1);
    expect(adjusts()).toHaveLength(1);
    expect(isBusy(submitBtn())).toBe(true);
    expect(submitBtn().disabled).toBe(false);
    await tap(submitBtn(), submitBtn());
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(adjusts()).toHaveLength(1);
    expect(sheet().querySelector('[aria-label="Đóng"]')).toBeNull();
    esc();
    expect(sheet()).not.toBeNull();
    held.resolve();
    await flush(3);
    expect(isBusy(submitBtn())).toBe(false);
    expect(sheet().querySelector('[role=status]')!.textContent).toContain('Đã cập nhật số lương trên dòng');
    routes.adjust = () => json(409, DUP);
    await review();
    expect(confirmDialog()).not.toBeNull();
    expect(adjusts()).toHaveLength(1);
  });

  it('"Vẫn ghi thêm" đang gửi: nút còn bận, chạm lại không mở hộp/không ghi thêm, Esc không đóng tờ; xong thì tờ đóng', async () => {
    await duplicateThenCancel();
    const held = gate();
    routes.adjust = (body) => (body?.allowDuplicate ? held.promise.then(() => json(200, { adjusted: true })) : json(409, DUP));
    answerConfirm(true);
    await flush(3);
    expect(adjusts()).toHaveLength(2);
    expect(isBusy(submitBtn())).toBe(true);
    await tap(submitBtn(), submitBtn());
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(adjusts()).toHaveLength(2);
    esc();
    expect(sheet()).not.toBeNull();
    held.resolve();
    await flush(3);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tính lại sau khi Huỷ lỗi: vẫn nhả khoá và báo cách bấm Tính lại tháng', async () => {
    await duplicateThenCancel();
    routes.recompute = () => json(500, { message: 'x' });
    answerConfirm(false);
    await flush(3);
    expect(sheet().querySelector('[role=status]')!.textContent).toContain('bấm Tính lại tháng');
    expect(isBusy(submitBtn())).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('"Vẫn ghi thêm": gửi đúng một lệnh allowDuplicate, rồi báo xong và đóng tờ một lần', async () => {
    await duplicateThenCancel();
    routes.adjust = (body) => (body?.allowDuplicate ? json(200, { adjusted: true }) : json(409, DUP));
    answerConfirm(true);
    await flush(4);
    expect(adjusts()).toHaveLength(2);
    expect(adjusts()[1]!.body).toMatchObject({ allowDuplicate: true });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('409 khoản giống hệt không phải từ chối vì bảng cũ: tờ không gọi tải lại bảng (onStale)', async () => {
    await duplicateThenCancel();
    answerConfirm(false);
    await flush(3);
    expect(onStale).not.toHaveBeenCalled();
  });
});

describe('lệnh bị từ chối vì bảng lương đã cũ: tải lại rồi mới nhả khoá', () => {
  const STALE = 'Tháng lương đã chốt/đã trả — mở lại tháng trước khi điều chỉnh.';

  it('bị 400 (số tiền hoặc lý do không hợp lệ): lời lỗi trong tờ ngay, KHÔNG gọi tải lại bảng, nhả khoá ngay để sửa rồi ghi lại', async () => {
    await mount();
    fill();
    routes.adjust = () => json(400, { message: 'Lý do điều chỉnh cần ít nhất 3 ký tự.' });
    const held = gate();
    onStale.mockImplementation(() => held.promise);
    await writeAfterConfirm();
    expect(alertText(sheet())).toContain('Lý do điều chỉnh cần ít nhất 3 ký tự.');
    expect(onStale).not.toHaveBeenCalled();
    expect(isBusy(submitBtn())).toBe(false);
    expect(adjusts()).toHaveLength(1);
    routes.adjust = () => json(200, { adjusted: true });
    await writeAfterConfirm();
    expect(adjusts()).toHaveLength(2);
    held.resolve();
  });

  it.each([[404], [409]])('bị %i: lời lỗi trong tờ ngay, gọi tải lại bảng một lần, khoá chỉ nhả khi tải lại xong', async (status) => {
    await mount();
    fill();
    routes.adjust = () => json(status, { message: STALE });
    const held = gate();
    onStale.mockImplementation(() => held.promise);
    await writeAfterConfirm();
    expect(alertText(sheet())).toContain(STALE);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(isBusy(submitBtn())).toBe(true);
    await tap(submitBtn());
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(adjusts()).toHaveLength(1);
    held.resolve();
    await flush(3);
    expect(isBusy(submitBtn())).toBe(false);
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it('tải lại treo: nhả khoá sau hạn 4 giây, không sớm hơn', async () => {
    await mount();
    fill();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    routes.adjust = () => json(404, { message: STALE });
    onStale.mockImplementation(() => new Promise(() => undefined));
    await writeAfterConfirm();
    await advance(3_500);
    expect(isBusy(submitBtn())).toBe(true);
    await advance(1_000);
    await flush();
    expect(isBusy(submitBtn())).toBe(false);
  });

  it.each([[500], [403]])('lỗi %i không nói gì về trạng thái thật: tờ không gọi tải lại bảng (onStale)', async (status) => {
    await mount();
    fill();
    routes.adjust = () => json(status, { message: 'Không đủ quyền.' });
    await writeAfterConfirm();
    expect(onStale).not.toHaveBeenCalled();
    expect(isBusy(submitBtn())).toBe(false);
  });
});

describe('số tiền dùng tabular-nums', () => {
  it('ô nhập số tiền', async () => {
    await mount();
    expect(sheet().querySelector('input[inputmode=numeric]')!.classList.contains('tabular-nums')).toBe(true);
  });
});
