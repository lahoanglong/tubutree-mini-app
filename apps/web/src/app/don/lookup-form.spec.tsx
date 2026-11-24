// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

const m = vi.hoisted(() => ({ lookup: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push, replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/don' }));
vi.mock('@/lib/guest-checkout/api', () => ({ guestLookupOrder: (...a: unknown[]) => m.lookup(...a) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ tubuZaloPhone: '0899149229', isLoaded: true, isPending: false }) }));

import { GuestOrderLookup, normalizeOrderCode } from './lookup-form';

const KEY = 'B'.repeat(43);
const ORDER = { code: 'TUBU2026112212345', status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', phoneMasked: '091****678' };
const OK = { order: ORDER, trackingKey: KEY, trackPath: `/don/TUBU2026112212345#k=${KEY}`, bankPath: null, linkExpiresAt: '2026-11-23T06:00:00.000Z' };

let mounted: Rendered[] = [];
let client: QueryClient;
const mount = async (initialCode = '') => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const r = render(<GuestOrderLookup initialCode={initialCode} />, client);
  mounted.push(r);
  await flush(2);
  return r;
};
const codeInput = (r: Rendered) => r.container.querySelector<HTMLInputElement>('[data-testid="guest-lookup-code"]')!;
const phoneInput = (r: Rendered) => r.container.querySelector<HTMLInputElement>('[data-testid="guest-lookup-phone"]')!;
const submit = async (r: Rendered) => {
  click(r.container.querySelector<HTMLButtonElement>('[data-testid="guest-lookup-submit"]'));
  await flush(6);
};

beforeEach(() => {
  m.lookup.mockReset().mockResolvedValue(OK);
  m.push.mockReset();
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/don tra cứu đơn đặt không đăng nhập', () => {
  it('ô nhập và nút đủ vùng chạm 44px, số tabular, SĐT bàn phím số; nhãn nối gợi ý; mã điền sẵn từ ?ma=', async () => {
    const r = await mount('TB777');
    expect(codeInput(r).value).toBe('TB777');
    for (const el of [codeInput(r), phoneInput(r), r.container.querySelector('[data-testid="guest-lookup-submit"]')!]) expect(el.className).toMatch(/\bmin-h-11\b/);
    expect(codeInput(r).className).toMatch(/\btabular-nums\b/);
    expect(phoneInput(r).className).toMatch(/\btabular-nums\b/);
    expect(phoneInput(r).getAttribute('inputmode')).toBe('tel');
    expect(phoneInput(r).getAttribute('autocomplete')).toBe('tel');
    expect(codeInput(r).getAttribute('aria-describedby')).toBe(`${codeInput(r).id}-hint`);
    expect(r.container.querySelector(`label[for="${codeInput(r).id}"]`)?.textContent).toBe('Mã đơn hàng');
  });

  it('bấm khi còn trống: lỗi dưới từng ô, focus ô mã đầu tiên, không gọi API', async () => {
    const r = await mount();
    await submit(r);
    expect(m.lookup).not.toHaveBeenCalled();
    expect(codeInput(r).getAttribute('aria-invalid')).toBe('true');
    expect(phoneInput(r).getAttribute('aria-invalid')).toBe('true');
    expect(r.container.textContent).toContain('Mã đơn gồm chữ và số');
    expect(r.container.textContent).toContain('Số di động gồm 10 số');
    expect(document.activeElement).toBe(codeInput(r));
    typeInto(codeInput(r), 'TUBU2026112212345');
    await submit(r);
    expect(document.activeElement).toBe(phoneInput(r));
    expect(m.lookup).not.toHaveBeenCalled();
  });

  it('chuẩn hoá trước khi gửi: mã thường có dấu cách và # → chữ hoa liền; SĐT +84 có dấu cách → 0xxxxxxxxx', async () => {
    const r = await mount();
    typeInto(codeInput(r), ' #tubu 2026 1122 12345 ');
    typeInto(phoneInput(r), '+84 912 345 678');
    await submit(r);
    expect(m.lookup).toHaveBeenCalledWith({ orderCode: 'TUBU2026112212345', phone: '0912345678' });
    expect(normalizeOrderCode('#ab-12 3')).toBe('AB-123');
  });

  it('khớp (COD): đặt bản xem vào bộ đệm của trang theo dõi rồi sang /don/<mã>#k=<khoá tạm>, không lưu khoá tạm vào trình duyệt', async () => {
    localStorage.clear();
    const r = await mount();
    typeInto(codeInput(r), 'TUBU2026112212345');
    typeInto(phoneInput(r), '0912345678');
    await submit(r);
    expect(m.push).toHaveBeenCalledWith(`/don/TUBU2026112212345#k=${KEY}`);
    expect(client.getQueryData(['guest-order', 'TUBU2026112212345', KEY])).toEqual(ORDER);
    expect(localStorage.getItem('tubu.guestCheckout.orders')).toBeNull();
    expect(r.container.querySelector('[data-testid="guest-lookup-submit"]')?.textContent).toBe('Đang tra cứu…');
  });

  it('chuyển khoản đang chờ tiền: sang thẳng trang QR (bankPath)', async () => {
    m.lookup.mockResolvedValue({ ...OK, bankPath: `/thanh-toan/chuyen-khoan/TUBU2026112212345#k=${KEY}` });
    const r = await mount();
    typeInto(codeInput(r), 'TUBU2026112212345');
    typeInto(phoneInput(r), '0912345678');
    await submit(r);
    expect(m.push).toHaveBeenCalledWith(`/thanh-toan/chuyen-khoan/TUBU2026112212345#k=${KEY}`);
  });

  it('không khớp (404): một câu chung, ở lại trang; sửa ô thì câu lỗi tắt; quá nhiều lượt (429): câu chờ 1 phút', async () => {
    m.lookup.mockRejectedValueOnce(new ApiError('Không tìm thấy đơn khớp mã đơn và số điện thoại này.', 404));
    const r = await mount();
    typeInto(codeInput(r), 'TUBU2026112212345');
    typeInto(phoneInput(r), '0912345678');
    await submit(r);
    const alert = () => r.container.querySelector('[data-testid="guest-lookup-error"]');
    expect(alert()?.getAttribute('role')).toBe('alert');
    expect(alert()?.textContent).toBe('Không tìm thấy đơn khớp mã và số điện thoại này. Bạn kiểm tra lại nhé.');
    expect(m.push).not.toHaveBeenCalled();
    typeInto(phoneInput(r), '0912345679');
    await flush(2);
    expect(alert()).toBeNull();
    m.lookup.mockRejectedValueOnce(new ApiError('Too Many Requests', 429));
    await submit(r);
    expect(alert()?.textContent).toBe('Bạn tra hơi nhiều lần. Thử lại sau 15 phút nhé.');
  });

  it('tubu-w18-01: 429 có mã GUEST_LOOKUP_LIMIT thì hiện câu máy chủ (đúng số phút còn chờ)', async () => {
    m.lookup.mockRejectedValueOnce(new ApiError('Bạn tra hơi nhiều lần. Thử lại sau 1 phút nhé.', 429, 'GUEST_LOOKUP_LIMIT'));
    const r = await mount();
    typeInto(codeInput(r), 'TUBU2026112212345');
    typeInto(phoneInput(r), '0912345678');
    await submit(r);
    expect(r.container.querySelector('[data-testid="guest-lookup-error"]')?.textContent).toBe('Bạn tra hơi nhiều lần. Thử lại sau 1 phút nhé.');
  });

  it('tubu-w28-02: không tìm thấy (404) hay chạm trần (429 GUEST_LOOKUP_LIMIT): nút Zalo một chạm chép mã vừa gõ, không kèm SĐT; sửa ô thì nút tắt cùng câu lỗi', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    m.lookup.mockRejectedValueOnce(new ApiError('Không tìm thấy đơn khớp mã đơn và số điện thoại này.', 404));
    const r = await mount();
    typeInto(codeInput(r), 'tubu 2026112212345');
    typeInto(phoneInput(r), '0912345678');
    await submit(r);
    const support = () => r.container.querySelector<HTMLAnchorElement>('[data-testid="guest-support-zalo"]');
    expect(support()?.getAttribute('href')).toBe('https://zalo.me/0899149229');
    expect(support()?.getAttribute('rel')).toBe('noopener noreferrer');
    const submitBtn = r.container.querySelector('[data-testid="guest-lookup-submit"]')!;
    expect(submitBtn.compareDocumentPosition(support()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    support()!.addEventListener('click', (e) => e.preventDefault());
    await act(async () => {
      support()!.click();
    });
    expect(writeText).toHaveBeenCalledWith('Hỗ trợ đơn TUBU2026112212345');
    expect(JSON.stringify(writeText.mock.calls)).not.toContain('0912345678');
    typeInto(phoneInput(r), '0912345679');
    await flush(2);
    expect(support()).toBeNull();
    m.lookup.mockRejectedValueOnce(new ApiError('Bạn tra hơi nhiều lần. Thử lại sau 15 phút nhé.', 429, 'GUEST_LOOKUP_LIMIT'));
    await submit(r);
    expect(r.container.querySelector('[data-testid="guest-lookup-error"]')?.textContent).toBe('Bạn tra hơi nhiều lần. Thử lại sau 15 phút nhé.');
    expect(support()).not.toBeNull();
  });

  it('tubu-w28-02: đơn đã về tài khoản (403) và lỗi mạng không có nút Zalo (đã có lối đăng nhập / thử lại)', async () => {
    m.lookup.mockRejectedValueOnce(new ApiError('Đơn này đã được lưu vào tài khoản Zalo.', 403, 'GUEST_ORDER_CLAIMED'));
    const r = await mount();
    typeInto(codeInput(r), 'TUBU2026112212345');
    typeInto(phoneInput(r), '0912345678');
    await submit(r);
    expect(r.container.querySelector('[data-testid="guest-lookup-claimed"]')).not.toBeNull();
    expect(r.container.querySelector('[data-testid="guest-support-zalo"]')).toBeNull();
    m.lookup.mockRejectedValueOnce(new ApiError('Lỗi máy chủ', 500));
    typeInto(phoneInput(r), '0912345679');
    await submit(r);
    expect(r.container.querySelector('[data-testid="guest-lookup-error"]')).not.toBeNull();
    expect(r.container.querySelector('[data-testid="guest-support-zalo"]')).toBeNull();
  });

  it('tubu-w18-01: đơn đã về tài khoản Zalo (403 GUEST_ORDER_CLAIMED): không sang trang theo dõi, mời đăng nhập Zalo rồi quay về chi tiết đơn', async () => {
    m.lookup.mockRejectedValueOnce(
      new ApiError('Đơn này đã được lưu vào tài khoản Zalo. Bạn đăng nhập Zalo để xem đơn trong Đơn của tôi nhé.', 403, 'GUEST_ORDER_CLAIMED'),
    );
    const r = await mount();
    typeInto(codeInput(r), ' tubu2026112212345');
    typeInto(phoneInput(r), '0912345678');
    await submit(r);
    const box = r.container.querySelector('[data-testid="guest-lookup-claimed"]');
    expect(box?.getAttribute('role')).toBe('alert');
    expect(box?.textContent).toContain('Đơn này đã được lưu vào tài khoản Zalo.');
    const link = r.container.querySelector<HTMLAnchorElement>('[data-testid="guest-lookup-claimed-login"]')!;
    expect(link.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent('/tai-khoan/don-hang/TUBU2026112212345')}`);
    expect(link.className).toContain('min-h-11');
    expect(r.container.querySelector('[data-testid="guest-lookup-error"]')).toBeNull();
    expect(m.push).not.toHaveBeenCalled();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    typeInto(phoneInput(r), '0912345679');
    await flush(2);
    expect(r.container.querySelector('[data-testid="guest-lookup-claimed"]')).toBeNull();
  });

  it('403 khác (không mã GUEST_ORDER_CLAIMED) vẫn là câu lỗi thường, không mời đăng nhập', async () => {
    m.lookup.mockRejectedValueOnce(new ApiError('Không có quyền.', 403));
    const r = await mount();
    typeInto(codeInput(r), 'TUBU2026112212345');
    typeInto(phoneInput(r), '0912345678');
    await submit(r);
    expect(r.container.querySelector('[data-testid="guest-lookup-claimed"]')).toBeNull();
    expect(r.container.querySelector('[data-testid="guest-lookup-error"]')).not.toBeNull();
  });

  it('đang tra: ô chỉ đọc và nút aria-disabled (không `disabled`, giữ focus); bấm đúp chỉ gọi một lần', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    m.lookup.mockReturnValue(new Promise((res) => (resolve = res)));
    const r = await mount();
    typeInto(codeInput(r), 'TUBU2026112212345');
    typeInto(phoneInput(r), '0912345678');
    const btn = r.container.querySelector<HTMLButtonElement>('[data-testid="guest-lookup-submit"]')!;
    click(btn);
    await flush(2);
    click(btn);
    await flush(2);
    expect(m.lookup).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(phoneInput(r).readOnly).toBe(true);
    await act(async () => resolve(OK));
  });
});
