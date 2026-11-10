// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';
import { ApiError, NetworkError } from '@/lib/client-api';

// Đánh giá sản phẩm web ↔ Mini (Wave 92B): máy chủ từ chối lưu đánh giá bằng 400/404/409 ("Đơn này đã trả hàng", đơn không còn...) thì quyền đánh giá
// đang hiện (nút "Viết đánh giá" và đơn chốt lúc mở form) đã cũ: tải lại can-review rồi mới nhả khoá (tối đa 4 giây); mạng/401/403/5xx không tải lại.
// Lời lỗi hiện ngay và được focus, không chờ lần tải lại.

const mocks = vi.hoisted(() => ({
  eligCalls: 0,
  elig: (() => Promise.resolve(null)) as () => Promise<unknown>,
  save: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: 'authenticated', initialized: true, sessionUnavailable: false }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/components/evidence-upload', () => ({ EvidenceUpload: () => null }));
vi.mock('./review-video-upload', () => ({ ReviewVideoUpload: () => null }));
vi.mock('@/lib/reviews-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reviews-client')>()),
  fetchProductReviews: async () => ({ count: 0, average: 0, videoCount: 0, distribution: {}, items: [], nextCursor: null }),
  fetchCanReview: () => {
    mocks.eligCalls += 1;
    return mocks.elig();
  },
  saveReview: (...args: unknown[]) => mocks.save(...args),
}));

import { ProductReviews } from './product-reviews';

const O1 = { orderId: 'o1', code: 'TB0001', deliveredAt: '2026-08-01T00:00:00.000Z' };
const ELIG_NEW = { canReview: true, reason: null, rewardAvailable: true, purchaseCount: 1, reviewableOrders: [O1], myReviews: [] };
const ELIG_RETURNED = { canReview: false, reason: 'NOT_PURCHASED', rewardAvailable: false, purchaseCount: 0, reviewableOrders: [], myReviews: [] };
const RETURNED_MESSAGE = 'Đơn này đã trả hàng nên không đánh giá mới được.';

const gate = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const never = () => new Promise<never>(() => undefined);

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<ProductReviews slug="nuoc-rua-chen" />);
  mounted.push(r);
  await flush(8);
  const c = r.container;
  click(byText(c, 'button', 'Viết đánh giá'));
  await flush(4);
  return c;
};
const sendBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
const alertEl = (c: HTMLElement) => c.querySelector<HTMLElement>('form [role="alert"]');
const twice = (el: HTMLElement) =>
  act(() => {
    el.click();
    el.click();
  });

beforeEach(() => {
  mocks.eligCalls = 0;
  mocks.elig = () => Promise.resolve(structuredClone(ELIG_NEW));
  mocks.save.mockReset().mockResolvedValue({ id: 'new', updated: false, pointsEarned: 0 });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('form đánh giá: máy chủ từ chối 400/404/409 thì tải lại quyền đánh giá', () => {
  it.each([400, 404, 409])('%i: báo đúng lời máy chủ (được focus), tải lại can-review một lần, form vẫn mở với đúng đơn đã chốt', async (status) => {
    mocks.save.mockRejectedValue(new ApiError(RETURNED_MESSAGE, status));
    const c = await mount();
    expect(mocks.eligCalls).toBe(1);
    mocks.elig = () => Promise.resolve(structuredClone(ELIG_RETURNED));
    click(sendBtn(c));
    await flush(8);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(alertEl(c)?.textContent).toBe(RETURNED_MESSAGE);
    expect(document.activeElement).toBe(alertEl(c));
    expect(mocks.eligCalls).toBe(2);
    expect(c.querySelector('form')).not.toBeNull();
    // Quyền đã cũ được làm mới: sau khi đóng form không còn nút "Viết đánh giá" cho đơn đã trả.
    click(byText(c, 'button', 'Huỷ'));
    await flush(4);
    expect(byText(c, 'button', 'Viết đánh giá')).toBeNull();
  });

  it.each([
    ['401', () => new ApiError('Phiên hết hạn', 401)],
    ['403', () => new ApiError('Không có quyền', 403)],
    ['500', () => new ApiError('lỗi máy chủ', 500)],
    ['503', () => new ApiError('đang bảo trì', 503)],
    ['mất mạng', () => new NetworkError(false)],
  ])('%s: báo lỗi nhưng KHÔNG tải lại can-review', async (_name, make) => {
    mocks.save.mockRejectedValue(make());
    const c = await mount();
    click(sendBtn(c));
    await flush(8);
    expect(alertEl(c)?.textContent).toBeTruthy();
    expect(mocks.eligCalls).toBe(1);
    expect(sendBtn(c).hasAttribute('aria-busy')).toBe(false);
  });

  it('lời lỗi hiện ngay khi lần tải lại còn treo; nút giữ khoá (aria-busy + aria-disabled, không disabled) tới khi tải lại xong rồi gửi lại được', async () => {
    const c = await mount();
    const reload = gate<unknown>();
    mocks.elig = () => reload.promise;
    mocks.save.mockRejectedValueOnce(new ApiError(RETURNED_MESSAGE, 400)).mockResolvedValueOnce({ id: 'new', updated: false, pointsEarned: 0 });
    const btn = sendBtn(c);
    click(btn);
    await flush(6);
    expect(mocks.eligCalls).toBe(2);
    expect(alertEl(c)?.textContent).toBe(RETURNED_MESSAGE);
    // Lời lỗi nhận focus ngay lúc máy chủ từ chối, không chờ lần tải lại.
    expect(document.activeElement).toBe(alertEl(c));
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    click(btn);
    await flush(4);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    reload.resolve(structuredClone(ELIG_NEW));
    await flush(6);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    click(btn);
    await flush(8);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(c.querySelector('form')).toBeNull();
  });

  it('gửi lại sau lỗi: lời lỗi cũ biến mất ngay lúc gửi, lỗi mới thay vào (không chồng hai lời)', async () => {
    const second = gate<unknown>();
    mocks.save.mockRejectedValueOnce(new ApiError(RETURNED_MESSAGE, 400)).mockReturnValueOnce(second.promise);
    const c = await mount();
    click(sendBtn(c));
    await flush(8);
    expect(alertEl(c)?.textContent).toBe(RETURNED_MESSAGE);
    click(sendBtn(c));
    await flush(4);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(alertEl(c)).toBeNull();
    second.resolve(Promise.reject(new ApiError('Đơn không còn.', 404)));
    await flush(8);
    expect(c.querySelectorAll('form [role="alert"]')).toHaveLength(1);
    expect(alertEl(c)?.textContent).toBe('Đơn không còn.');
  });

  it('chạm đúp "Gửi đánh giá" cùng khung hình: một lệnh, một lần tải lại', async () => {
    mocks.save.mockRejectedValue(new ApiError(RETURNED_MESSAGE, 409));
    const c = await mount();
    twice(sendBtn(c));
    await flush(8);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.eligCalls).toBe(2);
  });

  it('tải lại cũng hỏng: không có promise bị từ chối bỏ rơi, khoá nhả, lời lỗi giữ nguyên', async () => {
    const c = await mount();
    mocks.elig = () => Promise.reject(new Error('mất mạng'));
    mocks.save.mockRejectedValue(new ApiError(RETURNED_MESSAGE, 400));
    const seen = await captureUnhandledRejections(async () => {
      click(sendBtn(c));
      await flush(8);
    });
    expect(seen).toEqual([]);
    expect(alertEl(c)?.textContent).toBe(RETURNED_MESSAGE);
    expect(sendBtn(c).hasAttribute('aria-busy')).toBe(false);
  });

  describe('làm mới không bao giờ về: nhả khoá sau 4 giây', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    });
    afterEach(() => vi.useRealTimers());

    it('còn khoá ở 3 giây, nhả sau 4 giây dù can-review chưa về, rồi gửi lại được', async () => {
      const c = await mount();
      mocks.elig = never;
      mocks.save.mockRejectedValue(new ApiError(RETURNED_MESSAGE, 400));
      const btn = sendBtn(c);
      click(btn);
      await flush(6);
      expect(mocks.eligCalls).toBe(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(btn.getAttribute('aria-busy')).toBe('true');
      click(btn);
      await flush(4);
      expect(mocks.save).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      await flush(4);
      expect(btn.hasAttribute('aria-busy')).toBe(false);
      click(btn);
      await flush(6);
      expect(mocks.save).toHaveBeenCalledTimes(2);
    });
  });
});
