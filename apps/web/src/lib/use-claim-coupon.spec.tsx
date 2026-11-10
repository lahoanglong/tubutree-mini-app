// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { ApiError, NetworkError } from '@/lib/client-api';

const mocks = vi.hoisted(() => ({ phase: 'authenticated' as 'authenticated' | 'guest' | 'unavailable' | 'loading', push: vi.fn(), post: vi.fn(), get: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: mocks.post, get: mocks.get } }));

import { useClaimCoupon } from './use-claim-coupon';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useClaimCoupon>;
let api: Api;
let qc: QueryClient;
function Probe() {
  api = useClaimCoupon('/ma-giam-gia?tab=mine');
  return null;
}
function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.phase = 'authenticated';
  mocks.post.mockResolvedValue({ code: 'NEW10', alreadyClaimed: false });
  mocks.get.mockResolvedValue([]);
  mount();
});

describe('useClaimCoupon (web)', () => {
  it('khách chưa đăng nhập: chuyển tới đăng nhập kèm returnTo của trang này, không gọi máy chủ', async () => {
    mocks.phase = 'guest';
    mount();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await api.claim('NEW10');
    });
    expect(ok).toBe(false);
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fma-giam-gia%3Ftab%3Dmine');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(api.notice).toBeNull();
  });

  it('phiên chưa khôi phục được (mất mạng): báo lỗi mạng, không mời đăng nhập lại', async () => {
    mocks.phase = 'unavailable';
    mount();
    await act(async () => {
      await api.claim('NEW10');
    });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(api.notice).toMatchObject({ code: 'NEW10', error: true });
    expect(api.notice!.text).toContain('Không kết nối được');
  });

  it('đang khôi phục phiên: không làm gì cả (không đẩy sang đăng nhập khi khách thật ra đã có phiên)', async () => {
    mocks.phase = 'loading';
    mount();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await api.claim('NEW10');
    });
    expect(ok).toBe(false);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('thành công: POST /coupons/claim đúng mã, câu "Đã lưu vào Mã của tôi", làm mới ví và kho, trả true', async () => {
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    let ok: boolean | undefined;
    await act(async () => {
      ok = await api.claim('NEW10');
    });
    expect(ok).toBe(true);
    expect(mocks.post).toHaveBeenCalledWith('/coupons/claim', { code: 'NEW10' });
    expect(api.notice).toEqual({ code: 'NEW10', text: 'Đã lưu vào Mã của tôi', error: false });
    // Ví làm mới trước, kho/mã đã nhận/lịch sử sau (xem hook).
    expect(invalidate.mock.calls.map(([f]) => f)).toEqual([
      { queryKey: ['coupons'], exact: true },
      { queryKey: ['coupons'], predicate: expect.any(Function) },
    ]);
    expect(api.pendingCode).toBeNull();
  });

  it('lỗi máy chủ: đúng câu của máy chủ (error), trả false', async () => {
    mocks.post.mockRejectedValue(new ApiError('Mã giảm giá đã hết lượt nhận.', 400));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await api.claim('NEW10');
    });
    expect(ok).toBe(false);
    expect(api.notice).toEqual({ code: 'NEW10', text: 'Mã giảm giá đã hết lượt nhận.', error: true });
  });

  it('lỗi: tải lại kho bằng GET kèm tham số phá cache (route kho có max-age=15) và đưa danh sách mới vào cache, không invalidate thường', async () => {
    const fresh = [{ code: 'NEW10', usageLimit: 1, claimedCount: 1 }];
    mocks.post.mockRejectedValue(new ApiError('Mã giảm giá này đã được tài khoản khác nhận.', 400));
    mocks.get.mockResolvedValue(fresh);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await act(async () => {
      await api.claim('NEW10');
    });
    await vi.waitFor(() => expect(qc.getQueryData(['coupons', 'collectable'])).toEqual(fresh));
    expect(mocks.get).toHaveBeenCalledWith('/coupons/collectable', { query: { fresh: expect.any(Number) } });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['coupons', 'collectable'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coupons', 'collectable', 'mine'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coupons'], exact: true });
  });

  it('lỗi mạng khi tải lại kho không ném ra ngoài và không làm hook kẹt', async () => {
    mocks.post.mockRejectedValue(new ApiError('Mã giảm giá đã hết lượt nhận.', 400));
    mocks.get.mockRejectedValue(new Error('offline'));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await api.claim('NEW10');
    });
    expect(ok).toBe(false);
    expect(api.pendingCode).toBeNull();
  });

  it('đang nhận: pendingCode là mã đó, chạm đúp chỉ gọi máy chủ một lần', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.post.mockReturnValue(new Promise((r) => (release = r)));
    let first: Promise<boolean> | undefined;
    let second: boolean | undefined;
    await act(async () => {
      first = api.claim('NEW10');
      second = await api.claim('NEW10');
    });
    expect(second).toBe(false);
    expect(api.pendingCode).toBe('NEW10');
    await act(async () => {
      release({ code: 'NEW10' });
      await first;
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(api.pendingCode).toBeNull();
  });
});

describe('useClaimCoupon (web): khoá giữ tới khi kho/ví mới về, tối đa 4 giây', () => {
  const gate = () => {
    let release!: (v?: unknown) => void;
    const promise = new Promise((r) => (release = r));
    return { promise, release };
  };
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([400, 404, 409, 422])('máy chủ từ chối %i: câu lỗi hiện ngay, khoá (pendingCode) giữ tới khi kho tải lại xong, chạm lại không gọi máy chủ', async (status) => {
    mocks.post.mockRejectedValue(new ApiError('Mã đã hết lượt nhận.', status));
    const reload = gate();
    mocks.get.mockReturnValue(reload.promise);
    let first: Promise<boolean> | undefined;
    await act(async () => {
      first = api.claim('NEW10');
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(api.notice).toEqual({ code: 'NEW10', text: 'Mã đã hết lượt nhận.', error: true });
    expect(api.pendingCode).toBe('NEW10');
    let again: boolean | undefined;
    await act(async () => {
      again = await api.claim('NEW10');
    });
    expect(again).toBe(false);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await act(async () => {
      reload.release([]);
      await first;
    });
    expect(api.pendingCode).toBeNull();
    await act(async () => {
      await api.claim('NEW10');
    });
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it('kho tải lại treo mãi: khoá nhả đúng sau 4 giây, không sớm hơn', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    mocks.post.mockRejectedValue(new ApiError('Mã đã hết lượt nhận.', 409));
    mocks.get.mockReturnValue(new Promise(() => undefined));
    let first: Promise<boolean> | undefined;
    await act(async () => {
      first = api.claim('NEW10');
      await vi.advanceTimersByTimeAsync(3_900);
    });
    expect(api.pendingCode).toBe('NEW10');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await first;
    });
    expect(api.pendingCode).toBeNull();
  });

  it.each([
    ['401', () => new ApiError('Phiên hết hạn', 401)],
    ['403', () => new ApiError('Không có quyền', 403)],
    ['500', () => new ApiError('Máy chủ lỗi', 500)],
    ['503', () => new ApiError('Máy chủ bận', 503)],
    ['mất mạng', () => new NetworkError(false)],
  ])('%s: báo lỗi, KHÔNG tải lại kho/ví và nhả khoá ngay', async (_name, make) => {
    mocks.post.mockRejectedValue(make());
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    let ok: boolean | undefined;
    await act(async () => {
      ok = await api.claim('NEW10');
    });
    expect(ok).toBe(false);
    expect(api.notice?.error).toBe(true);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(api.pendingCode).toBeNull();
  });

  it('lưu xong: phần còn lại chỉ tải lại khi ví đã về, khoá giữ tới khi phần còn lại về', async () => {
    let releaseWallet!: () => void;
    let releaseRest!: () => void;
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters) => {
      const isWallet = (filters as { exact?: boolean } | undefined)?.exact === true;
      return new Promise<void>((r) => {
        if (isWallet) releaseWallet = r;
        else releaseRest = r;
      });
    });
    let settled = false;
    let first!: Promise<boolean>;
    await act(async () => {
      first = api.claim('NEW10');
      void first.then(() => (settled = true));
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    await act(async () => {
      releaseWallet();
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);
    expect(api.pendingCode).toBe('NEW10');
    await act(async () => {
      releaseRest();
      await first;
    });
    expect(settled).toBe(true);
    expect(api.pendingCode).toBeNull();
  });

  it('lưu xong mà ví/kho không về: khoá nhả đúng sau 4 giây', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    vi.spyOn(qc, 'invalidateQueries').mockImplementation(() => new Promise(() => undefined));
    let first: Promise<boolean> | undefined;
    await act(async () => {
      first = api.claim('NEW10');
      await vi.advanceTimersByTimeAsync(3_900);
    });
    expect(api.pendingCode).toBe('NEW10');
    let ok: boolean | undefined;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      ok = await first;
    });
    expect(ok).toBe(true);
    expect(api.pendingCode).toBeNull();
  });
});
