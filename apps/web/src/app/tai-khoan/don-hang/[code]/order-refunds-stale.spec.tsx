// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ApiError, NetworkError } from '@/lib/client-api';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// Mini App order-refunds.spec.tsx (W104A): "Chọn nơi nhận tiền" bị máy chủ từ chối vì khoản hoàn đã sang bước khác (400/404/409/422) thì tải
// lại khoản hoàn và số dư, khoá giữ tới lúc dữ liệu về (hạn 4 giây), form đóng khi khoản không còn chọn được nữa; lỗi tạm (401, 403, 5xx, mất mạng)
// để nguyên. Khác Mini App: lời lỗi nằm trong khối (không có snackbar) nên phải hiện ngay và còn lại sau khi form đóng.

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
const CLOSED = { ...LATE, method: 'WALLET', status: 'COMPLETED', completedAt: '2026-10-14T03:05:00Z', canChooseDestination: false };

const STALE = [
  [400, 'Khoản hoàn này đã được xử lý.'],
  [404, 'Không tìm thấy khoản hoàn.'],
  [409, 'Khoản hoàn vừa được chọn ở máy khác.'],
  [422, 'Khoản hoàn này không còn chọn được nơi nhận.'],
] as const;
const TRANSIENT: Array<[string, () => Error]> = [
  ['401', () => new ApiError('Phiên đăng nhập hết hạn', 401, 'SESSION_EXPIRED')],
  ['403', () => new ApiError('Không có quyền', 403)],
  ['500', () => new ApiError('Máy chủ lỗi', 500)],
  ['502', () => new ApiError('Cổng lỗi', 502)],
  ['503', () => new ApiError('Máy chủ bận', 503)],
  ['mất mạng', () => new NetworkError(false)],
  ['quá hạn', () => new NetworkError(true)],
];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let mounted: Rendered[] = [];
let client: QueryClient;
let inv: MockInstance<QueryClient['invalidateQueries']>;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  m.fetchMyRefunds.mockReset().mockResolvedValue([LATE]);
  m.chooseRefundDestination.mockReset().mockResolvedValue(LATE);
  m.fetchRefundBank.mockReset().mockResolvedValue(null);
  inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
  inv.mockRestore();
  vi.useRealTimers();
});

const mount = async () => {
  const r = render(<OrderRefunds orderId="o1" />, client);
  mounted.push(r);
  await flush(3);
  return r;
};
const button = (r: Rendered, text: string) =>
  [...r.container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const confirmOf = (r: Rendered) => [...r.container.querySelectorAll('[role="group"] button')].find((b) => b.textContent === 'Xác nhận' || b.textContent === 'Đang lưu…') as HTMLButtonElement;
const openForm = async (r: Rendered) => {
  click(button(r, 'Chọn nơi nhận tiền')!);
  await flush(2);
  return confirmOf(r);
};
const form = (r: Rendered) => r.container.querySelector('[role="group"]');
const alertText = (r: Rendered) => r.container.querySelector('[role="alert"]')?.textContent ?? null;
const keys = () => inv.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
const twice = (el: HTMLElement) =>
  act(async () => {
    click(el);
    click(el);
  });

describe('ChooseDestination (web): máy chủ từ chối vì khoản hoàn đã đổi (400/404/409/422)', () => {
  it.each(STALE)('%i: lời lỗi hiện ngay, khoản hoàn và số dư được tải lại, nút giữ khoá tới lúc dữ liệu về', async (status, message) => {
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValue(new ApiError(message, status));
    const refresh = deferred<unknown[]>();
    m.fetchMyRefunds.mockReturnValue(refresh.promise);
    confirm.focus();
    await act(async () => click(confirm));
    await flush(3);
    expect(alertText(r)).toBe(message);
    expect(m.fetchMyRefunds).toHaveBeenCalledTimes(2);
    expect(keys()).toEqual(expect.arrayContaining(['["my-refunds","o1"]', '["wallet"]', '["me"]']));
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(confirm.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(confirm);
    await twice(confirm);
    expect(m.chooseRefundDestination).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve([LATE]));
    await flush(4);
    expect(confirm.hasAttribute('aria-busy')).toBe(false);
  });

  it('khoản hoàn đã đóng sau khi tải lại: form tự đóng, lời lỗi ở lại trong khối, nút "Chọn nơi nhận tiền" không còn', async () => {
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValue(new ApiError('Khoản hoàn vừa được chọn ở máy khác.', 409));
    const refresh = deferred<unknown[]>();
    m.fetchMyRefunds.mockReturnValue(refresh.promise);
    await act(async () => click(confirm));
    await flush(3);
    expect(form(r)).not.toBeNull();
    await act(async () => refresh.resolve([CLOSED]));
    await flush(4);
    expect(form(r)).toBeNull();
    expect(alertText(r)).toBe('Khoản hoàn vừa được chọn ở máy khác.');
    expect(button(r, 'Chọn nơi nhận tiền')).toBeUndefined();
  });

  it('lời từ chối còn lại sau khi form đóng: mở lại form (khoản hoàn chọn được trở lại) thì lời cũ biến mất', async () => {
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValue(new ApiError('Khoản hoàn vừa được chọn ở máy khác.', 409));
    m.fetchMyRefunds.mockResolvedValue([CLOSED]);
    await act(async () => click(confirm));
    await flush(4);
    expect(form(r)).toBeNull();
    expect(alertText(r)).toBe('Khoản hoàn vừa được chọn ở máy khác.');
    m.fetchMyRefunds.mockResolvedValue([LATE]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['my-refunds', 'o1'] });
    });
    await flush(3);
    await openForm(r);
    expect(form(r)).not.toBeNull();
    expect(alertText(r)).toBeNull();
  });

  it('khoản hoàn vẫn chọn được sau khi tải lại: form ở lại, lời lỗi còn, bấm lại gửi được', async () => {
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValueOnce(new ApiError('Lịch vừa đổi, hãy thử lại.', 409)).mockResolvedValue(LATE);
    await act(async () => click(confirm));
    await flush(4);
    expect(form(r)).not.toBeNull();
    expect(alertText(r)).toBe('Lịch vừa đổi, hãy thử lại.');
    expect(confirm.hasAttribute('aria-busy')).toBe(false);
    await act(async () => click(confirm));
    await flush(3);
    expect(m.chooseRefundDestination).toHaveBeenCalledTimes(2);
    expect(r.container.querySelector('[role="status"]')?.textContent).toBe('Đã hoàn 197.000đ vào Ví Tubu.');
  });

  it('lần gửi lại xoá lời lỗi cũ', async () => {
    const r = await mount();
    const confirm = await openForm(r);
    const second = deferred<typeof LATE>();
    m.chooseRefundDestination.mockRejectedValueOnce(new ApiError('Lịch vừa đổi, hãy thử lại.', 409)).mockReturnValue(second.promise);
    await act(async () => click(confirm));
    await flush(4);
    expect(alertText(r)).toBe('Lịch vừa đổi, hãy thử lại.');
    await act(async () => click(confirm));
    expect(alertText(r)).toBeNull();
    await act(async () => second.resolve(LATE));
    await flush(3);
  });

  it('tải lại treo mãi: khoá nhả đúng sau 4 giây, không sớm hơn, rồi bấm lại gửi được', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValueOnce(new ApiError('Khoản hoàn đã được xử lý.', 400)).mockResolvedValue(LATE);
    m.fetchMyRefunds.mockReturnValue(new Promise(() => undefined));
    await act(async () => click(confirm));
    await flush(3);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_900);
    });
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    await act(async () => click(confirm));
    expect(m.chooseRefundDestination).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await flush(2);
    expect(confirm.hasAttribute('aria-busy')).toBe(false);
    expect(alertText(r)).toBe('Khoản hoàn đã được xử lý.');
    await act(async () => click(confirm));
    await flush(3);
    expect(m.chooseRefundDestination).toHaveBeenCalledTimes(2);
  });

  it('khoản hoàn đổi trong lúc lệnh còn bay: form không đóng giữa chừng, lệnh xong thì báo kết quả', async () => {
    const r = await mount();
    const confirm = await openForm(r);
    const post = deferred<typeof LATE>();
    m.chooseRefundDestination.mockReturnValue(post.promise);
    await act(async () => click(confirm));
    m.fetchMyRefunds.mockResolvedValue([CLOSED]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['my-refunds', 'o1'] });
    });
    await flush(3);
    expect(form(r)).not.toBeNull();
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    await act(async () => post.resolve(LATE));
    await flush(3);
    expect(form(r)).toBeNull();
    expect(r.container.querySelector('[role="status"]')?.textContent).toBe('Đã hoàn 197.000đ vào Ví Tubu.');
  });

  it('khoản hoàn bị đóng bởi dữ liệu nền (không có lệnh nào bay): form tự đóng, không báo lỗi', async () => {
    const r = await mount();
    await openForm(r);
    m.fetchMyRefunds.mockResolvedValue([CLOSED]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['my-refunds', 'o1'] });
    });
    await flush(3);
    expect(form(r)).toBeNull();
    expect(alertText(r)).toBeNull();
  });
});

describe('ChooseDestination (web): hoàn về tài khoản ngân hàng — mọi 400 máy chủ trả ở đây là trạng thái khoản hoàn', () => {
  const openBankForm = async (r: Rendered, accountNumber = '190312345678') => {
    const confirm = await openForm(r);
    click(r.container.querySelector<HTMLInputElement>('input[type="radio"][value="BANK"]'));
    await flush(2);
    const set = (label: string, value: string) =>
      typeInto([...r.container.querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent === label) ?? null, value);
    set('Tên ngân hàng', 'Techcombank');
    set('Số tài khoản', accountNumber);
    set('Chủ tài khoản', 'NGUYEN VAN A');
    await flush(1);
    return confirm;
  };

  it('số tài khoản sai: form chặn trước, không gọi API, không tải lại, khoá không giữ', async () => {
    const r = await mount();
    const confirm = await openBankForm(r, '12');
    await act(async () => click(confirm));
    await flush(3);
    expect(m.chooseRefundDestination).not.toHaveBeenCalled();
    expect(m.fetchMyRefunds).toHaveBeenCalledTimes(1);
    expect(keys()).not.toContain('["my-refunds","o1"]');
    expect(confirm.hasAttribute('aria-busy')).toBe(false);
  });

  const BANK_STALE = [
    [400, 'Tubu đang chuyển khoản khoản này về Techcombank ••5678 nên không đổi được nơi nhận nữa.'],
    [400, 'Khoản hoàn này đã được xử lý, không đổi được nơi nhận nữa.'],
    [404, 'Không tìm thấy khoản hoàn.'],
    [409, 'Khoản hoàn vừa được chọn ở máy khác.'],
    [422, 'Khoản hoàn này không còn chọn được nơi nhận.'],
  ] as const;
  it.each(BANK_STALE)('%i "%s": lời lỗi hiện ngay, khoản hoàn và số dư được tải lại, khoá giữ tới lúc dữ liệu về', async (status, message) => {
    const r = await mount();
    const confirm = await openBankForm(r);
    m.chooseRefundDestination.mockRejectedValue(new ApiError(message, status));
    const refresh = deferred<unknown[]>();
    m.fetchMyRefunds.mockReturnValue(refresh.promise);
    confirm.focus();
    await act(async () => click(confirm));
    await flush(3);
    expect(alertText(r)).toBe(message);
    expect(m.fetchMyRefunds).toHaveBeenCalledTimes(2);
    expect(keys()).toEqual(expect.arrayContaining(['["my-refunds","o1"]', '["wallet"]', '["me"]']));
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(confirm);
    await twice(confirm);
    expect(m.chooseRefundDestination).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve([LATE]));
    await flush(4);
    expect(confirm.hasAttribute('aria-busy')).toBe(false);
  });

  it('400 "đã xử lý" rồi khoản hoàn đóng: form tự đóng, lời lỗi ở lại trong khối', async () => {
    const r = await mount();
    const confirm = await openBankForm(r);
    m.chooseRefundDestination.mockRejectedValue(new ApiError('Khoản hoàn này đã được xử lý, không đổi được nơi nhận nữa.', 400));
    m.fetchMyRefunds.mockResolvedValue([CLOSED]);
    await act(async () => click(confirm));
    await flush(4);
    expect(form(r)).toBeNull();
    expect(alertText(r)).toBe('Khoản hoàn này đã được xử lý, không đổi được nơi nhận nữa.');
  });
});

describe('ChooseDestination (web): lỗi tạm không nói gì về trạng thái thật của khoản hoàn', () => {
  it.each(TRANSIENT)('%s: không tải lại gì, lời lỗi hiện, khoá nhả ngay, bấm lại gửi được', async (_name, makeError) => {
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValueOnce(makeError()).mockResolvedValue(LATE);
    await act(async () => click(confirm));
    await flush(3);
    expect(m.fetchMyRefunds).toHaveBeenCalledTimes(1);
    expect(keys()).not.toContain('["my-refunds","o1"]');
    expect(keys()).not.toContain('["wallet"]');
    expect(alertText(r)).not.toBeNull();
    expect(form(r)).not.toBeNull();
    expect(confirm.hasAttribute('aria-busy')).toBe(false);
    await act(async () => click(confirm));
    expect(m.chooseRefundDestination).toHaveBeenCalledTimes(2);
  });
});

describe('ChooseDestination (web): "Xác nhận" giữ focus khi đang lưu', () => {
  it('đang lưu: aria-busy + aria-disabled, KHÔNG disabled, vẫn giữ focus', async () => {
    const post = deferred<typeof LATE>();
    m.chooseRefundDestination.mockReturnValue(post.promise);
    const r = await mount();
    const confirm = await openForm(r);
    confirm.focus();
    await act(async () => click(confirm));
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(confirm.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(confirm);
    await act(async () => post.resolve(LATE));
    await flush(3);
  });
});

describe('OrderRefunds (web): số tiền thẳng hàng', () => {
  it('khối Hoàn tiền dùng tabular-nums và form chọn nơi nhận mở ra nằm trong khối đó', async () => {
    const r = await mount();
    const section = r.container.querySelector('section[aria-labelledby="refunds-title"]')!;
    expect(section.className).toContain('tabular-nums');
    expect(section.textContent).toContain('197.000');
    await openForm(r);
    const group = r.container.querySelector('[role="group"]')!;
    expect(section.contains(group)).toBe(true);
    expect(group.closest('.tabular-nums')).toBe(section);
  });
});

const LATE2 = { ...LATE, id: 'r2', amount: 120_000 };
const alerts = (r: Rendered) => [...r.container.querySelectorAll('[role="alert"]')].map((a) => a.textContent);

describe('OrderRefunds (web): lời từ chối sống ở khối Hoàn tiền, không mất cùng dòng khoản hoàn bị gỡ', () => {
  it('khoản duy nhất, 404, tải lại ra danh sách rỗng: dòng bị gỡ nhưng lời từ chối vẫn còn đúng một lần trong khối Hoàn tiền', async () => {
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValue(new ApiError('Không tìm thấy khoản hoàn.', 404));
    m.fetchMyRefunds.mockResolvedValue([]);
    await act(async () => click(confirm));
    await flush(4);
    expect(r.container.querySelector('li')).toBeNull();
    expect(r.container.querySelector('ul')).toBeNull();
    expect(form(r)).toBeNull();
    expect(alerts(r)).toEqual(['Không tìm thấy khoản hoàn.']);
    expect(r.container.querySelector('section[aria-labelledby="refunds-title"]')?.contains(r.container.querySelector('[role="alert"]'))).toBe(true);
  });

  it('khoản còn trong danh sách nhưng đã đóng (409): lời từ chối hiện đúng một lần, không nhân đôi', async () => {
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValue(new ApiError('Khoản hoàn vừa được chọn ở máy khác.', 409));
    m.fetchMyRefunds.mockResolvedValue([CLOSED]);
    await act(async () => click(confirm));
    await flush(4);
    expect(r.container.querySelector('li')).not.toBeNull();
    expect(alerts(r)).toEqual(['Khoản hoàn vừa được chọn ở máy khác.']);
  });

  it('hai khoản: lời từ chối của khoản thứ nhất tắt khi khách mở form của khoản thứ hai', async () => {
    m.fetchMyRefunds.mockResolvedValue([LATE, LATE2]);
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValue(new ApiError('Khoản hoàn vừa được chọn ở máy khác.', 409));
    m.fetchMyRefunds.mockResolvedValue([CLOSED, LATE2]);
    await act(async () => click(confirm));
    await flush(4);
    expect(alerts(r)).toEqual(['Khoản hoàn vừa được chọn ở máy khác.']);
    await openForm(r);
    expect(form(r)).not.toBeNull();
    expect(alerts(r)).toEqual([]);
  });

  it('lỗi tạm (503) rồi dữ liệu nền làm form tự đóng: KHÔNG hiện lại lời lỗi tạm như lời từ chối', async () => {
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValue(new ApiError('Máy chủ bận', 503));
    await act(async () => click(confirm));
    await flush(3);
    expect(alerts(r)).toHaveLength(1);
    m.fetchMyRefunds.mockResolvedValue([CLOSED]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['my-refunds', 'o1'] });
    });
    await flush(3);
    expect(form(r)).toBeNull();
    expect(alerts(r)).toEqual([]);
  });

  it('lỗi tạm rồi 404 rồi form đóng: lời từ chối của lần gửi cuối là lời được giữ lại', async () => {
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValueOnce(new ApiError('Máy chủ bận', 503)).mockRejectedValue(new ApiError('Khoản hoàn đã được xử lý.', 400));
    await act(async () => click(confirm));
    await flush(3);
    m.fetchMyRefunds.mockResolvedValue([CLOSED]);
    await act(async () => click(confirm));
    await flush(4);
    expect(form(r)).toBeNull();
    expect(alerts(r)).toEqual(['Khoản hoàn đã được xử lý.']);
  });

  it('gửi lại đang bay thì khoản bị gỡ khỏi danh sách: lời từ chối của lần gửi trước không hiện lại khi chưa biết lần này ra sao', async () => {
    const r = await mount();
    const confirm = await openForm(r);
    const second = deferred<typeof LATE>();
    m.chooseRefundDestination.mockRejectedValueOnce(new ApiError('Lịch vừa đổi, hãy thử lại.', 409)).mockReturnValue(second.promise);
    await act(async () => click(confirm));
    await flush(4);
    await act(async () => click(confirm));
    m.fetchMyRefunds.mockResolvedValue([]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['my-refunds', 'o1'] });
    });
    await flush(3);
    expect(r.container.querySelector('li')).toBeNull();
    expect(alerts(r)).toEqual([]);
    await act(async () => second.resolve(LATE));
    await flush(3);
  });

  it('khách bấm "Để sau" khi form còn mở sau lời từ chối: lời từ chối không hiện lại ở khối cha', async () => {
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValue(new ApiError('Lịch vừa đổi, hãy thử lại.', 409));
    await act(async () => click(confirm));
    await flush(4);
    expect(form(r)).not.toBeNull();
    click(button(r, 'Để sau')!);
    await flush(2);
    expect(form(r)).toBeNull();
    expect(alerts(r)).toEqual([]);
  });

  it('bị từ chối rồi gửi lại thành công: không còn lời từ chối nào, chỉ có lời xác nhận', async () => {
    const r = await mount();
    const confirm = await openForm(r);
    m.chooseRefundDestination.mockRejectedValueOnce(new ApiError('Lịch vừa đổi, hãy thử lại.', 409)).mockResolvedValue(LATE);
    await act(async () => click(confirm));
    await flush(4);
    await act(async () => click(confirm));
    await flush(4);
    expect(form(r)).toBeNull();
    expect(alerts(r)).toEqual([]);
    expect(r.container.querySelector('[role="status"]')?.textContent).toBe('Đã hoàn 197.000đ vào Ví Tubu.');
  });
});
