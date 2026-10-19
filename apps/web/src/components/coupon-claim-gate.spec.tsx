// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { byText, click, flush } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

// Chép ý coupon-claim-gate.spec.tsx (Mini App): nhận mã từ link thẻ QR một lần, đúng lúc đã đăng nhập, báo kết quả bằng sheet,
// giữ mã khi chưa đăng nhập hoặc mất mạng, bỏ mã khi máy chủ từ chối. Khác Mini App: web không có tài khoản khách ngầm nên
// "khách" là chưa đăng nhập (mời sang /dang-nhap), và mã được xoá khỏi thanh địa chỉ sau khi đọc.

const mocks = vi.hoisted(() => ({
  auth: { status: 'authenticated' as string, initialized: true, sessionUnavailable: false, user: { id: 'u1' } as unknown },
  storage: {} as Record<string, string>,
  post: vi.fn(),
  push: vi.fn(),
  pathname: '/',
  cartCount: 0,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: mocks.post } }));
vi.mock('@/lib/shop-client', () => ({ getCart: async () => ({ itemCount: mocks.cartCount }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => mocks.pathname }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: {
    storage: {
      get: async (k: string) => mocks.storage[k] ?? null,
      set: async (k: string, v: string) => {
        mocks.storage[k] = v;
      },
    },
  },
}));

import { CouponClaimGate } from './coupon-claim-gate';
import { PENDING_CLAIM_KEY } from './account/coupon-claim';

const CLAIMED = {
  code: 'SHOPEE-AB12CD34',
  type: 'AMOUNT',
  value: 30000,
  minOrder: 99000,
  maxDiscount: null,
  endAt: '2026-12-31T16:59:59.000Z',
  newCustomerOnly: true,
  alreadyClaimed: false,
};

let host: { container: HTMLDivElement; root: Root; client: QueryClient } | null = null;
const draw = () =>
  act(() => {
    host!.root.render(
      <QueryClientProvider client={host!.client}>
        <CouponClaimGate />
      </QueryClientProvider>,
    );
  });
const mount = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  host = { container, root: createRoot(container), client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
  draw();
  await flush(8);
  return document.body;
};
const unmount = () => {
  if (!host) return;
  act(() => host!.root.unmount());
  host.container.remove();
  host = null;
};
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]');
const setPhase = (p: 'authenticated' | 'guest' | 'loading' | 'unavailable') => {
  mocks.auth.status = p === 'authenticated' ? 'authenticated' : 'idle';
  mocks.auth.initialized = p !== 'loading';
  mocks.auth.sessionUnavailable = p === 'unavailable';
  mocks.auth.user = p === 'authenticated' ? { id: 'u1' } : null;
};
const open = (url: string) => window.history.replaceState({}, '', url);

beforeEach(() => {
  mocks.storage = {};
  mocks.cartCount = 0;
  mocks.post.mockReset();
  mocks.push.mockReset();
  mocks.pathname = '/';
  setPhase('authenticated');
  open('/');
});
afterEach(unmount);

describe('CouponClaimGate: nhận ưu đãi từ thẻ QR hộp hàng (D2-03)', () => {
  it('mở link ?claim= khi đã đăng nhập: gọi POST /coupons/claim đúng một lần, hiện ưu đãi, xoá mã chờ và xoá tham số khỏi URL; "Dùng ngay" đi mua sắm', async () => {
    open('/?claim=shopee-ab12cd34&utm=box');
    mocks.post.mockResolvedValue(CLAIMED);
    const body = await mount();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/coupons/claim', { code: 'SHOPEE-AB12CD34' });
    expect(body.textContent).toContain('Bạn nhận được ưu đãi');
    expect(body.textContent).toContain('Giảm 30.000đ cho đơn từ 99.000đ');
    expect(body.textContent).toContain('Dành cho đơn đầu tiên của bạn tại Tubu Tree.');
    expect(body.textContent).toContain('Hạn dùng đến 31/12/2026');
    expect(mocks.storage[PENDING_CLAIM_KEY]).toBe('');
    expect(window.location.search).toBe('?utm=box');
    click(byText(body, 'button', 'Dùng ngay'));
    expect(mocks.push).toHaveBeenCalledWith('/san-pham');
    expect(sheet()).toBeNull();
  });

  it('giỏ đã có hàng: "Dùng ngay" mở giỏ; mã đã có trong ví thì nói vậy', async () => {
    open('/?claim=SHOPEE-AB12CD34');
    mocks.cartCount = 2;
    mocks.post.mockResolvedValue({ ...CLAIMED, alreadyClaimed: true });
    const body = await mount();
    expect(body.textContent).toContain('Ưu đãi đã có trong ví của bạn');
    click(byText(body, 'button', 'Dùng ngay'));
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('chưa đăng nhập: giữ mã trên máy, không gọi máy chủ, mời đăng nhập và quay lại đúng trang (không kèm mã)', async () => {
    open('/san-pham/x?claim=SHOPEE-AB12CD34');
    setPhase('guest');
    const body = await mount();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.storage[PENDING_CLAIM_KEY]).toBe('SHOPEE-AB12CD34');
    expect(body.textContent).toContain('Đăng nhập Zalo để nhận ưu đãi');
    const login = byText(body, 'a', 'Đăng nhập với Zalo') as HTMLAnchorElement;
    expect(login.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent('/san-pham/x')}`);
    click(byText(body, 'button', 'Để sau'));
    expect(sheet()).toBeNull();
  });

  it('chưa đăng nhập: bấm "Đăng nhập với Zalo" thì đóng sheet để không che trang đăng nhập', async () => {
    open('/tai-khoan?claim=SHOPEE-AB12CD34');
    setPhase('guest');
    const body = await mount();
    const login = byText(body, 'a', 'Đăng nhập với Zalo');
    login!.addEventListener('click', (e) => e.preventDefault());
    click(login);
    await flush(4);
    expect(sheet()).toBeNull();
    expect(mocks.storage[PENDING_CLAIM_KEY]).toBe('SHOPEE-AB12CD34');
  });

  it('đang ở trang /dang-nhap thì không mở sheet mời đăng nhập', async () => {
    open('/dang-nhap?claim=SHOPEE-AB12CD34');
    mocks.pathname = '/dang-nhap';
    setPhase('guest');
    await mount();
    expect(sheet()).toBeNull();
    expect(mocks.storage[PENDING_CLAIM_KEY]).toBe('SHOPEE-AB12CD34');
  });

  it('lần mở sau (không còn link) đã đăng nhập: mã chờ trên máy tự vào ví', async () => {
    mocks.storage[PENDING_CLAIM_KEY] = 'SHOPEE-AB12CD34';
    mocks.post.mockResolvedValue(CLAIMED);
    const body = await mount();
    expect(mocks.post).toHaveBeenCalledWith('/coupons/claim', { code: 'SHOPEE-AB12CD34' });
    expect(body.textContent).toContain('Bạn nhận được ưu đãi');
  });

  it('đang khôi phục phiên hoặc mất kết nối lúc khôi phục: chưa gọi máy chủ, chỉ lưu mã, không hiện sheet', async () => {
    for (const phase of ['loading', 'unavailable'] as const) {
      mocks.storage = {};
      open('/?claim=SHOPEE-AB12CD34');
      setPhase(phase);
      await mount();
      expect(mocks.post).not.toHaveBeenCalled();
      expect(mocks.storage[PENDING_CLAIM_KEY]).toBe('SHOPEE-AB12CD34');
      expect(sheet()).toBeNull();
      unmount();
    }
  });

  it('phiên khôi phục xong thì nhận ngay một lần, không gọi lại khi render lại', async () => {
    open('/?claim=SHOPEE-AB12CD34');
    setPhase('loading');
    mocks.post.mockResolvedValue(CLAIMED);
    await mount();
    expect(mocks.post).not.toHaveBeenCalled();
    setPhase('authenticated');
    draw();
    await flush(6);
    draw();
    await flush(4);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('máy chủ đòi đăng nhập Zalo: chuyển sang mời đăng nhập, mã vẫn giữ', async () => {
    open('/?claim=SHOPEE-AB12CD34');
    mocks.post.mockRejectedValue(new ApiError('Cần đăng nhập Zalo để nhận ưu đãi.', 403));
    const body = await mount();
    expect(body.textContent).toContain('Đăng nhập Zalo để nhận ưu đãi');
    expect(mocks.storage[PENDING_CLAIM_KEY]).toBe('SHOPEE-AB12CD34');
  });

  it('thẻ đã có người khác nhận: báo đúng lý do của máy chủ, bỏ mã chờ, chỉ còn nút Đã hiểu', async () => {
    open('/?claim=SHOPEE-AB12CD34');
    mocks.post.mockRejectedValue(new ApiError('Mã giảm giá này đã được tài khoản khác nhận.', 400));
    const body = await mount();
    expect(body.textContent).toContain('Chưa nhận được ưu đãi');
    expect(body.textContent).toContain('Mã giảm giá này đã được tài khoản khác nhận.');
    expect(mocks.storage[PENDING_CLAIM_KEY]).toBe('');
    expect(byText(body, 'button', 'Thử lại')).toBeNull();
    click(byText(body, 'button', 'Đã hiểu'));
    expect(sheet()).toBeNull();
  });

  it('mất mạng: giữ mã chờ, cho thử lại; thử lại thành công thì hiện ưu đãi', async () => {
    open('/?claim=SHOPEE-AB12CD34');
    mocks.post.mockRejectedValueOnce(new NetworkError(false)).mockResolvedValueOnce(CLAIMED);
    const body = await mount();
    expect(mocks.storage[PENDING_CLAIM_KEY]).toBe('SHOPEE-AB12CD34');
    click(byText(body, 'button', 'Thử lại'));
    await flush(6);
    expect(body.textContent).toContain('Bạn nhận được ưu đãi');
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it('không có link và không có mã chờ: không hiện gì, không gọi máy chủ', async () => {
    await mount();
    expect(sheet()).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('link có mã sai dạng: bỏ qua, không gọi máy chủ, giữ nguyên URL', async () => {
    open('/?claim=%3Cscript%3E');
    await mount();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?claim=%3Cscript%3E');
  });

  it('khách đóng sheet thì phiên này không tự hỏi lại', async () => {
    open('/?claim=SHOPEE-AB12CD34');
    setPhase('guest');
    const body = await mount();
    click(byText(body, 'button', 'Để sau'));
    draw();
    await flush(4);
    expect(sheet()).toBeNull();
  });
});
