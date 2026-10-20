// @vitest-environment jsdom
import { act } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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
  it('BUYERMINI-8 (web): hiện hạn chuyển khoản giờ VN để khách biết đơn tự huỷ khi nào', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-13T00:00:00Z'), toFake: ['Date'] });
    const api = mockFetch({ '/payments/bank-qr/': { body: { ...QR_BODY, paymentDeadline: '2026-10-14T03:00:00.000Z' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    vi.useRealTimers();
    expect(container.querySelector('[role="note"]')?.textContent).toBe('Chuyển khoản trước 10:00 14/10/2026 — quá hạn đơn sẽ tự huỷ.');
  });

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

  it('có nút "Tôi đã chuyển khoản — Kiểm tra" — bấm thì gọi lại API kiểm tra trạng thái', async () => {
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

  // PC-7: khung xác nhận tiền là kết quả khách đã thấy; một lần dò lại lỗi (mất mạng, đơn sau đó bị hủy nên API từ chối QR)
  // không được thay nó bằng "Không tải được thông tin thanh toán".
  it('đã PAID rồi dò lại bị lỗi (quay lại tab): vẫn giữ khung "Đã nhận thanh toán", không đổi sang báo lỗi', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ ...QR_BODY, paymentStatus: 'PAID' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ message: 'Đơn đã hủy/trả, không thể thanh toán.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    expect(container.textContent).toContain('Đã nhận thanh toán');

    window.dispatchEvent(new Event('visibilitychange'));
    await flush(8);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain('Đã nhận thanh toán');
    expect(container.textContent).not.toMatch(/không tải được/i);
  });

  // D5-03: thăm dò nền mỗi 4s bật isFetching; trước đây nút "Tôi đã chuyển" khoá/nhấp nháy theo nhịp đó đúng lúc khách bấm.
  it('thăm dò nền đang chạy: nút "Tôi đã chuyển" vẫn bấm được, trạng thái kiểm tra hiện ở dòng riêng', async () => {
    let release: () => void = () => {};
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls >= 2) await new Promise<void>((r) => (release = r));
        return new Response(JSON.stringify(QR_BODY), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    const btn = () => byText(container, 'button', 'Tôi đã chuyển khoản') as HTMLButtonElement;
    expect(btn().disabled).toBe(false);

    window.dispatchEvent(new Event('visibilitychange'));
    await flush(2);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(btn().disabled).toBe(false);
    expect(btn().textContent).toBe('Tôi đã chuyển khoản — Kiểm tra');
    expect(container.querySelector('[data-testid="bank-poll-status"]')?.textContent).toContain('Đang kiểm tra');

    release();
    await flush();
    expect(container.querySelector('[data-testid="bank-poll-status"]')?.textContent).toContain('Đang chờ thanh toán');
  });

  it('bấm kiểm tra tay: nút khoá + "Đang kiểm tra…" trong lúc chờ, xong báo "chưa thấy tiền về" và mở lại nút', async () => {
    let release: () => void = () => {};
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls >= 2) await new Promise<void>((r) => (release = r));
        return new Response(JSON.stringify(QR_BODY), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    const btn = () => byText(container, 'button', /Tôi đã chuyển khoản|Đang kiểm tra/) as HTMLButtonElement;
    click(btn());
    await flush(2);
    expect(btn().disabled).toBe(true);
    expect(btn().textContent).toBe('Đang kiểm tra…');

    release();
    await flush();
    expect(btn().disabled).toBe(false);
    expect(container.querySelector('[data-testid="bank-check-result"]')?.textContent).toContain('Chưa thấy tiền về');
  });

  it('kiểm tra tay gặp lỗi mạng: giữ nguyên khung QR, báo lỗi ngay dưới nút và cho bấm lại', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls >= 2) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify(QR_BODY), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    click(byText(container, 'button', 'Tôi đã chuyển khoản'));
    await flush(6);
    expect(container.querySelector('img[alt="VietQR"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bank-check-result"]')?.textContent).toMatch(/không kết nối|kiểm tra mạng/i);
    expect((byText(container, 'button', 'Tôi đã chuyển khoản') as HTMLButtonElement).disabled).toBe(false);
  });

  it('có nút "Lưu mã QR": tải ảnh về tên theo mã đơn', async () => {
    const created = vi.fn(() => 'blob:qr');
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    const clicked: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
    const fetchFn = vi.fn(async (url: string) => {
      if (url === QR_BODY.qrImageUrl) return { ok: true, blob: async () => new Blob(['png'], { type: 'image/png' }) } as unknown as Response;
      return new Response(JSON.stringify(QR_BODY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchFn);
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    click(byText(container, 'button', 'Lưu mã QR'));
    await flush();
    expect(clicked).toEqual([{ download: 'tubu-qr-TB-777.png', href: 'blob:qr' }]);
    expect(container.querySelector('[data-testid="bank-qr-saved"]')?.textContent).toContain('Đã lưu');
  });

  it('"Lưu mã QR" không tải được (chặn CORS): không mở tab, báo chưa lưu và dặn nhấn giữ ảnh hoặc chụp màn hình', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchFn = vi.fn(async (url: string) => {
      if (url === QR_BODY.qrImageUrl) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(QR_BODY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchFn);
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    click(byText(container, 'button', 'Lưu mã QR'));
    await flush();
    expect(open).not.toHaveBeenCalled();
    const msg = container.querySelector('[data-testid="bank-qr-saved"]')?.textContent ?? '';
    expect(msg).toContain('Chưa lưu được');
    expect(msg).toMatch(/nhấn giữ/i);
    expect(msg).not.toContain('tab mới');
  });

  it('lỗi tải API → hiện thông báo lỗi + nút Thử lại (không crash)', async () => {
    const api = mockFetch({ '/payments/bank-qr/': { status: 500, body: { message: 'lỗi' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    expect(container.textContent).toContain('Chưa tải được thông tin thanh toán');
    expect(byText(container, 'button', 'Thử lại')).not.toBeNull();
  });
  it('mỗi dòng cần chép có nút riêng: số tài khoản, số tiền (chữ số thuần), nội dung chuyển khoản', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const api = mockFetch({ '/payments/bank-qr/': { body: QR_BODY } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining(['Sao chép: 9984606774', 'Sao chép: 250000', 'Sao chép: TB-777']));
    click(container.querySelector('button[aria-label="Sao chép: 250000"]'));
    await flush();
    expect(writeText).toHaveBeenCalledWith('250000');
  });

  describe('đếm ngược hạn chuyển khoản (D5-02)', () => {
    beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-17T10:00:00Z'), toFake: ['Date'] }));
    afterEach(() => vi.useRealTimers());

    const withDeadline = async (paymentDeadline?: string) => {
      const api = mockFetch({ '/payments/bank-qr/': { body: { ...QR_BODY, ...(paymentDeadline ? { paymentDeadline } : {}) } } });
      vi.stubGlobal('fetch', vi.fn(api.fn));
      const { container } = mount(<BankTransferPanel order={order()} />);
      await flush();
      return container;
    };

    it('còn hạn: thêm dòng "Còn 2 giờ 30 phút để chuyển khoản", không nằm trong vùng đọc tự động', async () => {
      const c = await withDeadline('2026-10-17T12:30:00Z');
      const el = c.querySelector('[data-testid="payment-countdown"]');
      expect(el?.textContent).toBe('Còn 2 giờ 30 phút để chuyển khoản');
      expect(el?.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    });

    it('quá hạn: khối "Đơn không còn chờ chuyển khoản", không còn QR hay đồng hồ', async () => {
      const c = await withDeadline('2026-10-17T09:00:00Z');
      expect(c.textContent).toContain('Đơn không còn chờ chuyển khoản');
      expect(c.querySelector('[data-testid="payment-countdown"]')).toBeNull();
    });

    it('API không trả hạn: không có đồng hồ', async () => {
      const c = await withDeadline();
      expect(c.querySelector('[data-testid="payment-countdown"]')).toBeNull();
    });
  });

  it('dò nền dừng hẳn sau khi thấy PAID: 4 giây sau không gọi thêm', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      const api = mockFetch({ '/payments/bank-qr/': { body: { ...QR_BODY, paymentStatus: 'PAID' } } });
      vi.stubGlobal('fetch', vi.fn(api.fn));
      mount(<BankTransferPanel order={order()} />);
      for (let i = 0; i < 6; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      const before = api.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
      expect(api.calls.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('chưa PAID: cứ 4 giây dò một lần', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      const api = mockFetch({ '/payments/bank-qr/': { body: QR_BODY } });
      vi.stubGlobal('fetch', vi.fn(api.fn));
      mount(<BankTransferPanel order={order()} />);
      for (let i = 0; i < 6; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      const before = api.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
      expect(api.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('kiểm tra tay thấy FAILED/REFUNDED: báo giao dịch không thành công, dặn liên hệ hỗ trợ', async () => {
    let status = 'UNPAID';
    const api = mockFetch({ '/payments/bank-qr/': () => ({ body: { ...QR_BODY, paymentStatus: status } }) });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<BankTransferPanel order={order()} />);
    await flush();
    status = 'REFUNDED';
    click(byText(container, 'button', 'Tôi đã chuyển khoản'));
    await flush();
    expect(container.querySelector('[data-testid="bank-check-result"]')?.textContent).toBe(
      'Giao dịch không thành công hoặc đã được hoàn lại. Vui lòng liên hệ bộ phận hỗ trợ.',
    );
  });

  it('PAID có thể kèm lối đi tiếp (paidFooter) do trang chứa cung cấp', async () => {
    const api = mockFetch({ '/payments/bank-qr/': { body: { ...QR_BODY, paymentStatus: 'PAID' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<BankTransferPanel order={order()} paidFooter={<a href="/x">Xem đơn hàng</a>} />);
    await flush();
    expect(container.querySelector('a[href="/x"]')?.textContent).toBe('Xem đơn hàng');
  });
});
