import type { CheckoutState } from './checkout-states';
import { CHECKOUT_QUOTE, placedOrderFor } from './checkout-mocks';
import { reply } from './mock-api';

/** Tổng mới sau khi giá ưu đãi đổi (rẻ hơn 5.000đ so với báo giá ban đầu). */
export const NEW_TOTAL = CHECKOUT_QUOTE.total - 5000;

/** Thế giới thường, không thao tác thêm: các spec luồng tự thao tác. */
export const FLOW_PLAIN: CheckoutState = { key: 'flow-plain', name: 'Luồng thường', ready: () => undefined };

/** Lần đặt đầu máy chủ trả PRICE_CHANGED, đồng thời báo giá chuyển sang tổng mới; lần sau đặt được. */
export const FLOW_PRICE_CHANGED: CheckoutState = {
  key: 'flow-price-changed',
  name: 'Giá đổi rồi nhận giá mới',
  ready: () => undefined,
  routes: (api) => {
    let changed = false;
    api.post('/checkout/quote', () => (changed ? { ...CHECKOUT_QUOTE, total: NEW_TOTAL } : CHECKOUT_QUOTE));
    api.post('/checkout/place-order', ({ call }) => {
      if (!changed) {
        changed = true;
        return reply(400, { statusCode: 400, message: 'PRICE_CHANGED' });
      }
      return placedOrderFor((call.body ?? {}) as Record<string, unknown>);
    });
  },
};
