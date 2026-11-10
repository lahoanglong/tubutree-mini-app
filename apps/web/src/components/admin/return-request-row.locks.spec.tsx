// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusManager, useQuery } from '@tanstack/react-query';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminReturnPreview, AdminReturnRequest } from '@/lib/admin-client';

// W96B: duyệt hoàn tiền / từ chối / "Đã nhận hàng về" của một yêu cầu đổi/trả (TIỀN + KHO) khoá chạm đúp ngay cả khi hai cú chạm cùng một khung hình,
// giữ khoá tới khi danh sách tải lại xong (tối đa 4 giây), báo lỗi ngay bằng state riêng và không mất lỗi khi hàng đổi trạng thái.

const mocks = vi.hoisted(() => ({ preview: vi.fn(), review: vi.fn(), received: vi.fn() }));
vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  previewReturnRequest: mocks.preview,
  reviewReturnRequest: mocks.review,
  markReturnReceived: mocks.received,
}));

import { ReturnRow } from './return-request-row';

const REQ = (over: Partial<AdminReturnRequest> = {}): AdminReturnRequest => ({
  id: 'r1',
  orderId: 'o1',
  userId: 'u1',
  reason: 'Vỏ chai bị nứt',
  reasonCode: 'DEFECTIVE',
  reasonLabel: 'Sản phẩm lỗi, hỏng',
  images: [],
  status: 'REQUESTED',
  refundMethod: 'WALLET',
  bankName: null,
  bankAccountNo: null,
  bankAccountName: null,
  shopFault: null,
  fullReturn: false,
  refundAmount: null,
  shippingRefund: 0,
  receivedAt: null,
  items: [{ orderItemId: 'i1', quantity: 1, refundAmount: 0, productName: 'Nước giặt', variationName: 'Chai 1L', orderedQuantity: 3 }],
  adminNote: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-10-13T03:00:00Z',
  order: { id: 'o1', code: 'TB-1', total: 282_000, status: 'DELIVERED', paymentMethod: 'COD', pancakeOrderId: null },
  user: { id: 'u1', fullName: 'Nguyễn Văn A', phone: '0912345678' },
  ...over,
});
const PREVIEW = (over: Partial<AdminReturnPreview> = {}): AdminReturnPreview => ({
  requestId: 'r1',
  shopFault: true,
  defaultShopFault: true,
  isFull: false,
  goods: 89_000,
  shipping: 15_000,
  refund: 104_000,
  moneyRefundable: true,
  destination: { method: 'WALLET' },
  pointsUsedBack: 0,
  pointsEarnedBack: 89,
  lines: [{ orderItemId: 'i1', productName: 'Nước giặt', variationName: 'Chai 1L', quantity: 1, orderedQuantity: 3, refundAmount: 89_000 }],
  pancakeTask: false,
  ...over,
});
const withStatus = (status: number, message: string) => Object.assign(new Error(message), { status });

const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let listGate: Promise<void> | undefined;
let listLoads = 0;
let setItemOnPage: (i: AdminReturnRequest) => void = () => undefined;
function Host({ first }: { first: AdminReturnRequest }) {
  const [item, setItem] = useState(first);
  setItemOnPage = setItem;
  useQuery({
    queryKey: ['admin-returns', 'probe'],
    queryFn: async () => {
      listLoads += 1;
      if (listLoads > 1) await listGate;
      return [];
    },
  });
  return <ReturnRow item={item} />;
}

let mounted: Rendered | null = null;
const mount = async (item: AdminReturnRequest) => {
  mounted = render(<Host first={item} />);
  await flush();
  return mounted.container;
};
const btn = (c: HTMLElement, text: string | RegExp) => byText(c, 'button', text) as HTMLButtonElement | null;
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const tap = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
  });
};

beforeEach(() => {
  listGate = undefined;
  listLoads = 0;
  mocks.preview.mockReset().mockResolvedValue(PREVIEW());
  mocks.review.mockReset().mockResolvedValue(REQ({ status: 'APPROVED' }));
  mocks.received.mockReset().mockResolvedValue(REQ({ status: 'APPROVED', receivedAt: '2026-10-14T00:00:00Z' }));
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

const APPROVE = /^Xác nhận hoàn|^Đang duyệt/;
const openPreview = async (c: HTMLElement) => {
  click(btn(c, 'Duyệt hoàn tiền'));
  await flush();
};

describe('Duyệt hoàn tiền: nút "Xác nhận hoàn"', () => {
  it('hai cú chạm cùng một khung hình: chỉ một lệnh duyệt', async () => {
    const c = await mount(REQ());
    await openPreview(c);
    const b = btn(c, APPROVE)!;
    await act(async () => {
      b.click();
      b.click();
    });
    await flush(3);
    expect(mocks.review).toHaveBeenCalledTimes(1);
  });

  it('xong mà danh sách chưa tải lại: "Duyệt hoàn tiền" còn khoá tới khi danh sách về, rồi mới nhả', async () => {
    const c = await mount(REQ());
    await openPreview(c);
    const list = gate();
    listGate = list.promise;
    click(btn(c, APPROVE));
    await flush(4);
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(listLoads).toBe(2);
    expect(btn(c, 'Duyệt hoàn tiền')!.disabled).toBe(true);
    list.resolve();
    await flush();
    expect(btn(c, 'Duyệt hoàn tiền')!.disabled).toBe(false);
  });

  it('danh sách không bao giờ về: nhả sau hạn 4 giây', async () => {
    useHangTimers();
    const c = await mount(REQ());
    await openPreview(c);
    listGate = new Promise<void>(() => {});
    click(btn(c, APPROVE));
    await flush(4);
    await advance(3_500);
    expect(btn(c, 'Duyệt hoàn tiền')!.disabled).toBe(true);
    await advance(600);
    expect(btn(c, 'Duyệt hoàn tiền')!.disabled).toBe(false);
  });

  it('số tiền đã đổi (409): lời máy chủ hiện ngay, tính lại số mới, nút aria-busy/aria-disabled (không disabled) tới khi số mới về', async () => {
    const c = await mount(REQ());
    await openPreview(c);
    const fresh = gate();
    mocks.preview.mockImplementationOnce(() => fresh.promise.then(() => PREVIEW({ refund: 90_000 })));
    mocks.review.mockRejectedValueOnce(withStatus(409, 'Số tiền hoàn đã đổi, xem lại'));
    click(btn(c, APPROVE));
    await flush(4);
    expect(mocks.preview).toHaveBeenCalledTimes(2);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Số tiền hoàn đã đổi');
    const b = btn(c, APPROVE)!;
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await tap(b);
    await flush(2);
    expect(mocks.review).toHaveBeenCalledTimes(1);
    fresh.resolve();
    await flush();
    const after = btn(c, 'Xác nhận hoàn 90.000đ')!;
    expect(after.getAttribute('aria-disabled')).toBeNull();
    expect(after.getAttribute('aria-busy')).toBeNull();
  });

  it('số tiền đang được tính lại (quay lại cửa sổ): nút aria-disabled và chạm vào không gửi lệnh duyệt với số cũ', async () => {
    const c = await mount(REQ());
    await openPreview(c);
    const fresh = gate();
    mocks.preview.mockImplementationOnce(() => fresh.promise.then(() => PREVIEW({ refund: 90_000 })));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await flush(2);
    expect(mocks.preview).toHaveBeenCalledTimes(2);
    const b = btn(c, 'Xác nhận hoàn 104.000đ')!;
    expect(b.getAttribute('aria-disabled')).toBe('true');
    await tap(b);
    await flush(2);
    expect(mocks.review).not.toHaveBeenCalled();
    fresh.resolve();
    await flush();
    expect(btn(c, 'Xác nhận hoàn 90.000đ')!.getAttribute('aria-disabled')).toBeNull();
  });

  it('lỗi 500 (máy chủ có thể đã ghi): vẫn tính lại số, giữ khoá tới khi số về', async () => {
    const c = await mount(REQ());
    await openPreview(c);
    const fresh = gate();
    mocks.preview.mockImplementationOnce(() => fresh.promise.then(() => PREVIEW()));
    mocks.review.mockRejectedValueOnce(withStatus(500, 'Máy chủ lỗi'));
    click(btn(c, APPROVE));
    await flush(4);
    expect(mocks.preview).toHaveBeenCalledTimes(2);
    expect(btn(c, APPROVE)!.getAttribute('aria-disabled')).toBe('true');
    fresh.resolve();
    await flush();
    expect(btn(c, APPROVE)!.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('Từ chối', () => {
  const reject = async (c: HTMLElement) => {
    typeInto(c.querySelector('input[aria-label="Ghi chú duyệt / lý do từ chối"]'), 'Hàng đã qua sử dụng');
    click(btn(c, /^Từ chối$|^Đang từ chối/));
    await flush(1);
    answerConfirm(true);
    await flush(4);
  };

  it('xong mà danh sách chưa về: nút aria-busy/aria-disabled (không disabled), chạm lại không mở hộp hỏi, chỉ một lệnh; về rồi mới nhả', async () => {
    const c = await mount(REQ());
    const list = gate();
    listGate = list.promise;
    await reject(c);
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(listLoads).toBe(2);
    const b = btn(c, /^Từ chối$|^Đang từ chối/)!;
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await tap(b);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(mocks.review).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
    expect(btn(c, /^Từ chối$/)!.getAttribute('aria-disabled')).toBeNull();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    const c = await mount(REQ());
    listGate = new Promise<void>(() => {});
    await reject(c);
    await advance(3_500);
    expect(btn(c, /^Từ chối$|^Đang từ chối/)!.getAttribute('aria-disabled')).toBe('true');
    await advance(600);
    expect(btn(c, /^Từ chối$/)!.getAttribute('aria-disabled')).toBeNull();
  });

  it('bị từ chối vì yêu cầu đã xử lý (409): lời lỗi hiện ngay, tải lại, và vẫn còn khi hàng đổi sang "Đã từ chối"', async () => {
    mocks.review.mockRejectedValueOnce(withStatus(409, 'Yêu cầu đã được xử lý'));
    const c = await mount(REQ());
    const list = gate();
    listGate = list.promise;
    await reject(c);
    expect(listLoads).toBe(2);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Yêu cầu đã được xử lý');
    await act(async () => {
      setItemOnPage(REQ({ status: 'REJECTED' }));
    });
    expect(btn(c, /^Từ chối$/)).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Yêu cầu đã được xử lý');
    list.resolve();
    await flush();
  });

  it('lỗi 500: hiện lỗi, KHÔNG tải lại danh sách, nhả khoá ngay', async () => {
    mocks.review.mockRejectedValueOnce(withStatus(500, 'Máy chủ lỗi'));
    const c = await mount(REQ());
    await reject(c);
    expect(listLoads).toBe(1);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ lỗi');
    expect(btn(c, /^Từ chối$/)!.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('"Đã nhận hàng về" (cộng kho)', () => {
  const approved = () => REQ({ status: 'APPROVED', refundAmount: 89_000, shippingRefund: 15_000 });
  const receive = async (c: HTMLElement) => {
    click(btn(c, /^Đã nhận hàng về$|^Đang ghi nhận/));
    await flush(1);
    answerConfirm(true);
    await flush(4);
  };

  it('xong mà danh sách chưa về: nút aria-busy/aria-disabled, chạm lại không mở hộp hỏi, chỉ một lệnh; về rồi mới nhả', async () => {
    const c = await mount(approved());
    const list = gate();
    listGate = list.promise;
    await receive(c);
    expect(mocks.received).toHaveBeenCalledTimes(1);
    const b = btn(c, /^Đã nhận hàng về$|^Đang ghi nhận/)!;
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await tap(b);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(mocks.received).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
    expect(btn(c, /^Đã nhận hàng về$/)!.getAttribute('aria-disabled')).toBeNull();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    const c = await mount(approved());
    listGate = new Promise<void>(() => {});
    await receive(c);
    await advance(3_500);
    expect(btn(c, /^Đã nhận hàng về$|^Đang ghi nhận/)!.getAttribute('aria-disabled')).toBe('true');
    await advance(600);
    expect(btn(c, /^Đã nhận hàng về$/)!.getAttribute('aria-disabled')).toBeNull();
  });

  it('bị từ chối 409: lời lỗi hiện ngay, tải lại rồi mới nhả; lỗi 500 không tải lại', async () => {
    mocks.received.mockRejectedValueOnce(withStatus(409, 'Đã ghi nhận trước đó'));
    const c = await mount(approved());
    const list = gate();
    listGate = list.promise;
    await receive(c);
    expect(listLoads).toBe(2);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Đã ghi nhận trước đó');
    expect(btn(c, /^Đã nhận hàng về$|^Đang ghi nhận/)!.getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(btn(c, /^Đã nhận hàng về$/)!.getAttribute('aria-disabled')).toBeNull();

    listGate = undefined;
    mocks.received.mockRejectedValueOnce(withStatus(500, 'Máy chủ lỗi'));
    await receive(c);
    expect(listLoads).toBe(2);
    expect(btn(c, /^Đã nhận hàng về$/)!.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('số dùng tabular-nums', () => {
  it('"Trả 1/3" của dòng sản phẩm', async () => {
    const c = await mount(REQ());
    expect(byText(c, 'span', /^Trả 1\/3$/)?.classList.contains('tabular-nums')).toBe(true);
  });
});
