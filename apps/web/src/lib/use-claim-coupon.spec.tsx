// @vitest-environment jsdom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { ApiError } from '@/lib/client-api';

const mocks = vi.hoisted(() => ({ phase: 'authenticated' as 'authenticated' | 'guest' | 'unavailable' | 'loading', push: vi.fn(), post: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: mocks.post } }));

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
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coupons'] });
    expect(api.pendingCode).toBeNull();
  });

  it('lỗi máy chủ: đúng câu của máy chủ (error), làm mới danh sách kho vì cache có thể đã cũ, trả false', async () => {
    mocks.post.mockRejectedValue(new ApiError('Mã giảm giá đã hết lượt nhận.', 400));
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    let ok: boolean | undefined;
    await act(async () => {
      ok = await api.claim('NEW10');
    });
    expect(ok).toBe(false);
    expect(api.notice).toEqual({ code: 'NEW10', text: 'Mã giảm giá đã hết lượt nhận.', error: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coupons', 'collectable'] });
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
