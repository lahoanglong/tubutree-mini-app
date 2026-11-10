// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';
import { ApiError, NetworkError } from '@/lib/client-api';
import type { OrderDetailDTO, ReturnRequestDTO } from '@/lib/shop-client';

// Yêu cầu đổi/trả web ↔ Mini (Wave 92B): máy chủ từ chối bằng 400/404/409 ("Đơn đang có yêu cầu đổi/trả chờ xử lý", đơn đổi trạng thái) thì danh sách yêu cầu
// và đơn bị cũ: tải lại rồi mới nhả khoá (tối đa 4 giây); mạng/401/403/5xx không tải lại. Lời lỗi hiện ngay, không chờ lần tải lại.

const mocks = vi.hoisted(() => ({ requestReturn: vi.fn(), estimate: vi.fn() }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  requestReturn: mocks.requestReturn,
  estimateReturn: mocks.estimate,
}));

import { ReturnRequestForm } from './return-request-form';

const ORDER = {
  id: 'o9',
  code: 'TB-9',
  status: 'DELIVERED',
  total: 300000,
  paymentMethod: 'XU',
  placedForCustomer: false,
  items: [{ id: 'i1', productName: 'Dầu gội', variationName: '500ml', unitPrice: 150000, quantity: 2, total: 300000, thumbnail: null }],
} as unknown as OrderDetailDTO;
const PENDING_MESSAGE = 'Đơn đang có yêu cầu đổi/trả chờ xử lý.';

const gate = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const never = () => new Promise<never>(() => undefined);

const fetches = { returns: 0, order: 0 };
let returnsReply: () => Promise<ReturnRequestDTO[]> = async () => [];
let orderReply: () => Promise<unknown> = async () => ORDER;

/** Hai truy vấn cha (trang chi tiết đơn) mà form phải làm mới khi máy chủ nói đơn đã khác. */
function Parent({ onDone }: { onDone: () => void }) {
  useQuery({ queryKey: ['my-returns'], queryFn: () => ((fetches.returns += 1), returnsReply()), staleTime: Infinity });
  useQuery({ queryKey: ['order', ORDER.code], queryFn: () => ((fetches.order += 1), orderReply()), staleTime: Infinity });
  return <ReturnRequestForm order={ORDER} returns={[]} onDone={onDone} onClose={() => undefined} />;
}

let mounted: Rendered[] = [];
const onDone = vi.fn();
const mount = async () => {
  const r = render(<Parent onDone={onDone} />, new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }));
  mounted.push(r);
  await flush(6);
  click(byText(r.container, 'label', 'Sản phẩm lỗi, hỏng')!.querySelector('input'));
  return r.container;
};
const submitBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const alertText = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="alert"]')).map((n) => n.textContent ?? '').join(' | ');
const twice = (el: HTMLElement) =>
  act(() => {
    el.click();
    el.click();
  });

beforeEach(() => {
  fetches.returns = 0;
  fetches.order = 0;
  returnsReply = async () => [];
  orderReply = async () => ORDER;
  onDone.mockReset();
  mocks.requestReturn.mockReset().mockResolvedValue({ id: 'r1' });
  mocks.estimate.mockReset().mockResolvedValue({ moneyRefundable: false });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('form đổi/trả: máy chủ từ chối 400/404/409 thì tải lại yêu cầu và đơn', () => {
  it.each([400, 404, 409])('%i: báo đúng lời máy chủ, tải lại my-returns và đơn một lần, không đóng form', async (status) => {
    mocks.requestReturn.mockRejectedValue(new ApiError(PENDING_MESSAGE, status));
    const c = await mount();
    expect(fetches).toEqual({ returns: 1, order: 1 });
    click(submitBtn(c));
    await flush(8);
    expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
    expect(alertText(c)).toContain(PENDING_MESSAGE);
    expect(fetches).toEqual({ returns: 2, order: 2 });
    expect(onDone).not.toHaveBeenCalled();
  });

  it.each([
    ['401', () => new ApiError('Phiên hết hạn', 401)],
    ['403', () => new ApiError('Không có quyền', 403)],
    ['500', () => new ApiError('lỗi máy chủ', 500)],
    ['503', () => new ApiError('đang bảo trì', 503)],
    ['mất mạng', () => new NetworkError(false)],
  ])('%s: báo lỗi nhưng KHÔNG tải lại (tải lại cũng hỏng lúc máy chủ bận)', async (_name, make) => {
    mocks.requestReturn.mockRejectedValue(make());
    const c = await mount();
    click(submitBtn(c));
    await flush(8);
    expect(alertText(c)).not.toBe('');
    expect(fetches).toEqual({ returns: 1, order: 1 });
    expect(submitBtn(c).hasAttribute('aria-busy')).toBe(false);
  });

  it('lời lỗi hiện ngay khi máy chủ từ chối, kể cả lúc lần tải lại còn treo; nút giữ khoá tới khi tải lại xong', async () => {
    const reload = gate<ReturnRequestDTO[]>();
    const c = await mount();
    returnsReply = () => reload.promise;
    mocks.requestReturn.mockRejectedValue(new ApiError(PENDING_MESSAGE, 400));
    const btn = submitBtn(c);
    btn.focus();
    click(btn);
    await flush(6);
    expect(fetches.returns).toBe(2);
    expect(alertText(c)).toContain(PENDING_MESSAGE);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    expect(document.activeElement).toBe(btn);
    click(btn);
    await flush(4);
    expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
    reload.resolve([]);
    await flush(6);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    click(btn);
    await flush(6);
    expect(mocks.requestReturn).toHaveBeenCalledTimes(2);
  });

  it('chạm đúp "Gửi yêu cầu" cùng khung hình: một lệnh, một lần tải lại', async () => {
    mocks.requestReturn.mockRejectedValue(new ApiError(PENDING_MESSAGE, 409));
    const c = await mount();
    twice(submitBtn(c));
    await flush(8);
    expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
    expect(fetches).toEqual({ returns: 2, order: 2 });
  });

  it('tải lại cũng hỏng: không có promise bị từ chối bỏ rơi, khoá nhả, lời lỗi giữ nguyên', async () => {
    const c = await mount();
    returnsReply = async () => {
      throw new Error('mất mạng');
    };
    orderReply = async () => {
      throw new Error('mất mạng');
    };
    mocks.requestReturn.mockRejectedValue(new ApiError(PENDING_MESSAGE, 400));
    const seen = await captureUnhandledRejections(async () => {
      click(submitBtn(c));
      await flush(8);
    });
    expect(seen).toEqual([]);
    expect(alertText(c)).toContain(PENDING_MESSAGE);
    expect(submitBtn(c).hasAttribute('aria-busy')).toBe(false);
  });

  it('gửi lại sau lỗi: lời lỗi cũ biến mất lúc gửi, thành công thì đóng form và làm mới my-returns như trước', async () => {
    mocks.requestReturn.mockRejectedValueOnce(new ApiError(PENDING_MESSAGE, 400)).mockResolvedValueOnce({ id: 'r1' });
    const c = await mount();
    click(submitBtn(c));
    await flush(8);
    expect(alertText(c)).toContain(PENDING_MESSAGE);
    click(submitBtn(c));
    await flush(8);
    expect(alertText(c)).toBe('');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(fetches.returns).toBe(3);
  });

  describe('làm mới không bao giờ về: nhả khoá sau 4 giây', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    });
    afterEach(() => vi.useRealTimers());

    it('còn khoá ở 3 giây, nhả sau 4 giây dù my-returns chưa về, rồi gửi lại được', async () => {
      const c = await mount();
      returnsReply = never;
      mocks.requestReturn.mockRejectedValue(new ApiError(PENDING_MESSAGE, 400));
      const btn = submitBtn(c);
      click(btn);
      await flush(6);
      expect(fetches.returns).toBe(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(btn.getAttribute('aria-busy')).toBe('true');
      click(btn);
      await flush(4);
      expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      await flush(4);
      expect(btn.hasAttribute('aria-busy')).toBe(false);
      click(btn);
      await flush(6);
      expect(mocks.requestReturn).toHaveBeenCalledTimes(2);
    });
  });
});
