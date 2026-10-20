// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BankTransferPanel } from './bank-transfer-panel';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Mini App bank-payment.tsx sau phiên UAT lô 2 và lô 4 (bfd3918d, 9dcc431b, 9968242c, 4ee6b81d): QR chỉ hiện khi đơn còn chờ tiền,
// lỗi tải có lối ra, nút Kiểm tra phân biệt hết phiên với mất mạng.

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
  vi.useRealTimers();
});

const QR_BODY = {
  orderCode: 'TB-777',
  amount: 250000,
  paymentStatus: 'UNPAID',
  bank: { bin: '970407', name: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' },
  memo: 'TB-777',
  qrString: 'xxx',
  qrImageUrl: 'https://img.vietqr.io/image/x.png',
};
const order = { code: 'TB-777', paymentMethod: 'BANK_TRANSFER' } as const;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Lần gọi bank-qr thứ n trả `replies[n]` (lần cuối lặp lại); đường khác (cấu hình hỗ trợ) trả 500. */
function stubQr(replies: Array<() => Response>) {
  let n = 0;
  const fn = vi.fn(async (url: string) => {
    if (!url.includes('/payments/bank-qr/')) return json(500, { message: 'x' });
    const reply = replies[Math.min(n, replies.length - 1)]!;
    n += 1;
    return reply();
  });
  vi.stubGlobal('fetch', fn);
  return { qrCalls: () => fn.mock.calls.filter(([u]) => String(u).includes('/payments/bank-qr/')).length };
}
const ok = () => json(200, QR_BODY);
const err = (status: number, message: string) => () => json(status, { message });

describe('QR chỉ hiện khi đơn còn chờ chuyển khoản (bfd3918d)', () => {
  it.each([[400], [404], [409], [410], [422]])('máy chủ từ chối hẳn (%i) ngay lần tải đầu: khối "Đơn không còn chờ chuyển khoản" với lý do máy chủ, không QR', async (status) => {
    stubQr([err(status, 'Đơn đã huỷ.')]);
    const { container } = mount(<BankTransferPanel order={order} />);
    await flush(6);
    expect(container.textContent).toContain('Đơn không còn chờ chuyển khoản');
    expect(container.textContent).toContain('Đơn đã huỷ.');
    expect(container.querySelector('img[alt="VietQR"]')).toBeNull();
    expect(byText(container, 'button', 'Tôi đã chuyển khoản')).toBeNull();
  });

  it('đang xem QR thì đơn bị huỷ (dò nền trả 409): QR biến mất và dò nền dừng hẳn', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const q = stubQr([ok, err(409, 'Đơn đã huỷ.')]);
    const { container } = mount(<BankTransferPanel order={order} />);
    for (let i = 0; i < 6; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(container.querySelector('img[alt="VietQR"]')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    expect(container.textContent).toContain('Đơn không còn chờ chuyển khoản');
    expect(container.querySelector('img[alt="VietQR"]')).toBeNull();
    const before = q.qrCalls();
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(q.qrCalls()).toBe(before);
  });

  it.each([[401], [403], [408], [429], [500], [503]])('dò nền gặp %i (phiên đang khôi phục hoặc tạm thời): QR vẫn còn và vẫn dò tiếp', async (status) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const q = stubQr([ok, err(status, 'x')]);
    const { container } = mount(<BankTransferPanel order={order} />);
    for (let i = 0; i < 6; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    const before = q.qrCalls();
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    expect(container.querySelector('img[alt="VietQR"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Đơn không còn chờ chuyển khoản');
    expect(q.qrCalls()).toBeGreaterThan(before);
  });

  it('quá hạn chuyển khoản: khối đóng với câu hoàn tiền, không QR, không còn dòng "Đã quá hạn chuyển khoản" đỏ', async () => {
    stubQr([() => json(200, { ...QR_BODY, paymentDeadline: '2020-01-01T00:00:00.000Z' })]);
    const { container } = mount(<BankTransferPanel order={order} />);
    await flush(6);
    expect(container.textContent).toContain('Đơn không còn chờ chuyển khoản');
    expect(container.textContent).toContain('Đơn đã quá hạn chuyển khoản. Nếu bạn đã chuyển tiền, Tubu sẽ hoàn lại cho bạn.');
    expect(container.querySelector('img[alt="VietQR"]')).toBeNull();
    expect(container.querySelector('[data-testid="payment-countdown"]')).toBeNull();
  });

  it('đã PAID thì quá hạn không thay khung "Đã nhận thanh toán"', async () => {
    stubQr([() => json(200, { ...QR_BODY, paymentStatus: 'PAID', paymentDeadline: '2020-01-01T00:00:00.000Z' })]);
    const { container } = mount(<BankTransferPanel order={order} />);
    await flush(6);
    expect(container.textContent).toContain('Đã nhận thanh toán!');
    expect(container.textContent).not.toContain('Đơn không còn chờ chuyển khoản');
  });

  it('có lối xem đơn khi trang chứa truyền orderHref', async () => {
    stubQr([err(404, 'Không tìm thấy đơn.')]);
    const { container } = mount(<BankTransferPanel order={order} orderHref="/tai-khoan/don-hang/TB-777" />);
    await flush(6);
    expect(byText(container, 'a', 'Xem đơn hàng')?.getAttribute('href')).toBe('/tai-khoan/don-hang/TB-777');
  });
});

describe('lỗi tải có lối ra và hotline (9968242c)', () => {
  it('máy chủ lỗi: tiêu đề, câu hướng dẫn, Thử lại, Xem đơn hàng và hotline thay cho một dòng chữ trơn', async () => {
    stubQr([err(503, 'Máy chủ đang bận, thử lại nhé.')]);
    const { container } = mount(<BankTransferPanel order={order} orderHref="/tai-khoan/don-hang/TB-777" />);
    await flush(8);
    expect(container.textContent).toContain('Chưa tải được thông tin thanh toán');
    expect(container.textContent).toContain('Máy chủ đang bận, thử lại nhé.');
    expect(byText(container, 'button', 'Thử lại')).not.toBeNull();
    expect(byText(container, 'a', 'Xem đơn hàng')).not.toBeNull();
    expect(container.textContent).toContain('Cần hỗ trợ?');
    expect(container.querySelector('a[href="tel:0984606774"]')?.textContent).toContain('0984 606 774');
  });

  it('mất mạng: nói thẳng mất kết nối, không cùng câu với lỗi máy chủ', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/payments/bank-qr/')) throw new TypeError('Failed to fetch');
      return json(500, {});
    }));
    const { container } = mount(<BankTransferPanel order={order} />);
    await flush(8);
    expect(container.textContent).toContain('Chưa tải được thông tin thanh toán');
    expect(container.textContent).toContain('Mất kết nối');
  });

  it('Thử lại gọi lại máy chủ và hiện QR khi lần sau thành công', async () => {
    const q = stubQr([err(503, 'x'), ok]);
    const { container } = mount(<BankTransferPanel order={order} />);
    await flush(6);
    click(byText(container, 'button', 'Thử lại'));
    await flush(6);
    expect(q.qrCalls()).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('img[alt="VietQR"]')).not.toBeNull();
  });
});

describe('"Giữ nguyên nội dung" là khối lưu ý, không phải chữ đỏ (9968242c)', () => {
  it('nằm trong khối nền cảnh báo, không dùng màu báo lỗi', async () => {
    stubQr([ok]);
    const { container } = mount(<BankTransferPanel order={order} />);
    await flush(6);
    const note = container.querySelector<HTMLElement>('[data-testid="memo-note"]')!;
    expect(note.textContent).toContain('Giữ nguyên nội dung TB-777 để hệ thống tự xác nhận.');
    expect(note.className).toContain('bg-warning-bg');
    expect(note.innerHTML).not.toContain('danger');
    expect(note.querySelector('svg')).not.toBeNull();
  });
});

describe('nút Kiểm tra gặp 401/403 (9dcc431b, 9968242c, 4ee6b81d)', () => {
  const check = async (second: () => Response) => {
    stubQr([ok, second]);
    const { container } = mount(<BankTransferPanel order={order} />);
    await flush(6);
    click(byText(container, 'button', 'Tôi đã chuyển khoản'));
    await flush(8);
    return container;
  };

  it.each([[401, 'Unauthorized'], [403, 'Forbidden']])('%i chữ mặc định "%s": báo hết phiên và mời đăng nhập lại, không báo mất mạng, QR còn', async (status, text) => {
    const c = await check(err(status, text));
    const msg = c.querySelector('[data-testid="bank-check-result"]')?.textContent ?? '';
    expect(msg).toMatch(/phiên đăng nhập/i);
    expect(msg).toMatch(/đăng nhập lại/i);
    expect(msg).not.toMatch(/kết nối|mạng/i);
    expect(c.querySelector('img[alt="VietQR"]')).not.toBeNull();
  });

  it('401 kèm lý do cụ thể của máy chủ: hiện đúng lý do', async () => {
    const c = await check(err(401, 'Tài khoản đã bị khoá.'));
    expect(c.querySelector('[data-testid="bank-check-result"]')?.textContent).toBe('Tài khoản đã bị khoá.');
  });

  it('từ chối hẳn (404) ở lần bấm tay: hiện lý do máy chủ thay vì mất mạng', async () => {
    const c = await check(err(404, 'Không tìm thấy đơn.'));
    expect(c.textContent).toContain('Không tìm thấy đơn.');
    expect(c.textContent).not.toMatch(/Không kết nối được tới Tubu Tree/);
  });
});
