import { orderConfirmedData, PAYMENT_RECEIVED_NOTE } from './order-confirmed-data';
import { TEMPLATE_VARIABLES } from './notification-variables';

// Cùng phép thay với NotificationsService.render.
const render = (tpl: string, data: Record<string, string>) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => data[k] ?? '');
const BODY = 'Đơn {{order_code}} đã được xác nhận.{{payment_note}} Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿';

describe('orderConfirmedData', () => {
  it('đơn đã thanh toán: thêm câu đã nhận đủ thanh toán', () => {
    const body = render(BODY, orderConfirmedData({ code: 'TUBU1', paymentStatus: 'PAID' }));
    expect(body).toBe('Đơn TUBU1 đã được xác nhận. Tubu Tree đã nhận đủ thanh toán. Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿');
  });

  it('đơn COD (chưa thanh toán): giữ chữ cũ, không thừa khoảng trắng hay dấu chấm', () => {
    const body = render(BODY, orderConfirmedData({ code: 'TUBU2', paymentStatus: 'UNPAID' }));
    expect(body).toBe('Đơn TUBU2 đã được xác nhận. Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿');
    expect(body).not.toMatch(/ {2}|\.\./);
  });

  it('chỉ PAID mới có câu; mọi trạng thái khác để trống', () => {
    for (const st of ['UNPAID', 'REFUNDED', 'FAILED', 'PARTIALLY_PAID']) {
      expect(orderConfirmedData({ code: 'X', paymentStatus: st })).toEqual({ order_code: 'X' });
    }
    expect(orderConfirmedData({ code: 'X', paymentStatus: 'PAID' }).payment_note).toBe(PAYMENT_RECEIVED_NOTE);
  });

  it('payment_note được khai là biến hợp lệ của ORDER_CONFIRMED', () => {
    expect(TEMPLATE_VARIABLES.ORDER_CONFIRMED).toContain('payment_note');
  });
});
