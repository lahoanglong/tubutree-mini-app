// @vitest-environment jsdom
import { act, useState } from 'react';
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
  qr: { paymentStatus: 'UNPAID' as string, calls: 0, paymentDeadline: undefined as string | undefined, error: null as unknown },
  support: { hotline: '0984 606 774', email: 'tubutree@gmail.com' } as Record<string, string> | Error,
  eta: null as null | { minDays: number; maxDays: number },
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      if (path !== '/config/public') throw new Error(`chưa mock ${path}`);
      if (mocks.support instanceof Error) throw mocks.support;
      return { support: mocks.support, shippingEta: mocks.eta };
    },
  },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useParams: () => mocks.params, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchOrder: async (code: string) => {
    mocks.orderCalls.push(code);
    if (mocks.order instanceof Error) throw mocks.order;
    return typeof mocks.order === 'function' ? (mocks.order as () => unknown)() : mocks.order;
  },
  fetchMyReturns: async () => [],
  getBankQr: async () => {
    mocks.qr.calls += 1;
    if (mocks.qr.error) throw mocks.qr.error;
    return {
      orderCode: 'TB-9', amount: 330000, paymentStatus: mocks.qr.paymentStatus, paymentDeadline: mocks.qr.paymentDeadline,
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
  couponDiscount: 30000,
  comboDiscount: 0,
  tierDiscount: 0,
  pointsDiscount: 0,
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
  mocks.qr = { paymentStatus: 'UNPAID', calls: 0, paymentDeadline: undefined, error: null };
  mocks.support = { hotline: '0984 606 774', email: 'tubutree@gmail.com' };
  mocks.eta = null;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan/don-hang/[code] — khối "Cần hỗ trợ?" (Q-17)', () => {
  const block = (c: HTMLElement) => Array.from(c.querySelectorAll('div')).find((d) => (d.firstElementChild?.textContent ?? '') === 'Cần hỗ trợ?') ?? null;

  it('ghi thẳng hotline (tel:) và email (mailto:), không có nút Zalo OA khi chưa cấu hình', async () => {
    const { container } = await mount();
    const b = block(container)!;
    expect(b.querySelector('a[href="tel:0984606774"]')?.textContent).toBe('Gọi hotline 0984 606 774');
    expect(b.querySelector('a[href="mailto:tubutree@gmail.com"]')).not.toBeNull();
    expect(b.textContent).not.toContain('Zalo OA');
  });

  it('hotline cấu hình số liền 18001234 được ghi "1800 1234" cho dễ đọc (R5-BUYER-5)', async () => {
    mocks.support = { hotline: '18001234', email: 'cskh@tubutree.com' };
    const { container } = await mount();
    const b = block(container)!;
    expect(b.textContent).toContain('Gọi hotline 1800 1234');
    expect(b.textContent).not.toContain('18001234');
  });

  it('đọc cấu hình lỗi: vẫn hiện hotline/email mặc định', async () => {
    mocks.support = new Error('boom');
    const { container } = await mount();
    expect(block(container)!.querySelector('a[href="tel:0984606774"]')).not.toBeNull();
  });
});

describe('/tai-khoan/don-hang/[code] — chi tiết đơn và thanh toán lại', () => {
  it('đơn chuyển khoản đang chờ: hiện mã đơn, sản phẩm, tổng tiền, địa chỉ và dựng lại QR/STK/nội dung CK', async () => {
    const { container } = await mount();
    expect(mocks.orderCalls).toEqual(['TB-9']);
    const h1 = container.querySelector('h1')!;
    expect(h1.textContent).toBe('Chi tiết đơn hàng');
    expect(container.textContent).toContain('TB-9');
    expect(container.textContent).toContain('Chờ thanh toán');
    expect(container.textContent).toContain('Dầu gội bồ kết');
    expect(container.textContent).toContain('500ml');
    expect(container.textContent).toContain('300.000đ');
    expect(container.textContent).toContain('-30.000đ');
    expect(container.textContent).toContain('WELCOME30');
    expect(container.textContent).toContain('Nguyễn An');
    expect(container.textContent).toContain('1 Xuân Thuỷ, Cầu Giấy, Hà Nội');
    expect(container.textContent).toContain('Chuyển khoản');
    // QR để trả lại đơn
    expect(mocks.qr.calls).toBeGreaterThan(0);
    expect(container.textContent).toContain('9984606774');
    expect(container.textContent).toContain('CONG TY TUBU TREE');
    expect(container.querySelector('img[alt="VietQR"]')).not.toBeNull();
    const labels = buttons(container).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining(['Sao chép: 9984606774', 'Sao chép: TB-9']));
  });

  // R4-BUYER-7: Order.discount gộp nhiều nguồn; mỗi khoản một dòng đúng tên, không gắn cả tổng cho mã.
  const LEGACY = (() => {
    const { couponDiscount: _c, comboDiscount: _b, tierDiscount: _t, pointsDiscount: _p, ...rest } = structuredClone(ORDER);
    return rest;
  })();
  const rowOf = (container: HTMLElement, label: string) =>
    Array.from(container.querySelectorAll('div.flex.justify-between')).find((r) => r.firstElementChild?.textContent === label);

  it('đơn có số liệu từng khoản: mỗi nguồn giảm một dòng, cộng lại bằng tổng giảm', async () => {
    mocks.order = {
      ...structuredClone(ORDER), discount: 80000, couponDiscount: 30000, comboDiscount: 10000,
      tierDiscount: 5000, pointsDiscount: 35000, pointsUsed: 35,
    };
    const { container } = await mount();
    expect(rowOf(container, 'Mã giảm giá (WELCOME30)')?.textContent).toContain('-30.000đ');
    expect(rowOf(container, 'Ưu đãi combo')?.textContent).toContain('-10.000đ');
    expect(rowOf(container, 'Ưu đãi hạng thành viên')?.textContent).toContain('-5.000đ');
    expect(rowOf(container, 'Điểm Xanh (35 điểm)')?.textContent).toContain('-35.000đ');
    expect(rowOf(container, 'Giảm giá')).toBeUndefined();
    expect(container.textContent).not.toContain('đã tính trong giảm giá');
    expect(container.textContent).not.toContain('Mã giảm giá đã áp dụng');
  });

  it('khoản nào bằng 0 thì không có dòng', async () => {
    mocks.order = { ...structuredClone(ORDER), discount: 30000, couponDiscount: 30000, comboDiscount: 0, tierDiscount: 0, pointsDiscount: 0 };
    const { container } = await mount();
    expect(rowOf(container, 'Mã giảm giá (WELCOME30)')?.textContent).toContain('-30.000đ');
    expect(container.textContent).not.toContain('Ưu đãi combo');
    expect(container.textContent).not.toContain('Điểm Xanh (');
  });

  it('đơn tách của nhóm đặt hàng: tên mã lấy từ đơn đầu của nhóm (groupCouponCode)', async () => {
    mocks.order = {
      ...structuredClone(ORDER), couponCode: null, groupCouponCode: 'FREESHIP', discount: 20000, couponDiscount: 20000,
    };
    const { container } = await mount();
    expect(rowOf(container, 'Mã giảm giá (FREESHIP)')?.textContent).toContain('-20.000đ');
  });

  it('đơn cũ chưa có số liệu từng khoản: một dòng tổng, ghi rõ đã gồm Điểm Xanh khi có dùng điểm', async () => {
    mocks.order = { ...LEGACY, discount: 80000, pointsUsed: 500 };
    const { container } = await mount();
    expect(rowOf(container, 'Giảm giá (gồm Điểm Xanh)')?.textContent).toContain('-80.000đ');
  });

  it('đơn cũ không dùng điểm: một dòng "Giảm giá"', async () => {
    mocks.order = LEGACY;
    const { container } = await mount();
    expect(rowOf(container, 'Giảm giá')?.textContent).toContain('-30.000đ');
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
    expect(container.textContent).toContain('Giao thành công');
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

  it('R5-SYNC-1: chờ chuyển khoản mà hàng đã bàn giao (Tubu xử lý tay) — câu trung tính, không QR, không hạn "tự huỷ", không nút huỷ', async () => {
    mocks.order = { ...ORDER, paymentDeadline: '2026-10-02T03:00:00Z', canCancel: false, manualHandling: true };
    const { container } = await mount();
    expect(container.textContent).toContain('Tubu đang xử lý đơn này, liên hệ CSKH nếu cần hỗ trợ.');
    expect(mocks.qr.calls).toBe(0);
    expect(container.textContent).not.toContain('quá hạn đơn sẽ tự huỷ');
    expect(container.textContent).not.toContain('Thanh toán trước');
    expect(container.textContent).not.toContain('Đơn đang chờ bạn chuyển khoản');
    expect(buttons(container).map((b) => b.textContent)).not.toContain('Huỷ đơn');
  });

  it('chờ chuyển khoản mà đã quá hạn thanh toán: không dựng QR, không mời trả, vẫn ghi hạn và "quá hạn đơn sẽ tự huỷ" như Mini App', async () => {
    mocks.order = { ...ORDER, paymentDeadline: '2000-01-01T00:00:00Z' };
    const { container } = await mount();
    expect(mocks.qr.calls).toBe(0);
    expect(container.querySelector('img[alt="VietQR"]')).toBeNull();
    expect(container.textContent).not.toContain('Đơn đang chờ bạn chuyển khoản');
    expect(container.textContent).toContain('Thanh toán trước');
    expect(container.textContent).toContain('quá hạn đơn sẽ tự huỷ');
  });

  it('chờ chuyển khoản còn hạn: dựng QR như cũ', async () => {
    mocks.order = { ...ORDER, paymentDeadline: '2999-01-01T00:00:00Z' };
    const { container } = await mount();
    expect(mocks.qr.calls).toBeGreaterThan(0);
    expect(container.textContent).toContain('Đơn đang chờ bạn chuyển khoản');
  });

  it('lần dò QR bị từ chối chốt (409) khi đang mở trang: dòng "Quét mã bên dưới" biến mất cùng lúc khung chuyển sang đóng', async () => {
    mocks.order = { ...ORDER, paymentDeadline: '2999-01-01T00:00:00Z' };
    const { container } = await mount();
    expect(container.textContent).toContain('Quét mã bên dưới');
    mocks.qr.error = new ApiError('Đơn đã huỷ.', 409);
    const check = buttons(container).find((b) => (b.textContent ?? '').includes('Kiểm tra'))!;
    await act(async () => {
      check.click();
    });
    await flush(12);
    expect(container.textContent).toContain('Đơn không còn chờ chuyển khoản');
    expect(container.textContent).not.toContain('Quét mã bên dưới');
  });

  it('QR đã hiện lúc còn hạn thì ở lại khi trang dựng lại sau hạn, để lần dò thấy PAID vẫn báo "Đã nhận thanh toán"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-19T11:59:50Z'));
      mocks.order = { ...ORDER, paymentDeadline: '2026-10-19T12:00:00Z' };
      mocks.qr.paymentDeadline = '2026-10-19T12:00:00Z';
      let bump = () => {};
      const Host = () => {
        const [, set] = useState(0);
        bump = () => set((n) => n + 1);
        return <OrderDetailPage />;
      };
      const r = render(<Host />);
      mounted.push(r);
      await flush(8);
      const { container } = r;
      expect(container.querySelector('img[alt="VietQR"]')).not.toBeNull();

      vi.setSystemTime(new Date('2026-10-19T12:00:05Z'));
      await act(async () => bump());
      await flush(4);
      expect(container.querySelector('img[alt="VietQR"]')).not.toBeNull();
      expect((container.textContent ?? '').split('quá hạn đơn sẽ tự huỷ').length - 1).toBe(1);

      mocks.qr.paymentStatus = 'PAID';
      const check = buttons(container).find((b) => (b.textContent ?? '').includes('Kiểm tra'))!;
      await act(async () => {
        check.click();
      });
      await flush(12);
      expect(container.textContent).toContain('Đã nhận thanh toán!');
    } finally {
      vi.useRealTimers();
    }
  });

  it('đơn đã huỷ: không dựng QR dù là chuyển khoản (API từ chối QR cho đơn đã huỷ)', async () => {
    mocks.order = { ...ORDER, status: 'CANCELLED' };
    const { container } = await mount();
    expect(mocks.qr.calls).toBe(0);
    expect(container.textContent).toContain('Đã huỷ');
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
    const hero = container.querySelector('[data-testid="status-hero"]')!;
    expect(hero.textContent).toContain('Đã xác nhận');
    expect(hero.textContent).not.toContain('Chờ thanh toán');
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
    const check = buttons(container).find((b) => (b.textContent ?? '').includes('Kiểm tra'))!;
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
    expect(container.textContent).toContain('Chi tiết đơn hàng');
    expect(container.textContent).toContain('Chưa tải được trang này');
    expect(container.textContent).toContain('Cần hỗ trợ');
    expect(container.textContent).not.toContain('Không tìm thấy đơn hàng');
    expect(buttons(container).some((b) => b.textContent === 'Thử lại')).toBe(true);
  });

  it('chưa đăng nhập: mời đăng nhập, có h1 và không gọi API đơn hàng', async () => {
    mocks.auth = { user: null, status: 'anonymous' };
    const { container } = await mount();
    expect(mocks.orderCalls).toEqual([]);
    expect(container.querySelector('a[href="/dang-nhap?returnTo=%2Ftai-khoan%2Fdon-hang%2FTB-9"]')).not.toBeNull();
    expect(headingProblems(container)).toEqual([]);
  });
});

describe('/tai-khoan/don-hang/[code] — đơn tách theo nơi giao (D4)', () => {
  it('đơn gian hàng tự giao: ghi rõ ai giao và SĐT gian hàng; liệt kê đơn cùng lần đặt kèm liên kết', async () => {
    mocks.order = {
      ...structuredClone(ORDER),
      status: 'CONFIRMED',
      paymentMethod: 'COD',
      fulfilment: { kind: 'MERCHANT', name: 'Mật ong Linh', phone: '0900000009' },
      siblings: [{ code: 'TB-8', status: 'SHIPPING', total: 130000, fulfillerName: 'Tubu Tree' }],
    };
    const { container } = await mount();
    expect(container.textContent).toContain('Giao bởi Mật ong Linh (gian hàng đối tác tự đóng gói và giao)');
    expect(container.textContent).toContain('Liên hệ gian hàng: 0900000009');
    const siblings = container.querySelector('section[aria-label="Đơn cùng lần đặt"]')!;
    expect(siblings.textContent).toContain('TB-8 · Tubu Tree giao');
    expect(siblings.querySelector('a')!.getAttribute('href')).toContain('TB-8');
    expect(smallTouchTargets(container)).toEqual([]);
  });

  it('đơn Tubu giao không tách: không hiện dòng nơi giao hay danh sách đơn cùng lần đặt', async () => {
    mocks.order = { ...structuredClone(ORDER), fulfilment: { kind: 'TUBU', name: 'Tubu Tree', phone: null }, siblings: [] };
    const { container } = await mount();
    expect(container.textContent).not.toContain('Giao bởi');
    expect(container.querySelector('section[aria-label="Đơn cùng lần đặt"]')).toBeNull();
  });
});

// R8: mỗi lần mua một đánh giá; API trả trạng thái đánh giá của từng dòng ở chính đơn này.
describe('/tai-khoan/don-hang/[code] — đánh giá theo từng dòng của đơn (R8)', () => {
  const delivered = (item: Record<string, unknown>) => ({
    ...structuredClone(ORDER),
    id: 'ord-1',
    status: 'DELIVERED',
    paymentMethod: 'COD',
    paymentStatus: 'PAID',
    items: [{ ...ORDER.items[0], productSlug: 'dau-goi-bo-ket', ...item }],
  });
  const reviewLinks = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('a')).filter((a) => /^(Viết|Sửa) đánh giá$/.test(a.textContent ?? ''));

  it('dòng còn viết được → "Viết đánh giá" mở trang sản phẩm, cuộn tới khối đánh giá và chọn sẵn đơn này', async () => {
    mocks.order = delivered({ reviewId: null, reviewable: true });
    const { container } = await mount();
    const links = reviewLinks(container);
    expect(links.map((a) => a.textContent)).toEqual(['Viết đánh giá']);
    expect(links[0]!.getAttribute('href')).toBe('/san-pham/dau-goi-bo-ket?danh-gia=ord-1#danh-gia');
    expect(links[0]!.className).toContain('min-h-11');
  });

  it('dòng đã đánh giá ở đơn này → "Sửa đánh giá" (cùng đường dẫn, trang sản phẩm mở sửa đúng đánh giá)', async () => {
    mocks.order = delivered({ reviewId: 'rv-1', reviewable: false });
    const { container } = await mount();
    const links = reviewLinks(container);
    expect(links.map((a) => a.textContent)).toEqual(['Sửa đánh giá']);
    expect(links[0]!.getAttribute('href')).toBe('/san-pham/dau-goi-bo-ket?danh-gia=ord-1#danh-gia');
  });

  it.each([
    ['đơn không tính để đánh giá (CTV đặt hộ)', { reviewId: null, reviewable: false }, 'DELIVERED'],
    ['đơn chưa giao', { reviewable: true }, 'SHIPPING'],
    ['đơn cũ không có slug', { productSlug: null, reviewable: true }, 'DELIVERED'],
  ])('%s → không có lối vào đánh giá', async (_n, item, status) => {
    mocks.order = { ...delivered(item), status };
    const { container } = await mount();
    expect(reviewLinks(container)).toEqual([]);
  });
});

describe('/tai-khoan/don-hang/[code] — ngày giao dự kiến, ảnh món, ghi chú, khung chờ (R-9, R-35, R-107, R-108)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T03:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const shipping = (extra: Record<string, unknown> = {}) => ({
    ...ORDER,
    status: 'SHIPPING',
    paymentMethod: 'COD',
    createdAt: '2026-10-28T01:39:00Z',
    statusTimes: { CONFIRMED: '2026-10-28T02:00:00Z' },
    ...extra,
  });

  it('đã cấu hình: dải đầu trang và mốc giao thành công ghi "Dự kiến giao 30/10 – 01/11"', async () => {
    mocks.eta = { minDays: 2, maxDays: 4 };
    mocks.order = shipping();
    const { container } = await mount();
    expect(container.querySelector('[data-testid="order-eta"]')?.textContent).toBe('Dự kiến giao 30/10 – 01/11');
    expect(container.textContent?.match(/Dự kiến giao 30\/10 – 01\/11/g)).toHaveLength(2);
  });

  it('chưa cấu hình hoặc đơn đã giao: ẩn dòng, không bịa ngày', async () => {
    mocks.order = shipping();
    const first = await mount();
    expect(first.container.textContent).not.toContain('Dự kiến giao');
    mocks.eta = { minDays: 2, maxDays: 4 };
    mocks.order = shipping({ status: 'DELIVERED' });
    const second = await mount();
    expect(second.container.textContent).not.toContain('Dự kiến giao');
  });

  it('chạm vào dòng món mở trang sản phẩm; có ảnh 48px ở điện thoại', async () => {
    mocks.order = shipping({ items: [{ productName: 'Dầu gội bồ kết', variationName: '500ml', productSlug: 'dau-goi', unitPrice: 150000, quantity: 2, total: 300000, thumbnail: null }] });
    const { container } = await mount();
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="Xem sản phẩm Dầu gội bồ kết"]')!;
    expect(link.getAttribute('href')).toBe('/san-pham/dau-goi');
    expect(link.querySelector('div[style*="width: 48px"]')).not.toBeNull();
  });

  it('ghi chú của khách có khối riêng, tiêu đề dùng chữ của Mini App', async () => {
    mocks.order = shipping({ note: 'Gọi trước khi giao' });
    const { container } = await mount();
    const h = Array.from(container.querySelectorAll('h2')).find((e) => e.textContent === 'Ghi chú')!;
    expect(h.className).toContain('max-md:font-ui');
    expect(container.textContent).toContain('Gọi trước khi giao');
  });

  it('khối xếp theo thứ tự của Mini App ở điện thoại: ... Sản phẩm, Thanh toán, Vận chuyển, Địa chỉ, Ghi chú, thao tác, hỗ trợ', async () => {
    mocks.order = shipping({ note: 'x', shippingPartner: 'GHN', shippingCode: 'GHN001' });
    const { container } = await mount();
    const col = container.querySelector('.max-md\\:flex-col')!;
    const orderOf = (el: Element) => Number(/max-md:order-(\d+)/.exec(el.className)?.[1] ?? 0);
    const find = (text: string) => Array.from(col.children).find((c) => c.textContent?.includes(text))!;
    expect(orderOf(find('Vận chuyển'))).toBeLessThan(orderOf(find('Địa chỉ giao hàng')));
    expect(orderOf(find('Địa chỉ giao hàng'))).toBeLessThan(orderOf(find('Ghi chú')));
    expect(orderOf(find('Ghi chú'))).toBeLessThan(orderOf(col.querySelector('.max-md\\:order-11')!));
  });

  it('đang tải: khung chờ thay chữ "Đang tải đơn hàng…"', async () => {
    mocks.order = () => new Promise(() => undefined);
    const { container } = await mount();
    expect(container.querySelector('[role="status"][aria-label="Đang tải đơn hàng"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Đang tải đơn hàng…');
  });

  it('không tìm thấy: tiêu đề vẫn là "Chi tiết đơn hàng", có lối về trang chủ, không nút Thử lại', async () => {
    mocks.order = new ApiError('x', 404);
    const { container } = await mount();
    expect(container.textContent).toContain('Chi tiết đơn hàng');
    expect(container.textContent).toContain('Không tìm thấy đơn hàng');
    expect(buttons(container).some((b) => b.textContent === 'Về trang chủ')).toBe(true);
    expect(buttons(container).some((b) => b.textContent === 'Thử lại')).toBe(false);
  });
});
