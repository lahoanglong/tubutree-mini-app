import { buyerOrderNotices, buyerPhoneOf, lateConsentBlock, MSS_CREATED_COVERS_PAYMENT_REMINDER_WHERE, outboxRecipientPhone, lateConsentOrderBlock, normalizeVnPhone, recipientPhoneFor, shippingPhoneOf } from './mss-order-event-types';

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

  it('cùng luật bỏ qua của bộ ghi sự kiện: nền tảng lạ, đặt hộ, đơn đại lý', () => {
    expect(lateConsentBlock({ gate, order: { ...order, platform: null }, user })).toBe('platform_null');
    expect(lateConsentBlock({ gate, order: { ...order, placedForCustomer: true }, user })).toBe('placed_for_customer');
    expect(lateConsentBlock({ gate, order: { ...order, type: 'DEALER' }, user })).toBe('dealer_order');
  });

  it('PO A2: số chưa xác minh, tài khoản chưa có số, đơn tặng, địa chỉ lạ đều bật được (người mua nhận tin ở số checkout_contact)', () => {
    expect(lateConsentBlock({ gate, order, user: { ...user, phoneVerifiedAt: null } })).toBeNull();
    expect(lateConsentBlock({ gate, order, user: { ...user, phone: null } })).toBeNull();
    expect(lateConsentBlock({ gate, order: { ...order, shippingAddress: { phone: '0911111111' } }, user })).toBeNull();
    expect(lateConsentBlock({ gate, order: { ...order, shippingAddress: null }, user })).toBeNull();
    expect(lateConsentBlock({ gate, order: { ...order, shippingAddress: ['0901234567'] }, user })).toBeNull();
  });

  it('không có số nào nhắn được (tài khoản, khách vãng lai, địa chỉ giao): no_phone', () => {
    const none = { phone: null, phoneVerifiedAt: null };
    expect(lateConsentBlock({ gate, order: { ...order, shippingAddress: null }, user: none })).toBe('no_phone');
    expect(lateConsentBlock({ gate, order: { ...order, shippingAddress: { phone: '12345' } }, user: { phone: 'abc', phoneVerifiedAt: null } })).toBe('no_phone');
    expect(lateConsentBlock({ gate, order: { ...order, shippingAddress: null, guestPhone: '0912345678' }, user: none })).toBeNull();
  });

  it('lateConsentOrderBlock: chỉ các lý do không cần người dùng; lateConsentBlock = nó ?? no_phone', () => {
    expect(lateConsentOrderBlock(gate, order)).toBeNull();
    expect(lateConsentOrderBlock(gate, { ...order, status: 'DELIVERED' })).toBe('not_active');
    expect(lateConsentOrderBlock(null, order)).toBe('gate_closed');
    expect(lateConsentBlock({ gate: null, order, user: { phone: null, phoneVerifiedAt: null } })).toBe('gate_closed');
  });
});

describe('buyerPhoneOf (PO A2) và recipientPhoneFor (PO A1)', () => {
  const verifiedAt = new Date('2026-01-01T00:00:00Z');

  it('số tài khoản đã xác minh: account_verified, kể cả khi địa chỉ giao số khác', () => {
    expect(buyerPhoneOf({ user: { phone: '+84901234567', phoneVerifiedAt: verifiedAt }, shippingAddress: { phone: '0987654321' } })).toEqual({ phone: '0901234567', source: 'account_verified', via: 'account' });
  });

  it('chưa xác minh: số đầu tiên đọc được của tài khoản, khách vãng lai, địa chỉ giao, nguồn checkout_contact', () => {
    const at = (user: { phone: string | null; phoneVerifiedAt: Date | null }, guestPhone: string | null, shippingAddress: unknown) => buyerPhoneOf({ user, guestPhone, shippingAddress });
    expect(at({ phone: '0901234567', phoneVerifiedAt: null }, '0912345678', { phone: '0987654321' })).toEqual({ phone: '0901234567', source: 'checkout_contact', via: 'account' });
    expect(at({ phone: null, phoneVerifiedAt: null }, '0912345678', { phone: '0987654321' })).toEqual({ phone: '0912345678', source: 'checkout_contact', via: 'guest' });
    expect(at({ phone: null, phoneVerifiedAt: null }, null, { phone: '0987 654 321' })).toEqual({ phone: '0987654321', source: 'checkout_contact', via: 'shipping' });
    // Đã xác minh mà số lưu hỏng: không tin cờ xác minh, đi tiếp các số khác.
    expect(at({ phone: '12345', phoneVerifiedAt: verifiedAt }, null, { phone: '0987654321' })).toEqual({ phone: '0987654321', source: 'checkout_contact', via: 'shipping' });
    expect(at({ phone: null, phoneVerifiedAt: null }, 'x', { phone: '0201234567' })).toBeNull();
    expect(at({ phone: null, phoneVerifiedAt: null }, null, null)).toBeNull();
  });

  it('recipientPhoneFor: chỉ khi khách đã bật và số nhận hàng đọc được, khác số người mua', () => {
    const gift = { notifyRecipientZalo: true, shippingAddress: { phone: '+84 987 654 321' } };
    expect(recipientPhoneFor(gift, '0901234567')).toBe('0987654321');
    expect(recipientPhoneFor({ ...gift, notifyRecipientZalo: false }, '0901234567')).toBeNull();
    expect(recipientPhoneFor(gift, '0987654321')).toBeNull();
    expect(recipientPhoneFor({ ...gift, shippingAddress: { phone: '12345' } }, '0901234567')).toBeNull();
    expect(recipientPhoneFor({ ...gift, shippingAddress: null }, '0901234567')).toBeNull();
    expect(shippingPhoneOf(['0901234567'])).toBeNull();
    expect(shippingPhoneOf({ phone: 901234567 })).toBeNull();
  });

  // Bảng chung với app-core (packages/app-core/src/order-zalo.spec.ts): client chỉ hiện ô người nhận khi máy chủ cũng ghi được dòng người nhận.
  it.each([
    ['0901234567', '0901234567'],
    ['+84901234567', '0901234567'],
    ['84901234567', '0901234567'],
    ['090 123 4567', '0901234567'],
    ['090.123.4567', '0901234567'],
    ['(090) 123-4567', '0901234567'],
    ['0201234567', null],
    ['090123456', null],
    ['12345', null],
    ['', null],
  ])('normalizeVnPhone(%j) = %j (bảng chung với app-core)', (raw, want) => {
    expect(normalizeVnPhone(raw)).toBe(want);
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

describe('outboxRecipientPhone (MINOR 2: số người mua lúc đặt đọc từ thân dòng outbox)', () => {
  it('đọc và chuẩn hoá recipient.phone; thân hỏng hoặc thiếu số → null', () => {
    expect(outboxRecipientPhone(JSON.stringify({ recipient: { phone: '+84987654321', phone_source: 'checkout_contact' } }))).toBe('0987654321');
    expect(outboxRecipientPhone(JSON.stringify({ recipient: { phone: '0987654321' } }))).toBe('0987654321');
    expect(outboxRecipientPhone('{')).toBeNull();
    expect(outboxRecipientPhone('null')).toBeNull();
    expect(outboxRecipientPhone(JSON.stringify({ recipient: null }))).toBeNull();
    expect(outboxRecipientPhone(JSON.stringify({ recipient: { phone: 987654321 } }))).toBeNull();
    expect(outboxRecipientPhone(JSON.stringify({ recipient: { phone: '12345' } }))).toBeNull();
    expect(outboxRecipientPhone(JSON.stringify([{ recipient: { phone: '0987654321' } }]))).toBeNull();
  });
});

describe('MSS_CREATED_COVERS_PAYMENT_REMINDER_WHERE (GAP-1 w39-01)', () => {
  it('chỉ dòng order.created của chính người mua; người lạ (resultReason khác null) không tính', () => {
    expect(MSS_CREATED_COVERS_PAYMENT_REMINDER_WHERE).toEqual({
      eventType: 'order.created',
      recipientRole: 'buyer',
      OR: [{ status: { in: ['PENDING', 'SENDING', 'DELIVERED'] } }, { status: 'RESULT_SENT', resultReason: null }],
    });
  });
});
