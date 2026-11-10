// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

const m = vi.hoisted(() => ({ fetchMyRefunds: vi.fn(), chooseRefundDestination: vi.fn(), fetchRefundBank: vi.fn() }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchMyRefunds: (...a: unknown[]) => m.fetchMyRefunds(...a),
  chooseRefundDestination: (...a: unknown[]) => m.chooseRefundDestination(...a),
  fetchRefundBank: () => m.fetchRefundBank(),
}));

import { OrderRefunds } from './order-refunds';

const LATE = {
  id: 'r1',
  orderId: 'o1',
  orderCode: 'TB1',
  kind: 'LATE_PAYMENT',
  amount: 197_000,
  method: 'MANUAL_TRANSFER',
  status: 'PENDING',
  bankName: null,
  bankAccountNo: null,
  bankAccountName: null,
  bankRef: null,
  completedAt: null,
  createdAt: '2026-10-14T00:00:00Z',
  canChooseDestination: true,
};
const RETURN_REFUND = {
  ...LATE,
  id: 'r2',
  kind: 'RETURN',
  refKey: 'rq1',
  amount: 50_000,
  method: 'WALLET',
  status: 'COMPLETED',
  completedAt: '2026-10-14T03:05:00Z',
  canChooseDestination: false,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let mounted: Rendered[] = [];
beforeEach(() => {
  m.fetchMyRefunds.mockReset().mockResolvedValue([LATE]);
  m.chooseRefundDestination.mockReset().mockResolvedValue(LATE);
  m.fetchRefundBank.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

const mount = async (returnRequestIds?: ReadonlySet<string>) => {
  const r = render(<OrderRefunds orderId="o1" returnRequestIds={returnRequestIds} />);
  mounted.push(r);
  await flush(3);
  return r;
};
const button = (r: Rendered, text: string) =>
  [...r.container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const field = (r: Rendered, label: string) =>
  [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!;
const openSheet = async (r: Rendered) => {
  click(button(r, 'Chọn nơi nhận tiền')!);
  await flush(2);
  return button(r, 'Xác nhận')!;
};
const pickBank = async (r: Rendered) => {
  click(r.container.querySelector<HTMLInputElement>('input[type="radio"][value="BANK"]'));
  await flush(3);
};
const fillBank = (r: Rendered) => {
  typeInto(field(r, 'Tên ngân hàng'), 'Techcombank');
  typeInto(field(r, 'Số tài khoản'), '0123456789');
  typeInto(field(r, 'Chủ tài khoản'), 'NGUYEN AN');
};
const doubleClick = (el: HTMLElement) =>
  act(async () => {
    click(el);
    click(el);
  });

describe('OrderRefunds (web): khoản hoàn của yêu cầu trả hàng không lặp (returnRequestIds)', () => {
  it('khoản hoàn thuộc một yêu cầu trả hàng đã có dòng riêng: không lặp ở khối Hoàn tiền, khoản khác vẫn hiện', async () => {
    m.fetchMyRefunds.mockResolvedValue([LATE, RETURN_REFUND]);
    const r = await mount(new Set(['rq1']));
    expect(r.container.textContent).toContain('197.000');
    expect(r.container.textContent).not.toContain('50.000');
  });

  it.each([
    ['không truyền returnRequestIds', undefined, RETURN_REFUND],
    ['refKey không nằm trong tập yêu cầu', new Set(['rq-khac']), RETURN_REFUND],
    ['khoản không phải trả hàng dù refKey trùng', new Set(['rq1']), { ...RETURN_REFUND, kind: 'CANCEL' }],
    ['khoản trả hàng chưa có refKey (API cũ)', new Set(['rq1']), { ...RETURN_REFUND, refKey: undefined }],
  ] as const)('%s: khoản vẫn hiện', async (_name, ids, refund) => {
    m.fetchMyRefunds.mockResolvedValue([refund]);
    const r = await mount(ids);
    expect(r.container.textContent).toContain('50.000');
  });

  it('mọi khoản đều của yêu cầu trả hàng: không vẽ khối Hoàn tiền', async () => {
    m.fetchMyRefunds.mockResolvedValue([RETURN_REFUND]);
    const r = await mount(new Set(['rq1']));
    expect(m.fetchMyRefunds).toHaveBeenCalledWith('o1');
    expect(r.container.innerHTML).toBe('');
  });
});

describe('ChooseDestination (web): khoá lưu đồng bộ', () => {
  it('hai cú bấm "Xác nhận" sát nhau trước khi vẽ lại: chỉ gọi API một lần', async () => {
    const d = deferred<typeof LATE>();
    m.chooseRefundDestination.mockReturnValue(d.promise);
    const r = await mount();
    const confirm = await openSheet(r);
    await doubleClick(confirm);
    expect(m.chooseRefundDestination).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(LATE));
    await flush(3);
  });

  it('đang lưu: "Xác nhận" đổi chữ và khoá, "Để sau" khoá, bấm thêm không gọi API; xong thì sheet đóng kèm lời xác nhận', async () => {
    const d = deferred<typeof LATE>();
    m.chooseRefundDestination.mockReturnValue(d.promise);
    const r = await mount();
    const confirm = await openSheet(r);
    await act(async () => click(confirm));
    expect(confirm.textContent).toBe('Đang lưu…');
    expect(confirm.hasAttribute('disabled')).toBe(false);
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(button(r, 'Để sau')!.disabled).toBe(true);
    await act(async () => click(confirm));
    expect(m.chooseRefundDestination).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(LATE));
    await flush(3);
    expect(r.container.querySelector('[role="group"]')).toBeNull();
    expect(r.container.querySelector('[role="status"]')?.textContent).toBe('Đã hoàn 197.000đ vào Ví Tubu.');
  });

  it('API lỗi: báo lỗi role="alert", nút mở khoá và khoá ref nhả, bấm lại gọi lần hai', async () => {
    m.chooseRefundDestination.mockRejectedValueOnce(new Error('lỗi mạng')).mockResolvedValue(LATE);
    const r = await mount();
    const confirm = await openSheet(r);
    await act(async () => click(confirm));
    await flush(3);
    expect(r.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(confirm.disabled).toBe(false);
    expect(confirm.textContent).toBe('Xác nhận');
    await act(async () => click(confirm));
    expect(m.chooseRefundDestination).toHaveBeenCalledTimes(2);
  });

  it('thiếu tài khoản: không gọi API, không giữ khoá; sửa xong bấm lại gọi được', async () => {
    const r = await mount();
    const confirm = await openSheet(r);
    await pickBank(r);
    await act(async () => click(confirm));
    expect(m.chooseRefundDestination).not.toHaveBeenCalled();
    expect(r.container.querySelector('[role="alert"]')).not.toBeNull();
    fillBank(r);
    await act(async () => click(confirm));
    expect(m.chooseRefundDestination).toHaveBeenCalledTimes(1);
    expect(m.chooseRefundDestination).toHaveBeenCalledWith('r1', {
      refundMethod: 'BANK',
      bankName: 'Techcombank',
      accountNumber: '0123456789',
      accountName: 'NGUYEN AN',
    });
  });

  it('lưu tài khoản ngân hàng: lời xác nhận nói Tubu chuyển khoản trong 1-3 ngày làm việc', async () => {
    const r = await mount();
    const confirm = await openSheet(r);
    await pickBank(r);
    fillBank(r);
    await act(async () => click(confirm));
    await flush(3);
    expect(r.container.querySelector('[role="status"]')?.textContent).toBe('Đã lưu tài khoản. Tubu sẽ chuyển khoản trong 1-3 ngày làm việc.');
  });
});

describe('ChooseDestination (web): chỉ Ví Tubu mới làm mới số dư', () => {
  let inv: MockInstance<QueryClient['invalidateQueries']>;
  beforeEach(() => {
    inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
  });
  afterEach(() => inv.mockRestore());
  const keys = () => inv.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

  it('chọn Ví Tubu: làm mới khoản hoàn của đơn và mọi số dư', async () => {
    const r = await mount();
    const confirm = await openSheet(r);
    await act(async () => click(confirm));
    await flush(3);
    expect(keys()).toEqual(expect.arrayContaining(['["my-refunds","o1"]', '["me"]', '["wallet"]', '["wallet-txn"]', '["points-txn"]']));
  });

  it('chọn tài khoản ngân hàng: chỉ làm mới khoản hoàn, không động tới số dư', async () => {
    const r = await mount();
    const confirm = await openSheet(r);
    await pickBank(r);
    fillBank(r);
    await act(async () => click(confirm));
    await flush(3);
    expect(keys()).toContain('["my-refunds","o1"]');
    for (const k of ['["me"]', '["wallet"]', '["wallet-txn"]', '["points-txn"]']) expect(keys()).not.toContain(k);
  });

  it('đổi radio sang Ngân hàng lúc đang lưu Ví Tubu: vẫn làm mới số dư và báo đúng điều đã gửi', async () => {
    const d = deferred<typeof LATE>();
    m.chooseRefundDestination.mockReturnValue(d.promise);
    const r = await mount();
    const confirm = await openSheet(r);
    await act(async () => click(confirm));
    click(r.container.querySelector<HTMLInputElement>('input[type="radio"][value="BANK"]'));
    await act(async () => d.resolve(LATE));
    await flush(3);
    expect(m.chooseRefundDestination).toHaveBeenCalledWith('r1', { refundMethod: 'WALLET' });
    expect(keys()).toEqual(expect.arrayContaining(['["wallet"]', '["me"]']));
    expect(r.container.querySelector('[role="status"]')?.textContent).toBe('Đã hoàn 197.000đ vào Ví Tubu.');
  });

  it('đổi radio sang Ví Tubu lúc đang lưu tài khoản ngân hàng: không làm mới số dư và báo đúng điều đã gửi', async () => {
    const d = deferred<typeof LATE>();
    m.chooseRefundDestination.mockReturnValue(d.promise);
    const r = await mount();
    const confirm = await openSheet(r);
    await pickBank(r);
    fillBank(r);
    await act(async () => click(confirm));
    click(r.container.querySelector<HTMLInputElement>('input[type="radio"][value="WALLET"]'));
    await act(async () => d.resolve(LATE));
    await flush(3);
    expect(m.chooseRefundDestination).toHaveBeenCalledWith('r1', expect.objectContaining({ refundMethod: 'BANK' }));
    expect(keys()).not.toContain('["wallet"]');
    expect(keys()).not.toContain('["me"]');
    expect(r.container.querySelector('[role="status"]')?.textContent).toBe('Đã lưu tài khoản. Tubu sẽ chuyển khoản trong 1-3 ngày làm việc.');
  });

  it('API lỗi: không làm mới gì', async () => {
    m.chooseRefundDestination.mockRejectedValue(new Error('lỗi mạng'));
    const r = await mount();
    const confirm = await openSheet(r);
    await act(async () => click(confirm));
    await flush(3);
    expect(keys()).not.toContain('["my-refunds","o1"]');
    expect(keys()).not.toContain('["wallet"]');
  });
});
