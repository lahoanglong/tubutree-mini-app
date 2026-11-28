// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Huy hiệu giỏ ở thanh đầu: khách chưa đăng nhập (cờ web.guest_cart_enabled bật) đọc giỏ trình duyệt, người đã đăng nhập đọc giỏ máy chủ.
const mocks = vi.hoisted(() => ({ phase: 'guest' as string, itemCount: 0, getCart: vi.fn() }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/cart-key', () => ({ useCartKey: () => ['cart', null] }));
vi.mock('@/lib/shop-client', () => ({ getCart: mocks.getCart }));

import { PUBLIC_CONFIG_FALLBACK } from '@/lib/use-public-config';
import { addGuestLine, clearGuestCart } from './store';
import { useCartBadgeCount } from './use-cart-badge-count';

function Badge() {
  return <span data-testid="badge">{useCartBadgeCount()}</span>;
}

const clientWith = (flag: boolean | null) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (flag !== null) qc.setQueryData(['public-config'], { ...PUBLIC_CONFIG_FALLBACK, webGuestCartEnabled: flag });
  return qc;
};

let mounted: Rendered | null = null;
const mount = async (qc: QueryClient) => {
  mounted = render(<Badge />, qc);
  await flush();
  return mounted.container.querySelector('[data-testid="badge"]')!;
};

beforeEach(() => {
  localStorage.clear();
  mocks.phase = 'guest';
  mocks.getCart.mockReset().mockImplementation(async () => ({ items: [], itemCount: mocks.itemCount }));
  mocks.itemCount = 0;
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  clearGuestCart();
});

describe('useCartBadgeCount', () => {
  it('khách chưa đăng nhập, cờ giỏ khách bật: đếm số đơn vị trong giỏ trình duyệt', async () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 2 });
    addGuestLine({ variationId: 'v2', slug: 'xa-phong', quantity: 1 });
    expect((await mount(clientWith(true))).textContent).toBe('3');
    expect(mocks.getCart).not.toHaveBeenCalled();
  });

  it('cập nhật ngay khi giỏ khách đổi (thêm từ Trang chủ, tab khác), không cần tải lại', async () => {
    const badge = await mount(clientWith(true));
    expect(badge.textContent).toBe('0');
    act(() => {
      addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 4 });
    });
    expect(badge.textContent).toBe('4');
    act(() => {
      addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 });
    });
    expect(badge.textContent).toBe('5');
  });

  it('cờ giỏ khách tắt: 0 như trước dù trình duyệt còn món từ lúc cờ bật', async () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 2 });
    expect((await mount(clientWith(false))).textContent).toBe('0');
  });

  it('cấu hình công khai chưa về: 0, không đoán', async () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 2 });
    expect((await mount(clientWith(null))).textContent).toBe('0');
  });

  it('đã đăng nhập: số của giỏ máy chủ, bỏ qua giỏ khách còn trong trình duyệt', async () => {
    mocks.phase = 'authenticated';
    mocks.itemCount = 7;
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 2 });
    expect((await mount(clientWith(true))).textContent).toBe('7');
    expect(mocks.getCart).toHaveBeenCalledTimes(1);
  });

  it('đã đăng nhập hay đang xác định: không tự gọi máy chủ lấy cấu hình công khai chỉ để đếm huy hiệu', async () => {
    for (const phase of ['authenticated', 'loading']) {
      mocks.phase = phase;
      const qc = clientWith(null);
      await mount(qc);
      expect(qc.getQueryState(['public-config'])?.fetchStatus ?? 'idle').toBe('idle');
      mounted?.unmount();
      mounted = null;
    }
  });

  it('HTML máy chủ luôn ra 0 dù trình duyệt có giỏ khách (không lệch lúc hydrate)', () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 3 });
    const html = renderToString(
      <QueryClientProvider client={clientWith(true)}>
        <Badge />
      </QueryClientProvider>,
    );
    expect(html).toContain('>0<');
  });
});
