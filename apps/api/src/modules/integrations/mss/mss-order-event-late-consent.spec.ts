import { buyerOrderNotices, lateConsentBlock } from './mss-order-event-types';

const gate = { enabled: true, open: true, rolloutPct: 100 };
const order = {
  userId: 'u1',
  status: 'SHIPPING',
  type: 'RETAIL',
  platform: 'web' as string | null,
  placedForCustomer: false,
  orderZaloConsent: false as boolean | null,
  shippingAddress: { recipient: 'Bình', phone: '0901234567' } as unknown,
};
const user = { phone: '+84901234567', phoneVerifiedAt: new Date('2026-01-01T00:00:00Z') };

describe('lateConsentBlock (bật Zalo từ chi tiết đơn)', () => {
  it('đơn đủ điều kiện: không chặn (SĐT người nhận cùng số đã xác minh, khác cách viết)', () => {
    expect(lateConsentBlock({ gate, order, user })).toBeNull();
  });

  it('cổng MSS tắt, chưa mở hoặc ngoài tỉ lệ thử', () => {
    expect(lateConsentBlock({ gate: null, order, user })).toBe('gate_closed');
    expect(lateConsentBlock({ gate: { ...gate, enabled: false }, order, user })).toBe('gate_closed');
    expect(lateConsentBlock({ gate: { ...gate, open: false }, order, user })).toBe('gate_closed');
    expect(lateConsentBlock({ gate: { ...gate, rolloutPct: 0 }, order, user })).toBe('rollout');
  });

  it.each(['DELIVERED', 'CANCELLED', 'RETURNED'])('đơn %s đã kết thúc', (status) => {
    expect(lateConsentBlock({ gate, order: { ...order, status }, user })).toBe('not_active');
  });

  it.each(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'])('đơn %s còn nhận tin', (status) => {
    expect(lateConsentBlock({ gate, order: { ...order, status }, user })).toBeNull();
  });

  it('đã bật trước đó: báo "already" để endpoint trả thành công mà không ghi lại', () => {
    expect(lateConsentBlock({ gate, order: { ...order, orderZaloConsent: true }, user })).toBe('already');
  });

  it('cùng luật bỏ qua của bộ ghi sự kiện: nền tảng lạ, đặt hộ, đơn đại lý, SĐT chưa xác minh, đơn tặng người khác', () => {
    expect(lateConsentBlock({ gate, order: { ...order, platform: null }, user })).toBe('platform_null');
    expect(lateConsentBlock({ gate, order: { ...order, placedForCustomer: true }, user })).toBe('placed_for_customer');
    expect(lateConsentBlock({ gate, order: { ...order, type: 'DEALER' }, user })).toBe('dealer_order');
    expect(lateConsentBlock({ gate, order, user: { ...user, phoneVerifiedAt: null } })).toBe('no_verified_phone');
    expect(lateConsentBlock({ gate, order, user: { ...user, phone: null } })).toBe('no_verified_phone');
    expect(lateConsentBlock({ gate, order: { ...order, shippingAddress: { phone: '0911111111' } }, user })).toBe('gift_recipient');
    expect(lateConsentBlock({ gate, order: { ...order, shippingAddress: null }, user })).toBe('gift_recipient');
    expect(lateConsentBlock({ gate, order: { ...order, shippingAddress: ['0901234567'] }, user })).toBe('gift_recipient');
  });
});

describe('buyerOrderNotices (dòng "Đã báo qua Zalo" cho khách)', () => {
  const base = {
    eventType: 'order.shipping',
    status: 'PENDING',
    resultAt: null as Date | null,
    deliveredAt: null as Date | null,
    occurredAt: new Date('2026-11-18T06:00:00Z'),
    fallbackChannel: null as string | null,
    fallbackAt: null as Date | null,
  };

  it('RESULT_SENT là Zalo, giờ lấy theo mốc gửi tới khách', () => {
    const resultAt = new Date('2026-11-18T07:02:00Z');
    expect(buyerOrderNotices([{ ...base, status: 'RESULT_SENT', resultAt }])).toEqual([{ event: 'order.shipping', channel: 'ZALO', at: resultAt.toISOString() }]);
    const deliveredAt = new Date('2026-11-18T06:30:00Z');
    expect(buyerOrderNotices([{ ...base, status: 'RESULT_SENT', deliveredAt }])[0]!.at).toBe(deliveredAt.toISOString());
    expect(buyerOrderNotices([{ ...base, status: 'RESULT_SENT' }])[0]!.at).toBe(base.occurredAt.toISOString());
  });

  it('đường lui ZNS đã gửi là ZNS; đường lui chỉ trong app hoặc chưa gửi thì không có dòng', () => {
    const fallbackAt = new Date('2026-11-18T08:00:00Z');
    expect(buyerOrderNotices([{ ...base, status: 'RESULT_FAILED', fallbackChannel: 'ZNS', fallbackAt }])).toEqual([
      { event: 'order.shipping', channel: 'ZNS', at: fallbackAt.toISOString() },
    ]);
    expect(buyerOrderNotices([{ ...base, status: 'RESULT_FAILED', fallbackChannel: 'ZNS' }])).toEqual([]);
    expect(buyerOrderNotices([{ ...base, status: 'RESULT_FAILED', fallbackChannel: 'IN_APP_ONLY', fallbackAt }])).toEqual([]);
    expect(buyerOrderNotices([{ ...base, status: 'DELIVERED' }])).toEqual([]);
  });

  it('bỏ loại sự kiện lạ; chỉ có ba khoá event, channel, at', () => {
    const rows = [
      { ...base, eventType: 'order.unknown', status: 'RESULT_SENT' },
      { ...base, eventType: 'order.created', status: 'RESULT_SENT' },
    ];
    const out = buyerOrderNotices(rows);
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]!).sort()).toEqual(['at', 'channel', 'event']);
  });
});
