// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';

// Mini App bank-payment.tsx: màn VietQR riêng của đơn chuyển khoản (checkout chuyển sang đây ngay sau khi đặt).

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u' } as null | Record<string, unknown>, status: 'authenticated' as string, initialized: true, sessionUnavailable: false },
  params: { code: 'TB-9' } as Record<string, string>,
  qr: { paymentStatus: 'UNPAID' as string, calls: [] as string[], fail: false },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useParams: () => mocks.params, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getBankQr: async (code: string) => {
    mocks.qr.calls.push(code);
    if (mocks.qr.fail) throw new Error('lỗi');
    return {
      orderCode: code, amount: 330000, paymentStatus: mocks.qr.paymentStatus,
      bank: { bin: '970407', name: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' },
      memo: code, qrString: 'x', qrImageUrl: 'https://img.vietqr.io/x.png',
    };
  },
}));

import BankPaymentPage from './page';

let mounted: Rendered[] = [];
const mount = () => {
  const r = render(<BankPaymentPage />);
  mounted.push(r);
  return r.container;
};

beforeEach(() => {
  mocks.auth.status = 'authenticated';
  mocks.auth.initialized = true;
  mocks.auth.sessionUnavailable = false;
  mocks.params = { code: 'TB-9' };
  mocks.qr = { paymentStatus: 'UNPAID', calls: [], fail: false };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('trang chuyển khoản /thanh-toan/chuyen-khoan/[code]', () => {
  it('dò mã QR của đúng đơn trên URL và hiện QR, số tài khoản, số tiền, nội dung CK', async () => {
    const c = mount();
    await flush();
    expect(mocks.qr.calls[0]).toBe('TB-9');
    expect(c.querySelector('img[alt="VietQR"]')).not.toBeNull();
    expect(c.textContent).toContain('9984606774');
    expect(c.textContent).toContain('330.000đ');
    expect(c.textContent).toContain('Giữ nguyên nội dung');
  });

  it('thanh tiêu đề nằm dưới đệm 48px của body như màn chuyển khoản của Mini App (không bỏ đệm)', async () => {
    const c = mount();
    await flush();
    expect(c.querySelector('h1')!.closest('header')!.hasAttribute('data-page-bleed')).toBe(false);
  });

  it('nút lùi vào thẳng link thanh toán đi tới chi tiết đơn đang chờ, không tới Checkout', async () => {
    const c = mount();
    await flush();
    expect(c.querySelector('header')!.getAttribute('data-back-href')).toBe('/tai-khoan/don-hang/TB-9');
  });

  it('mỗi dòng cần chép có nút có tên: số tài khoản, số tiền, nội dung', async () => {
    const c = mount();
    await flush();
    const labels = Array.from(c.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining(['Sao chép: 9984606774', 'Sao chép: 330000', 'Sao chép: TB-9']));
  });

  it('mã đơn trên URL được giải mã trước khi gọi API', async () => {
    mocks.params = { code: 'TB%2F1' };
    mount();
    await flush();
    expect(mocks.qr.calls[0]).toBe('TB/1');
  });

  it('có lối "Để sau / Xem đơn hàng" tới chi tiết đơn', async () => {
    const c = mount();
    await flush();
    const link = Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Để sau / Xem đơn hàng');
    expect(link?.getAttribute('href')).toBe('/tai-khoan/don-hang/TB-9');
  });

  it('đã PAID: "Đã nhận thanh toán!", nút "Xem đơn hàng" tới chi tiết đơn và "Về trang chủ", không còn QR', async () => {
    mocks.qr.paymentStatus = 'PAID';
    const c = mount();
    await flush();
    expect(c.textContent).toContain('Đã nhận thanh toán!');
    expect(c.querySelector('img[alt="VietQR"]')).toBeNull();
    const links = Array.from(c.querySelectorAll('a'));
    expect(links.find((a) => a.textContent === 'Xem đơn hàng')?.getAttribute('href')).toBe('/tai-khoan/don-hang/TB-9');
    expect(links.find((a) => a.textContent === 'Về trang chủ')?.getAttribute('href')).toBe('/');
  });

  it('h1 là "Quét QR để chuyển khoản" khi đang chờ trả, đổi thành tiêu đề trung tính khi đã PAID hoặc chưa đăng nhập', async () => {
    const c = mount();
    await flush();
    expect(c.querySelector('h1')!.textContent).toContain('Quét QR để chuyển khoản');
    mocks.qr.paymentStatus = 'PAID';
    const paid = mount();
    await flush();
    expect(paid.querySelector('h1')!.textContent).toBe('Thanh toán chuyển khoản');
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    const guest = mount();
    await flush();
    expect(guest.querySelector('h1')!.textContent).toBe('Thanh toán chuyển khoản');
  });

  it('đã PAID hoặc chưa có QR: không vẽ dải tiêu đề, vẫn đúng một h1 và còn trang cha cho nút lùi', async () => {
    mocks.qr.paymentStatus = 'PAID';
    const c = mount();
    await flush();
    expect(c.querySelector('header')).toBeNull();
    expect(c.innerHTML).not.toContain('max-md:bg-[var(--color-bg-surface)]');
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(c.querySelector('[data-back-href]')!.getAttribute('data-back-href')).toBe('/tai-khoan/don-hang/TB-9');
  });

  it('lỗi tải: báo lỗi, "Thử lại" và vẫn có lối xem đơn hàng', async () => {
    mocks.qr.fail = true;
    const c = mount();
    await flush();
    expect(c.textContent).toContain('Không tải được thông tin thanh toán.');
    expect(Array.from(c.querySelectorAll('button')).some((b) => b.textContent === 'Thử lại')).toBe(true);
    expect(Array.from(c.querySelectorAll('a')).some((a) => a.getAttribute('href') === '/tai-khoan/don-hang/TB-9')).toBe(true);
  });

  it('khách chưa đăng nhập: mời đăng nhập mang returnTo, không gọi API', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    const c = mount();
    await flush();
    expect(mocks.qr.calls).toEqual([]);
    expect(c.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe(
      `/dang-nhap?returnTo=${encodeURIComponent('/thanh-toan/chuyen-khoan/TB-9')}`,
    );
  });

  it('đang khôi phục phiên: chỉ "Đang tải…", chưa gọi API', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.initialized = false;
    const c = mount();
    await flush();
    expect(c.textContent).toContain('Đang tải…');
    expect(mocks.qr.calls).toEqual([]);
  });

  it('mỗi trạng thái đúng một h1, nút có tên', async () => {
    const c = mount();
    await flush();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });
});
