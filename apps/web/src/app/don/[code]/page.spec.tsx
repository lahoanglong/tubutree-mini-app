// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

const KEY = 'A'.repeat(43);
const m = vi.hoisted(() => ({ track: vi.fn(), claim: vi.fn(), status: 'idle' as string, user: null as null | Record<string, unknown> }));

vi.mock('next/navigation', () => ({ useParams: () => ({ code: 'TB777' }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/don/TB777' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: m.user, status: m.status, initialized: true }) }));
vi.mock('@/lib/guest-checkout/api', () => ({
  guestTrackOrder: (...a: unknown[]) => m.track(...a),
  claimGuestOrdersRequest: (...a: unknown[]) => m.claim(...a),
}));

import GuestOrderPage from './page';
import metadataLayout, { metadata } from './layout';

const ORDER = {
  code: 'TB777',
  status: 'CONFIRMED',
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  createdAt: '2026-11-18T03:00:00.000Z',
  deliveredAt: null,
  statusTimes: { CONFIRMED: '2026-11-18T04:00:00.000Z' },
  subtotal: 240_000,
  discount: 0,
  shippingFee: 0,
  total: 240_000,
  items: [{ productName: 'Dầu gội', variationName: 'Chai 500ml', quantity: 2, unitPrice: 120_000, total: 240_000, isGift: false }],
  phoneMasked: '091****678',
  area: { ward: 'Cầu Giấy', province: 'Hà Nội' },
  siblings: [],
  expiresAt: null,
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<GuestOrderPage />);
  mounted.push(r);
  await flush(8);
  return r;
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', `/don/TB777#k=${KEY}`);
  m.track.mockReset().mockResolvedValue(ORDER);
  m.claim.mockReset().mockResolvedValue({ claimed: 1 });
  m.status = 'idle';
  m.user = null;
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/don/[code] theo dõi đơn không đăng nhập', () => {
  it('metadata: noindex và no-referrer ở chính layout của app/don', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe('no-referrer');
    expect(typeof metadataLayout).toBe('function');
  });

  it('gọi API với khoá trong #k=, hiện dòng thời gian, món, tổng, SĐT che, chỉ phường và tỉnh, nút chép đường dẫn và lối đăng nhập đưa đơn về tài khoản', async () => {
    const r = await mount();
    expect(m.track).toHaveBeenCalledWith('TB777', KEY);
    const text = r.container.textContent ?? '';
    expect(r.container.querySelector('[data-testid="order-timeline-tracker"]')).not.toBeNull();
    expect(text).toContain('Dầu gội');
    expect(text).toContain('240.000đ');
    expect(r.container.querySelector('[data-testid="guest-order-phone"]')?.textContent).toBe('091****678');
    expect(text).toContain('Cầu Giấy, Hà Nội');
    expect(r.container.querySelector('[data-testid="guest-order-copy-link"]')?.textContent).toContain('Chép đường dẫn theo dõi');
    expect(r.container.querySelector('[data-testid="guest-order-claim-link"]')?.textContent).toBe('Đăng nhập Zalo trên trình duyệt này để đưa đơn về tài khoản');
    expect(m.claim).not.toHaveBeenCalled();
  });

  it('sai khoá hay sai mã (404) và thiếu khoá: cùng một câu, không lộ gì về đơn', async () => {
    m.track.mockRejectedValue(new ApiError('Không tìm thấy đơn hàng.', 404));
    const r = await mount();
    const nf = r.container.querySelector('[data-testid="guest-order-not-found"]')?.textContent;
    expect(nf).toContain('Không tìm thấy đơn hàng.');
    window.history.replaceState(null, '', '/don/TB777');
    m.track.mockClear();
    const r2 = await mount();
    expect(m.track).not.toHaveBeenCalled();
    expect(r2.container.querySelector('[data-testid="guest-order-not-found"]')?.textContent).toBe(nf);
  });

  it('mở lại không có #k= (khoá lấy từ bộ nhớ trình duyệt, như khi quay về từ đăng nhập): nút chép vẫn chép đường dẫn có khoá', async () => {
    localStorage.setItem('tubu.guestCheckout.orders', JSON.stringify({ TB777: { k: KEY, at: Date.now() } }));
    window.history.replaceState(null, '', '/don/TB777');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const r = await mount();
    expect(m.track).toHaveBeenCalledWith('TB777', KEY);
    await act(async () => {
      r.container.querySelector<HTMLButtonElement>('[data-testid="guest-order-copy-link"]')!.click();
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/don/TB777#k=${KEY}`);
  });

  it('đăng nhập trên trình duyệt có đơn chờ đưa về: gọi claim đúng một lần với deviceId, báo đơn đã về tài khoản', async () => {
    localStorage.setItem('tubu.guestCheckout.device', 'w_abcdefghijklmnopqrstuvwxyz012345');
    localStorage.setItem('tubu.guestCheckout.claimPending', '1');
    m.status = 'authenticated';
    m.user = { id: 'u1' };
    const r = await mount();
    expect(m.claim).toHaveBeenCalledTimes(1);
    expect(m.claim).toHaveBeenCalledWith('w_abcdefghijklmnopqrstuvwxyz012345');
    expect(r.container.querySelector('[data-testid="guest-order-claimed"]')?.textContent).toContain('Đơn đã về tài khoản của bạn.');
    expect(localStorage.getItem('tubu.guestCheckout.claimPending')).toBeNull();
  });
});
