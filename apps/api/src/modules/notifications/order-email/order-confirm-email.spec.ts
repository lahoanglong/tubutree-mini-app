import { buildOrderConfirmEmail, maskEmail, ORDER_EMAIL_LINES_MAX, type OrderConfirmEmailInput } from './order-confirm-email';
import { orderEmailRecipient } from './order-confirm-email.service';

const BASE: OrderConfirmEmailInput = {
  code: 'TB8495',
  eventType: 'order.created',
  items: [
    { name: 'Nước giặt Fuwa3e 2L', variant: 'Can', quantity: 2, gift: false },
    { name: 'Túi vải', variant: null, quantity: 1, gift: true },
  ],
  totalVnd: 1_250_000,
  paymentMethod: 'COD',
  paid: false,
  link: 'https://tubutree.com/tai-khoan/don-hang/TB8495',
  zaloPhone: '0899149229',
};

describe('E6 buildOrderConfirmEmail', () => {
  it('tài khoản: tiêu đề, mã, món, tổng, cách trả, link, lời mời kết bạn Zalo; chân thư tự động', () => {
    const m = buildOrderConfirmEmail(BASE);
    expect(m.subject).toBe('Tubu Tree xác nhận đơn TB8495');
    for (const part of [
      'Tubu Tree đã nhận đơn TB8495 của bạn.',
      '- Nước giặt Fuwa3e 2L (Can) × 2',
      '- Túi vải × 1 (quà tặng)',
      'Tổng: 1.250.000₫',
      'Thanh toán: Thanh toán khi nhận hàng (COD)',
      'Xem đơn: https://tubutree.com/tai-khoan/don-hang/TB8495',
      'Kết bạn Zalo Tubu Tree (0899149229) để nhận Bill & theo dõi đơn miễn phí: https://zalo.me/0899149229',
      'Email tự động từ Tubu Tree, không cần trả lời.',
    ]) {
      expect(m.text).toContain(part);
    }
    expect(m.html).toContain('href="https://tubutree.com/tai-khoan/don-hang/TB8495"');
    expect(m.html).toContain('href="https://zalo.me/0899149229"');
    expect(m.html).toContain('Kết bạn Zalo Tubu Tree (0899149229)');
    expect(m.html).toContain('1.250.000₫');
  });

  it('khách vãng lai: link /don/<mã>#k= nguyên văn, ký tự & trong HTML được thoát', () => {
    const link = 'https://tubutree.com/don/TB8495#k=abc.def_123';
    const m = buildOrderConfirmEmail({ ...BASE, link });
    expect(m.text).toContain(`Xem đơn: ${link}`);
    expect(m.html).toContain(`href="${link}"`);
    expect(m.html).toContain('Bill &amp; theo dõi');
  });

  it('không có link: chỉ dẫn vào Đơn của tôi', () => {
    const m = buildOrderConfirmEmail({ ...BASE, link: null });
    expect(m.text).toContain('Xem đơn ở mục Đơn của tôi trong Tubu Tree.');
    expect(m.html).not.toContain('tai-khoan/don-hang');
  });

  it('đã thanh toán: câu đã nhận đủ tiền; chuyển khoản chưa trả: nhắc chờ chuyển khoản', () => {
    expect(buildOrderConfirmEmail({ ...BASE, eventType: 'order.payment_confirmed', paid: true, paymentMethod: 'BANK_TRANSFER' }).text).toContain(
      'Tubu Tree đã nhận đủ thanh toán cho đơn TB8495.',
    );
    const waiting = buildOrderConfirmEmail({ ...BASE, paymentMethod: 'BANK_TRANSFER' }).text;
    expect(waiting).toContain('Đơn đang chờ bạn chuyển khoản.');
    expect(waiting).toContain('Thanh toán: Chuyển khoản');
  });

  it(`quá ${ORDER_EMAIL_LINES_MAX} món: ${ORDER_EMAIL_LINES_MAX} dòng rồi "và N sản phẩm khác"`, () => {
    const items = Array.from({ length: 13 }, (_, i) => ({ name: `Món ${i + 1}`, variant: null, quantity: 1, gift: false }));
    const m = buildOrderConfirmEmail({ ...BASE, items });
    expect(m.text).toContain('- Món 10 × 1');
    expect(m.text).not.toContain('Món 11');
    expect(m.text).toContain('- và 3 sản phẩm khác');
    expect(m.html.match(/<li /g)).toHaveLength(11);
  });

  it('không pixel theo dõi, không SĐT ngoài số Zalo Tubu Tree, tên món có thẻ HTML bị thoát', () => {
    const m = buildOrderConfirmEmail({ ...BASE, items: [{ name: '<img src=x onerror=alert(1)>', variant: null, quantity: 1, gift: false }] });
    expect(m.html).not.toContain('<img');
    expect(m.html).toContain('&lt;img');
    expect(m.text.replace(/0899149229/g, '')).not.toMatch(/0\d{9}/);
  });
});

describe('orderEmailRecipient + maskEmail', () => {
  it('email tài khoản trước, không có thì email hoá đơn VAT; chuỗi nhiều địa chỉ hay sai dạng bị bỏ', () => {
    expect(orderEmailRecipient('lan@example.com', { email: 'vat@example.com' })).toBe('lan@example.com');
    expect(orderEmailRecipient(null, { email: 'vat@example.com', taxCode: '0101' })).toBe('vat@example.com');
    expect(orderEmailRecipient('   ', { email: 'vat@example.com' })).toBe('vat@example.com');
    expect(orderEmailRecipient('a@x.com, b@x.com', null)).toBeNull();
    expect(orderEmailRecipient('không phải email', { email: 'sai' })).toBeNull();
    expect(orderEmailRecipient(null, null)).toBeNull();
    expect(orderEmailRecipient(null, ['x@y.com'])).toBeNull();
  });

  it('che phần tên, giữ tên miền', () => {
    expect(maskEmail('lan.nguyen@example.com')).toBe('la•••@example.com');
    expect(maskEmail('a@b.vn')).toBe('a•••@b.vn');
    expect(maskEmail('khong-co-a-cong')).toBe('•••');
  });
});
