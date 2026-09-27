// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BankTransferPanel } from './bank-transfer-panel';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import type { OrderDTO } from '@/lib/shop-client';

// A2-02 = A6-01 (docs/audit-2026-09): web /thanh-toan cho chọn "Chuyển khoản ngân hàng" nhưng
// trước đây sau khi đặt đơn KHÔNG BAO GIỜ hiện QR/STK/nội dung CK ở đâu cả — khách không có cách
// nào trả tiền cho đơn đã đặt. BankTransferPanel là khối hiện đầy đủ thông tin đó ngay trên màn
// thành công, mirror apps/miniapp/src/pages/bank-payment.tsx (cùng contract GET /payments/bank-qr/:code).

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const order = (over: Partial<OrderDTO> = {}): OrderDTO => ({
  code: 'TB-777',
  status: 'PENDING_PAYMENT',
  subtotal: 250000,
  discount: 0,
  shippingFee: 0,
  total: 250000,
  paymentMethod: 'BANK_TRANSFER',
  paymentStatus: 'UNPAID',
  createdAt: '2026-09-27T00:00:00.000Z',
  items: [],
  ...over,
});

const QR_BODY = {
  orderCode: 'TB-777',
  amount: 250000,
  paymentStatus: 'UNPAID',
  bank: { bin: '970407', name: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' },
  memo: 'TB-777',
  qrString: 'xxx-vietqr-string',
  qrImageUrl: 'https://img.vietqr.io/image/970407-9984606774-compact2.png?amount=250000',
};

describe('BankTransferPanel — thanh toán chuyển khoản sau khi đặt đơn (A2-02=A6-01)', () => {
  it('đơn BANK_TRANSFER → gọi GET /payments/bank-qr/:code và hiện QR, ngân hàng, STK, chủ TK, số tiền, nội dung CK', async () => {
    const api = mockFetch({ '/payments/bank-qr/': { body: QR_BODY } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();

    expect(api.calls.some((c) => c.url.includes('/payments/bank-qr/TB-777'))).toBe(true);
    expect(container.textContent).toContain('Techcombank');
    expect(container.textContent).toContain('9984606774');
    expect(container.textContent).toContain('CONG TY TUBU TREE');
    expect(container.textContent).toContain('250.000đ');
    expect(container.textContent).toContain('TB-777');
    const img = container.querySelector('img[alt="VietQR"]') as HTMLImageElement | null;
    expect(img?.src).toBe(QR_BODY.qrImageUrl);
  });

  it.each(['COD', 'WALLET', 'XU', 'ZALOPAY'])(
    'đơn thanh toán %s → không render gì và KHÔNG gọi API bank-qr',
    async (method) => {
      const api = mockFetch({ '/payments/bank-qr/': { body: QR_BODY } });
      vi.stubGlobal('fetch', vi.fn(api.fn));
      const { container } = mount(<BankTransferPanel order={order({ paymentMethod: method })} />);
      await flush();
      expect(container.textContent).toBe('');
      expect(api.calls).toHaveLength(0);
    },
  );

  it('có nút "Tôi đã chuyển khoản, kiểm tra lại" — bấm thì gọi lại API kiểm tra trạng thái', async () => {
    const api = mockFetch({ '/payments/bank-qr/': { body: QR_BODY } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    const before = api.calls.length;
    const btn = byText(container, 'button', 'Tôi đã chuyển khoản');
    expect(btn).not.toBeNull();
    click(btn);
    await flush();
    expect(api.calls.length).toBeGreaterThan(before);
  });

  it('paymentStatus=PAID → hiện xác nhận đã nhận thanh toán, không hiện QR nữa', async () => {
    const api = mockFetch({ '/payments/bank-qr/': { body: { ...QR_BODY, paymentStatus: 'PAID' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    expect(container.textContent).toContain('Đã nhận thanh toán');
    expect(container.querySelector('img[alt="VietQR"]')).toBeNull();
  });

  it('lỗi tải API → hiện thông báo lỗi + nút Thử lại (không crash)', async () => {
    const api = mockFetch({ '/payments/bank-qr/': { status: 500, body: { message: 'lỗi' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    expect(container.textContent).toMatch(/không tải được|thử lại/i);
  });
});
