import { redactUrl } from './redact-url';

/**
 * URL request được in ra log (PrismaExceptionFilter). Webhook Gomdon cho phép đặt bí mật NGAY
 * TRONG URL (/webhooks/gomdon/<secret> hoặc ?token=<secret>) vì Gomdon chỉ cho nhập URL — log
 * nguyên URL là chép bí mật webhook vào log (xoay vòng, gửi đi aggregator, ai đọc log cũng giả
 * mạo được webhook trạng thái vận đơn).
 */
describe('redactUrl', () => {
  it('che token trong đường dẫn /webhooks/gomdon/<token> (có tiền tố /api)', () => {
    expect(redactUrl('/api/webhooks/gomdon/s3cr3t-abc')).toBe('/api/webhooks/gomdon/[REDACTED]');
  });

  it('che token đường dẫn kể cả khi có query và không có tiền tố /api', () => {
    expect(redactUrl('/webhooks/gomdon/s3cr3t?x=1')).toBe('/webhooks/gomdon/[REDACTED]?x=1');
  });

  it('giữ nguyên /webhooks/gomdon (không có token trong đường dẫn)', () => {
    expect(redactUrl('/api/webhooks/gomdon')).toBe('/api/webhooks/gomdon');
    expect(redactUrl('/api/webhooks/gomdon/')).toBe('/api/webhooks/gomdon/');
  });

  it('che query token/secret/signature (không phân biệt hoa thường), giữ tham số khác', () => {
    expect(redactUrl('/api/webhooks/gomdon?token=abc&page=2')).toBe('/api/webhooks/gomdon?token=[REDACTED]&page=2');
    expect(redactUrl('/api/x?Secret=abc&signature=def&keep=1')).toBe(
      '/api/x?Secret=[REDACTED]&signature=[REDACTED]&keep=1',
    );
  });

  it('che query bí mật ở MỌI webhook, vd Pancake nếu ops lỡ cấu hình ?token=', () => {
    expect(redactUrl('/api/webhooks/pancake?token=abc')).toBe('/api/webhooks/pancake?token=[REDACTED]');
  });

  it('không đụng URL thường', () => {
    expect(redactUrl('/api/orders/TUBU123?page=1')).toBe('/api/orders/TUBU123?page=1');
    expect(redactUrl('/api/webhooks/cashback/accesstrade')).toBe('/api/webhooks/cashback/accesstrade');
  });

  it('không vỡ với query mã hoá lỗi / tham số không có giá trị', () => {
    expect(redactUrl('/api/x?%E0%A4%A=1&token')).toBe('/api/x?%E0%A4%A=1&token');
    expect(redactUrl('/api/x?token=')).toBe('/api/x?token=[REDACTED]');
  });

  it('giữ fragment, che tên tham số đã percent-encode', () => {
    expect(redactUrl('/api/x?%74oken=abc#frag')).toBe('/api/x?%74oken=[REDACTED]#frag');
  });
});
