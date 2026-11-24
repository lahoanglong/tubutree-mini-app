// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

const KEY = 'A'.repeat(43);
const m = vi.hoisted(() => ({
  track: vi.fn(),
  claim: vi.fn(),
  switchCod: vi.fn(),
  reorder: vi.fn(),
  push: vi.fn(),
  cartOn: true,
  status: 'idle' as string,
  user: null as null | Record<string, unknown>,
}));

vi.mock('next/navigation', () => ({ useParams: () => ({ code: 'TB777' }), useRouter: () => ({ push: m.push, replace: vi.fn() }), usePathname: () => '/don/TB777' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: m.user, status: m.status, initialized: true }) }));
vi.mock('@/lib/guest-checkout/api', () => ({
  guestTrackOrder: (...a: unknown[]) => m.track(...a),
  claimGuestOrdersRequest: (...a: unknown[]) => m.claim(...a),
  guestSwitchToCod: (...a: unknown[]) => m.switchCod(...a),
  guestReorder: (...a: unknown[]) => m.reorder(...a),
}));
vi.mock('@/lib/guest-cart/flag', () => ({ useGuestCartFlag: () => ({ enabled: m.cartOn, pending: false }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ tubuZaloPhone: '0899149229', isLoaded: true, isPending: false }) }));

import GuestOrderPage from './page';
import metadataLayout, { metadata } from './layout';
import { GUEST_CART_KEY } from '@/lib/guest-cart/store';
import { GUEST_REORDER_NOTE_KEY } from '@/lib/guest-cart/reorder';

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
  sessionStorage.clear();
  m.switchCod.mockReset().mockResolvedValue({ code: 'TB777', status: 'CONFIRMED', paymentMethod: 'COD' });
  m.reorder.mockReset();
  m.push.mockReset();
  m.cartOn = true;
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

  it('tubu-w28-02: các mốc có giờ Đã đặt, Đã xác nhận, Đang giao, Hoàn tất dạng dọc; mốc chưa tới không có giờ', async () => {
    const r = await mount();
    const steps = [...r.container.querySelectorAll<HTMLElement>('.order-timeline--journey .order-timeline__step')];
    expect(steps.map((s) => [s.dataset.step, s.dataset.state])).toEqual([
      ['received', 'completed'],
      ['preparing', 'current'],
      ['shipping', 'upcoming'],
      ['delivered', 'upcoming'],
    ]);
    expect(steps.map((s) => s.textContent)).toEqual([
      expect.stringMatching(/^Đã đặt, đã qua\d{2}:\d{2} 18\/11(\/2026)?$/),
      expect.stringMatching(/^Đã xác nhận, hiện tại\d{2}:\d{2} 18\/11(\/2026)?$/),
      'Đang giao',
      'Hoàn tất',
    ]);
    expect(steps[1]!.getAttribute('aria-current')).toBe('step');
  });

  it('tubu-w28-02: nút Zalo một chạm mở chat ở thẻ mới không kèm Referer, chép "Hỗ trợ đơn <mã>" (không SĐT, không khoá) và báo đã chép', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const r = await mount();
    const region = r.container.querySelector<HTMLElement>('[aria-labelledby="guest-order-support"]')!;
    expect(region.querySelector('h2')?.textContent).toBe('Cần hỗ trợ?');
    const link = region.querySelector<HTMLAnchorElement>('[data-testid="guest-support-zalo"]')!;
    expect(link.textContent).toBe('Nhắn Zalo cho Tubu về đơn này');
    expect(link.getAttribute('href')).toBe('https://zalo.me/0899149229');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.className).toMatch(/\bmin-h-11\b/);
    const note = () => region.querySelector('[data-testid="guest-support-note"]')!;
    expect(note().getAttribute('aria-live')).toBe('polite');
    expect(note().textContent).toBe('');
    link.addEventListener('click', (e) => e.preventDefault());
    await act(async () => {
      link.click();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toBe('Hỗ trợ đơn TB777');
    expect(copied).not.toContain(KEY);
    expect(copied).not.toMatch(/091|678|\*/);
    expect(note().textContent).toBe('Đã chép “Hỗ trợ đơn TB777”. Bạn dán vào khung chat Zalo nhé.');
  });

  it('tubu-w28-02: chép không được thì đọc mã đơn để khách gõ, liên kết vẫn mở chat', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    const r = await mount();
    const link = r.container.querySelector<HTMLAnchorElement>('[data-testid="guest-support-zalo"]')!;
    link.addEventListener('click', (e) => e.preventDefault());
    await act(async () => {
      link.click();
    });
    expect(r.container.querySelector('[data-testid="guest-support-note"]')?.textContent).toBe('Bạn nhắn kèm mã đơn TB777 để Tubu tra nhanh nhé.');
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

  it('không tìm thấy (mất khoá, khoá hết hạn): lối chính là tra cứu bằng mã đơn, điền sẵn mã đang mở', async () => {
    window.history.replaceState(null, '', '/don/TB777');
    const r = await mount();
    const nf = r.container.querySelector<HTMLElement>('[data-testid="guest-order-not-found"]')!;
    const link = nf.querySelector<HTMLAnchorElement>('[data-testid="guest-order-lookup-link"]')!;
    expect(link.getAttribute('href')).toBe('/don?ma=TB777');
    expect(link.textContent).toBe('Tra cứu bằng mã đơn');
    expect(link.className).toMatch(/\bmin-h-11\b/);
    expect(nf.querySelectorAll('a')[1]?.getAttribute('href')).toBe('/');
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

const AWAITING = { ...ORDER, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', codSwitchable: true };
const buttonByText = (label: string) => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === label);

describe('/don/[code] đổi chuyển khoản chưa trả sang COD', () => {
  it('máy chủ cho đổi: nút phụ cao ≥44px dưới lối mở mã QR, xác nhận thì gọi bằng khoá theo dõi, tải lại đơn và báo đã đổi', async () => {
    m.track.mockResolvedValueOnce(AWAITING).mockResolvedValue({ ...AWAITING, status: 'CONFIRMED', paymentMethod: 'COD', codSwitchable: false });
    const r = await mount();
    const cta = r.container.querySelector<HTMLButtonElement>('[data-testid="cod-switch"] button')!;
    expect(cta.textContent).toBe('Đổi sang trả tiền khi nhận (COD)');
    expect(cta.className).toMatch(/\bmin-h-11\b/);
    await act(async () => cta.click());
    expect(document.body.textContent).toContain('Bạn trả 240.000đ cho shipper khi nhận hàng');
    expect(m.switchCod).not.toHaveBeenCalled();
    await act(async () => buttonByText('Đổi sang COD')!.click());
    await flush(8);
    expect(m.switchCod).toHaveBeenCalledWith('TB777', KEY);
    expect(m.track.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(r.container.querySelector('[data-testid="cod-switch-done"]')?.textContent).toBe('Đã đổi sang trả tiền khi nhận. Đơn đã được xác nhận.');
    expect(r.container.querySelector('[data-testid="cod-switch"]')).toBeNull();
  });

  it('"Giữ chuyển khoản": đóng tấm, không gọi máy chủ', async () => {
    m.track.mockResolvedValue(AWAITING);
    const r = await mount();
    await act(async () => r.container.querySelector<HTMLButtonElement>('[data-testid="cod-switch"] button')!.click());
    await act(async () => buttonByText('Giữ chuyển khoản')!.click());
    await flush(4);
    expect(m.switchCod).not.toHaveBeenCalled();
  });

  it('máy chủ từ chối (409, tiền vừa về): hiện câu của máy chủ và tải lại đơn', async () => {
    m.track.mockResolvedValueOnce(AWAITING).mockResolvedValue({ ...AWAITING, status: 'CONFIRMED', paymentStatus: 'PAID', codSwitchable: false });
    m.switchCod.mockRejectedValue(new ApiError('Đơn đã được thanh toán, không cần đổi sang COD.', 409, 'COD_SWITCH_REFUSED'));
    const r = await mount();
    await act(async () => r.container.querySelector<HTMLButtonElement>('[data-testid="cod-switch"] button')!.click());
    await act(async () => buttonByText('Đổi sang COD')!.click());
    await flush(8);
    expect(r.container.querySelector('[data-testid="cod-switch-done"]')).toBeNull();
    expect(m.track.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('máy chủ không cho đổi (thiếu cờ): không có nút', async () => {
    m.track.mockResolvedValue({ ...AWAITING, codSwitchable: false });
    const r = await mount();
    expect(r.container.querySelector('[data-testid="cod-switch"]')).toBeNull();
  });
});

const DELIVERED = { ...ORDER, status: 'DELIVERED', deliveredAt: '2026-11-20T03:00:00.000Z' };
const REORDER = {
  lines: [{ variationId: 'v1', slug: 'dau-goi', quantity: 2, maxQty: 5, productName: 'Dầu gội', variationName: 'Chai 500ml' }],
  skipped: [{ productName: 'Xà phòng', variationName: null, reason: 'OUT_OF_STOCK' }],
};

describe('/don/[code] "Mua lại đơn này" vào giỏ khách', () => {
  it('đơn đã giao: thêm món còn bán vào giỏ khách, ghi lời báo món hết hàng cho trang giỏ, sang /gio-hang', async () => {
    m.track.mockResolvedValue(DELIVERED);
    m.reorder.mockResolvedValue(REORDER);
    const r = await mount();
    const btn = r.container.querySelector<HTMLButtonElement>('[data-testid="guest-reorder"]')!;
    expect(btn.textContent).toBe('Mua lại đơn này');
    expect(btn.className).toMatch(/\bmin-h-11\b/);
    await act(async () => btn.click());
    await flush(4);
    expect(m.reorder).toHaveBeenCalledWith('TB777', KEY);
    expect(JSON.parse(localStorage.getItem(GUEST_CART_KEY)!)).toEqual([expect.objectContaining({ variationId: 'v1', slug: 'dau-goi', quantity: 2 })]);
    expect(JSON.parse(sessionStorage.getItem(GUEST_REORDER_NOTE_KEY)!).skipped).toEqual([{ name: 'Xà phòng', reason: 'OUT_OF_STOCK' }]);
    expect(m.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('đơn đã huỷ cũng mua lại được; mọi món đều hết hàng: ở lại trang, báo ngay dưới nút, giỏ không đổi', async () => {
    m.track.mockResolvedValue({ ...ORDER, status: 'CANCELLED' });
    m.reorder.mockResolvedValue({ lines: [], skipped: REORDER.skipped });
    const r = await mount();
    await act(async () => r.container.querySelector<HTMLButtonElement>('[data-testid="guest-reorder"]')!.click());
    await flush(4);
    expect(m.push).not.toHaveBeenCalled();
    expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
    const none = r.container.querySelector('[data-testid="guest-reorder-none"]')!;
    expect(none.textContent).toContain('Các món trong đơn này đều đã hết hàng hoặc ngừng bán.');
    expect(none.textContent).toContain('Xà phòng (hết hàng)');
  });

  it('lỗi mạng: báo dưới nút, bấm lại được', async () => {
    m.track.mockResolvedValue(DELIVERED);
    m.reorder.mockRejectedValueOnce(new ApiError('Lỗi máy chủ', 503)).mockResolvedValue(REORDER);
    const r = await mount();
    const btn = r.container.querySelector<HTMLButtonElement>('[data-testid="guest-reorder"]')!;
    await act(async () => btn.click());
    await flush(4);
    expect(r.container.querySelector('[data-testid="guest-reorder-error"]')).not.toBeNull();
    expect(btn.disabled).toBe(false);
    await act(async () => btn.click());
    await flush(4);
    expect(m.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('không có nút khi đơn còn đang xử lý, khi giỏ khách tắt, hay khi đã đăng nhập', async () => {
    const r1 = await mount();
    expect(r1.container.querySelector('[data-testid="guest-reorder"]')).toBeNull();
    m.track.mockResolvedValue(DELIVERED);
    m.cartOn = false;
    const r2 = await mount();
    expect(r2.container.querySelector('[data-testid="guest-reorder"]')).toBeNull();
    m.cartOn = true;
    m.status = 'authenticated';
    m.user = { id: 'u1' };
    const r3 = await mount();
    expect(r3.container.querySelector('[data-testid="guest-reorder"]')).toBeNull();
    expect(m.reorder).not.toHaveBeenCalled();
  });
});
