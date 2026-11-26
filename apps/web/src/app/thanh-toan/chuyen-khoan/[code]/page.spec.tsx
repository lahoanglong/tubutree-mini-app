// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';

// Mini App bank-payment.tsx: màn VietQR riêng của đơn chuyển khoản (checkout chuyển sang đây ngay sau khi đặt).

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u' } as null | Record<string, unknown>, status: 'authenticated' as string, initialized: true, sessionUnavailable: false },
  params: { code: 'TB-9' } as Record<string, string>,
  qr: { paymentStatus: 'UNPAID' as string, calls: [] as string[], fail: false, cod: false, zalo: undefined as boolean | undefined, zaloSeq: [] as (boolean | undefined)[] },
  guestCalls: [] as Array<[string, string]>,
  replace: vi.fn(),
  switchCod: vi.fn(),
}));
const qrBody = (code: string) => {
  const zalo = mocks.qr.zaloSeq.length > 0 ? mocks.qr.zaloSeq.shift() : mocks.qr.zalo;
  return {
    orderCode: code, amount: 330000, paymentStatus: mocks.qr.paymentStatus,
    bank: { bin: '970407', name: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' },
    memo: code, qrString: 'x', qrImageUrl: 'https://img.vietqr.io/x.png', codSwitchable: mocks.qr.cod,
    ...(zalo === undefined ? {} : { zaloFriendCard: zalo }),
  };
};
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useParams: () => mocks.params, useRouter: () => ({ push: vi.fn(), replace: mocks.replace }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getBankQr: async (code: string) => {
    mocks.qr.calls.push(code);
    if (mocks.qr.fail) throw new Error('lỗi');
    return qrBody(code);
  },
  switchOrderToCod: (...a: unknown[]) => mocks.switchCod(...a),
}));
vi.mock('@/lib/guest-checkout/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/guest-checkout/api')>()),
  guestBankQr: async (code: string, key: string) => {
    mocks.guestCalls.push([code, key]);
    return qrBody(code);
  },
}));
// Thẻ thật đọc cấu hình công khai và câu chữ cửa hàng; ở đây chỉ cần biết trang có vẽ nó không, với mã đơn và nơi bấm nào.
vi.mock('@/components/checkout/order-zalo', () => ({
  OrderZaloFriend: ({ code, from }: { code: string; from: string }) => <div data-testid="zalo-friend-stub" data-code={code} data-from={from} />,
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
  mocks.qr = { paymentStatus: 'UNPAID', calls: [], fail: false, cod: false, zalo: undefined, zaloSeq: [] };
  mocks.guestCalls = [];
  window.location.hash = '';
  mocks.replace.mockReset();
  mocks.switchCod.mockReset().mockResolvedValue({ code: 'TB-9', status: 'CONFIRMED', paymentMethod: 'COD' });
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

  it('tiêu đề cùng hàng với nút lùi như màn chuyển khoản của Mini App (bỏ đệm 48px của body)', async () => {
    const c = mount();
    await flush();
    expect(c.querySelector('h1')!.closest('header')!.hasAttribute('data-page-bleed')).toBe(true);
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

  it('QR chưa về: dải tiêu đề (data-page-bleed) đã có sẵn, nên lúc QR về trang không nhảy (CLS điện thoại)', async () => {
    const c = mount();
    expect(c.querySelector('header[data-page-bleed]')).not.toBeNull();
    expect(c.querySelector('img[alt="VietQR"]')).toBeNull();
    await flush();
    expect(c.querySelector('header[data-page-bleed]')).not.toBeNull();
    expect(c.querySelectorAll('h1')).toHaveLength(1);
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
    expect(c.textContent).toContain('Chưa tải được thông tin thanh toán');
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

describe('trang chuyển khoản — đổi sang COD (w23-02)', () => {
  it('máy chủ cho đổi: nút phụ dưới QR; xác nhận thì gọi API của khách đăng nhập rồi thay trang bằng chi tiết đơn', async () => {
    mocks.qr.cod = true;
    const c = mount();
    await flush();
    const cta = c.querySelector<HTMLButtonElement>('[data-testid="cod-switch"] button')!;
    expect(cta.textContent).toBe('Đổi sang trả tiền khi nhận (COD)');
    await act(async () => cta.click());
    await act(async () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === 'Đổi sang COD')!.click());
    await flush();
    expect(mocks.switchCod).toHaveBeenCalledWith('TB-9');
    expect(mocks.replace).toHaveBeenCalledWith('/tai-khoan/don-hang/TB-9');
  });

  it('máy chủ không cho đổi: không có nút', async () => {
    const c = mount();
    await flush();
    expect(c.querySelector('[data-testid="cod-switch"]')).toBeNull();
  });
});

describe('trang chuyển khoản — thẻ kết bạn Zalo (w39-02)', () => {
  const KEY = 'K'.repeat(43);
  // Thẻ nạp qua next/dynamic: lần nạp đầu phải biên dịch, nên nạp sẵn để mỗi ca chỉ chờ vài nhịp flush.
  beforeAll(async () => {
    await import('@/components/checkout/order-zalo');
  });
  const card = (c: HTMLElement) => c.querySelector('[data-testid="bank-zalo-friend"]');
  const settle = async (c: HTMLElement, want: boolean) => {
    for (let i = 0; i < 40 && !!card(c) !== want; i++) await flush(2);
  };

  it('máy chủ bảo hiện: thẻ nằm dưới "Để sau / Xem đơn hàng", mang mã đơn và nơi bấm bank_transfer; không gọi thêm request nào', async () => {
    mocks.qr.zalo = true;
    const c = mount();
    await flush();
    await settle(c, true);
    const section = card(c)!;
    expect(section).not.toBeNull();
    expect(section.getAttribute('aria-label')).toBe('Zalo Tubu Tree');
    const stub = section.querySelector('[data-testid="zalo-friend-stub"]')!;
    expect(stub.getAttribute('data-code')).toBe('TB-9');
    expect(stub.getAttribute('data-from')).toBe('bank_transfer');
    const later = Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Để sau / Xem đơn hàng')!;
    expect(later.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mocks.qr.calls).toEqual(['TB-9']);
  });

  it.each<[string, boolean | undefined]>([
    ['máy chủ bảo ẩn', false],
    ['API cũ không trả trường', undefined],
  ])('%s: không có thẻ', async (_n, zalo) => {
    mocks.qr.zalo = zalo;
    const c = mount();
    await flush(10);
    expect(c.querySelector('img[alt="VietQR"]')).not.toBeNull();
    expect(card(c)).toBeNull();
  });

  it('chốt lần hiện đầu: lần dò sau trả false (MSS vừa nhắn được như bạn bè) thì thẻ vẫn ở yên', async () => {
    mocks.qr.zaloSeq = [true];
    mocks.qr.zalo = false;
    const c = mount();
    await flush();
    await settle(c, true);
    expect(card(c)).not.toBeNull();
    const check = Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Tôi đã chuyển khoản'))!;
    await act(async () => check.click());
    await flush(10);
    expect(mocks.qr.calls.length).toBeGreaterThanOrEqual(2);
    expect(card(c)).not.toBeNull();
  });

  it('đã nhận tiền (PAID): thẻ vẫn hiện dưới "Xem đơn hàng / Về trang chủ"', async () => {
    mocks.qr.paymentStatus = 'PAID';
    mocks.qr.zalo = true;
    const c = mount();
    await flush();
    await settle(c, true);
    expect(c.textContent).toContain('Đã nhận thanh toán!');
    const home = Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Về trang chủ')!;
    expect(home.compareDocumentPosition(card(c)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lỗi tải: không có thẻ', async () => {
    mocks.qr.fail = true;
    mocks.qr.zalo = true;
    const c = mount();
    await flush(10);
    expect(c.textContent).toContain('Chưa tải được thông tin thanh toán');
    expect(card(c)).toBeNull();
  });

  it('khách vãng lai (#k=): đọc thẻ từ bank-qr của khách, không gọi API của khách đăng nhập', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    window.location.hash = `#k=${KEY}`;
    mocks.qr.zalo = true;
    const c = mount();
    await flush();
    await settle(c, true);
    expect(mocks.guestCalls).toEqual([['TB-9', KEY]]);
    expect(mocks.qr.calls).toEqual([]);
    expect(card(c)!.querySelector('[data-testid="zalo-friend-stub"]')!.getAttribute('data-from')).toBe('bank_transfer');
  });

  it('thẻ hiện thì trang vẫn đúng một h1, nút có tên', async () => {
    mocks.qr.zalo = true;
    const c = mount();
    await flush();
    await settle(c, true);
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });
});
