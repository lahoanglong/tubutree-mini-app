// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// C-025 (A1-014): web khách chưa có trang chi tiết đơn — QR chuyển khoản chỉ hiện một lần ngay sau khi đặt,
// mất tab là khách không trả được tiền. Trang này mở lại được từ "Đơn hàng của tôi" và dựng lại QR cho đơn
// chuyển khoản còn chờ thanh toán.

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u' } as null | Record<string, unknown>, status: 'authenticated' as string },
  params: { code: 'TB-9' } as Record<string, string>,
  order: null as unknown,
  orderCalls: [] as string[],
  qr: { paymentStatus: 'UNPAID' as string, calls: 0 },
  support: { hotline: '0899 149 229', email: 'tubutree@gmail.com' } as Record<string, string> | Error,
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => {
    if (mocks.support instanceof Error) throw mocks.support;
    return mocks.support;
  },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useParams: () => mocks.params }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchOrder: async (code: string) => {
    mocks.orderCalls.push(code);
    if (mocks.order instanceof Error) throw mocks.order;
    return typeof mocks.order === 'function' ? (mocks.order as () => unknown)() : mocks.order;
  },
  getBankQr: async () => {
    mocks.qr.calls += 1;
    return {
      orderCode: 'TB-9', amount: 330000, paymentStatus: mocks.qr.paymentStatus,
      bank: { bin: '970407', name: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' },
      memo: 'TB-9', qrString: 'x', qrImageUrl: 'https://img.vietqr.io/x.png',
    };
  },
}));

import { ApiError } from '@/lib/client-api';
import OrderDetailPage from './page';

const ORDER = {
  code: 'TB-9',
  status: 'PENDING_PAYMENT',
  subtotal: 300000,
  discount: 30000,
  shippingFee: 30000,
  total: 300000,
  paymentMethod: 'BANK_TRANSFER',
  paymentStatus: 'UNPAID',
  createdAt: '2026-10-01T03:00:00Z',
  couponCode: 'WELCOME30',
  pointsUsed: 0,
  note: null,
  shippingAddress: {
    recipient: 'Nguyễn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ',
  },
  shippingPartner: null,
  shippingCode: null,
  trackingLink: null,
  items: [
    { productName: 'Dầu gội bồ kết', variationName: '500ml', unitPrice: 150000, quantity: 2, total: 300000, thumbnail: null },
  ],
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrderDetailPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll('button'));

beforeEach(() => {
  mocks.auth = { user: { id: 'u' }, status: 'authenticated' };
  mocks.params = { code: 'TB-9' };
  mocks.order = structuredClone(ORDER);
  mocks.orderCalls = [];
  mocks.qr = { paymentStatus: 'UNPAID', calls: 0 };
  mocks.support = { hotline: '0899 149 229', email: 'tubutree@gmail.com' };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan/don-hang/[code] — lời liên hệ hủy/đổi đơn (Q-17)', () => {
  const contact = (c: HTMLElement) => Array.from(c.querySelectorAll('p')).find((p) => (p.textContent ?? '').includes('Cần hủy hoặc đổi đơn'))?.textContent ?? '';

  it('chưa có Zalo OA: ghi thẳng hotline và email, không nhắc Zalo OA', async () => {
    const { container } = await mount();
    const t = contact(container);
    expect(t).toContain('0899 149 229');
    expect(t).toContain('tubutree@gmail.com');
    expect(t).not.toContain('Zalo OA');
  });

  it('admin đã cấu hình Zalo OA: nhắc đúng tên OA bên cạnh hotline', async () => {
    mocks.support = { hotline: '1900 1234', email: 'cskh@tubutree.com', zaloOaName: 'Tubu Tree Official' };
    const { container } = await mount();
    const t = contact(container);
    expect(t).toContain('1900 1234');
    expect(t).toContain('Zalo OA Tubu Tree Official');
  });

  it('đọc cấu hình lỗi: vẫn hiện hotline/email mặc định, không nhắc Zalo OA', async () => {
    mocks.support = new Error('boom');
    const { container } = await mount();
    const t = contact(container);
    expect(t).toContain('0899 149 229');
    expect(t).not.toContain('Zalo OA');
  });
});

describe('/tai-khoan/don-hang/[code] — chi tiết đơn và thanh toán lại', () => {
  it('đơn chuyển khoản đang chờ: hiện mã đơn, sản phẩm, tổng tiền, địa chỉ và dựng lại QR/STK/nội dung CK', async () => {
    const { container } = await mount();
    expect(mocks.orderCalls).toEqual(['TB-9']);
    const h1 = container.querySelector('h1')!;
    expect(h1.textContent).toContain('TB-9');
    expect(container.textContent).toContain('Chờ thanh toán');
    expect(container.textContent).toContain('Dầu gội bồ kết');
    expect(container.textContent).toContain('500ml');
    expect(container.textContent).toContain('300.000đ');
    expect(container.textContent).toContain('-30.000đ');
    expect(container.textContent).toContain('WELCOME30');
    expect(container.textContent).toContain('Nguyễn An');
    expect(container.textContent).toContain('1 Xuân Thuỷ, Cầu Giấy, Hà Nội');
    expect(container.textContent).toContain('Chuyển khoản ngân hàng');
    // QR để trả lại đơn
    expect(mocks.qr.calls).toBeGreaterThan(0);
    expect(container.textContent).toContain('9984606774');
    expect(container.textContent).toContain('CONG TY TUBU TREE');
    expect(container.querySelector('img[alt="VietQR"]')).not.toBeNull();
    const labels = buttons(container).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining(['Sao chép: 9984606774', 'Sao chép: TB-9']));
  });

  // Order.discount gộp mã + combo + giảm hạng + Điểm Xanh nên số tiền không được gắn riêng cho mã.
  it('dòng Giảm giá là tổng trung tính, mã và Điểm Xanh nằm ở dòng ghi chú riêng', async () => {
    mocks.order = { ...structuredClone(ORDER), discount: 80000, pointsUsed: 500 };
    const { container } = await mount();
    const rows = Array.from(container.querySelectorAll('div.flex.justify-between'));
    const row = rows.find((r) => (r.textContent ?? '').includes('-80.000đ'));
    expect(row?.firstElementChild?.textContent).toBe('Giảm giá');
    expect(container.textContent).not.toContain('Giảm giá (');
    expect(container.textContent).toContain('Mã giảm giá đã áp dụng: WELCOME30');
    expect(container.textContent).toContain('Đã dùng 500 Điểm Xanh (đã tính trong giảm giá)');
  });

  it('ngày đặt đơn theo giờ Việt Nam, dáng HH:mm dd/MM/yyyy', async () => {
    const { container } = await mount();
    expect(container.textContent).toContain('Đặt lúc 10:00 01/10/2026');
  });

  it('đủ truy cập: một h1, không nhảy cấp, mọi điều khiển có tên và vùng chạm 44px', async () => {
    const { container } = await mount();
    expect(headingProblems(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });

  it('đơn COD đã giao: có thông tin vận chuyển, KHÔNG dựng QR chuyển khoản', async () => {
    mocks.order = {
      ...ORDER, status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'PAID',
      shippingPartner: 'Best Express', shippingCode: 'BE123', trackingLink: 'https://tracking.example/BE123',
    };
    const { container } = await mount();
    expect(mocks.qr.calls).toBe(0);
    expect(container.querySelector('img[alt="VietQR"]')).toBeNull();
    expect(container.textContent).toContain('Đã giao');
    expect(container.textContent).toContain('Best Express');
    expect(container.textContent).toContain('BE123');
    const link = container.querySelector<HTMLAnchorElement>('a[href="https://tracking.example/BE123"]');
    expect(link).not.toBeNull();
    expect(link!.rel).toContain('noopener');
    expect(link!.target).toBe('_blank');
  });

  it('UAT GOMDON-11: đơn COD đã giao (API vẫn để UNPAID) → "Đã thu tiền khi giao", không hiện "Chưa thanh toán"', async () => {
    mocks.order = { ...ORDER, status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID' };
    const { container } = await mount();
    expect(container.textContent).toContain('Đã thu tiền khi giao');
    expect(container.textContent).not.toContain('Chưa thanh toán');
  });

  it('đơn đã hủy: không dựng QR dù là chuyển khoản (API từ chối QR cho đơn đã hủy)', async () => {
    mocks.order = { ...ORDER, status: 'CANCELLED' };
    const { container } = await mount();
    expect(mocks.qr.calls).toBe(0);
    expect(container.textContent).toContain('Đã hủy');
  });

  it('link tra cứu vận đơn không phải http(s) bị bỏ, không thành liên kết', async () => {
    mocks.order = { ...ORDER, status: 'SHIPPING', paymentMethod: 'COD', trackingLink: 'javascript:alert(1)', shippingPartner: 'GHN' };
    const { container } = await mount();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.textContent).toContain('GHN');
  });

  it('khi nhận được tiền (QR báo PAID) trang tải lại đơn để trạng thái không còn "Chờ thanh toán"', async () => {
    mocks.qr.paymentStatus = 'PAID';
    let n = 0;
    mocks.order = () => (++n === 1 ? ORDER : { ...ORDER, status: 'CONFIRMED', paymentStatus: 'PAID' });
    const { container } = await mount();
    await flush(8);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain('Đã xác nhận');
    expect(container.textContent).not.toContain('Chờ thanh toán');
  });

  // PC-7: tiền về thì trang tải lại đơn, đơn hết "chờ thanh toán" và khung QR bị gỡ cùng lúc, nên lời "Đã nhận thanh toán"
  // vừa hiện đã biến mất. Khách phải thấy xác nhận cho tới khi rời trang.
  it('tiền về: khung "Đã nhận thanh toán" ở lại sau khi trang tải lại đơn, không bị gỡ cùng khung QR', async () => {
    mocks.qr.paymentStatus = 'PAID';
    let n = 0;
    mocks.order = () => (++n === 1 ? ORDER : { ...ORDER, status: 'CONFIRMED', paymentStatus: 'PAID' });
    const { container } = await mount();
    await flush(12);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain('Đã xác nhận');
    expect(container.textContent).toContain('Đã nhận thanh toán!');
    expect(container.textContent).toContain('Đơn TB-9 đã được xác nhận');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('img[alt="VietQR"]')).toBeNull();
    expect(container.textContent).not.toContain('Đơn đang chờ bạn chuyển khoản');
  });

  it('khách bấm kiểm tra lại, tiền đã về: khung xác nhận hiện rồi ở lại, đơn thành "Đã xác nhận"', async () => {
    let n = 0;
    mocks.order = () => (++n === 1 ? ORDER : { ...ORDER, status: 'CONFIRMED', paymentStatus: 'PAID' });
    const { container } = await mount();
    expect(container.querySelector('img[alt="VietQR"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Đã nhận thanh toán');

    mocks.qr.paymentStatus = 'PAID';
    const check = buttons(container).find((b) => (b.textContent ?? '').includes('kiểm tra lại'))!;
    await act(async () => {
      check.click();
    });
    await flush(12);
    expect(container.textContent).toContain('Đã nhận thanh toán!');
    expect(container.textContent).toContain('Đã xác nhận');
    await flush(12);
    expect(container.textContent).toContain('Đã nhận thanh toán!');
  });

  it('đơn không tồn tại hoặc của người khác (404): báo không tìm thấy, vẫn có h1 và đường về danh sách', async () => {
    mocks.order = new ApiError('Không tìm thấy đơn hàng.', 404);
    const { container } = await mount();
    expect(container.textContent).toContain('Không tìm thấy đơn hàng');
    expect(headingProblems(container)).toEqual([]);
    expect(container.querySelector('a[href="/tai-khoan"]')).not.toBeNull();
  });

  it('lỗi khác 404: báo lỗi (không nhầm với không tìm thấy) và có nút Thử lại', async () => {
    mocks.order = new ApiError('Máy chủ bận', 500);
    const { container } = await mount();
    // Lỗi tạm thời được thử lại một lần (sau 1 giây) trước khi báo lỗi; 404 thì không thử lại.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200));
    });
    await flush(2);
    expect(container.textContent).toContain('Không tải được đơn hàng');
    expect(container.textContent).not.toContain('Không tìm thấy đơn hàng');
    expect(buttons(container).some((b) => b.textContent === 'Thử lại')).toBe(true);
  });

  it('chưa đăng nhập: mời đăng nhập, có h1 và không gọi API đơn hàng', async () => {
    mocks.auth = { user: null, status: 'anonymous' };
    const { container } = await mount();
    expect(mocks.orderCalls).toEqual([]);
    expect(container.querySelector('a[href="/dang-nhap"]')).not.toBeNull();
    expect(headingProblems(container)).toEqual([]);
  });
});
