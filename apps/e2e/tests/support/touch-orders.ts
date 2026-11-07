import { makeOrder, type MockApi } from './mock-api';
import { mockBuyFlowSession, mockOrdersTab, THUMB } from './buy-flow-mocks';

/** Bốn đơn đủ bốn kiểu thẻ ở Đơn hàng của Mini App: đã giao (có "Mua lại"), chờ chuyển khoản (có "Thanh toán ngay" + hạn), đang giao, đã huỷ. */
export const SHIPPING_CODE = 'TUBU-W39A-S';

const DELIVERED = makeOrder({ code: 'TUBU-W39A-D', status: 'DELIVERED', paymentStatus: 'PAID', total: 1_249_000 });
const PENDING_PAY = {
  ...makeOrder({ code: 'TUBU-W39A-P', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 349_000 }),
  paymentDeadline: new Date(Date.now() + 3 * 3600_000).toISOString(),
};
const SHIPPING = makeOrder({ code: SHIPPING_CODE, status: 'SHIPPING', total: 89_000 });
const CANCELLED = makeOrder({ code: 'TUBU-W39A-C', status: 'CANCELLED', total: 19_000 });

export function mockOrdersList(api: MockApi): void {
  mockBuyFlowSession(api);
  mockOrdersTab(api);
  const withThumb = <T extends { items: object[] }>(o: T): T => ({ ...o, items: o.items.map((i) => ({ ...i, thumbnail: THUMB })) });
  const all = [DELIVERED, PENDING_PAY, SHIPPING, CANCELLED].map(withThumb);
  api.get('/orders', { data: all, meta: { page: 1, limit: 20, total: all.length } });
}
