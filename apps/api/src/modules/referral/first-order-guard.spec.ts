import { addressKey, firstOrderBlockReason, vnMonthStart, type FirstOrderFraudInput } from './first-order-guard';

const at = new Date('2026-11-19T10:00:00.000Z');
const addr = (over: Record<string, unknown> = {}) => ({ phone: '0901111111', street: '12 Lê Lợi', ward: 'Phường Bến Nghé', wardCode: '26734', district: 'Quận 1', province: 'TP.HCM', ...over });

function input(over: { referrer?: Partial<FirstOrderFraudInput['referrer']>; referee?: Partial<FirstOrderFraudInput['referee']>; order?: Partial<FirstOrderFraudInput['order']> } = {}): FirstOrderFraudInput {
  return {
    referrer: { id: 'r1', phone: '0901111111', zaloIds: ['zalo-r'], addresses: [addr()], orders: [{ createdAt: at, shippingAddress: addr(), ipHashes: ['ip-r', null] }], ...over.referrer },
    referee: { id: 'f1', phone: '0902222222', zaloIds: ['zalo-f'], guestPhone: null, ...over.referee },
    order: { createdAt: at, shippingAddress: addr({ phone: '0902222222', street: '99 Hai Bà Trưng', wardCode: '26737' }), ipHashes: ['ip-f', null], ...over.order },
  };
}

describe('firstOrderBlockReason', () => {
  it('cặp sạch thì không chặn', () => {
    expect(firstOrderBlockReason(input())).toBeNull();
  });

  it('cùng một người', () => {
    expect(firstOrderBlockReason(input({ referee: { id: 'r1' } }))).toBe('SELF');
  });

  it('SĐT bạn được mời trùng SĐT người mời, kể cả dạng +84', () => {
    expect(firstOrderBlockReason(input({ referee: { phone: '+84901111111' } }))).toBe('PHONE');
  });

  it('đơn đầu giao tới SĐT trong sổ địa chỉ người mời', () => {
    const order = { shippingAddress: addr({ phone: '0903333333', street: '1 Nguyễn Huệ', wardCode: '1' }) };
    expect(firstOrderBlockReason(input({ order, referrer: { addresses: [addr(), addr({ phone: '0903333333' })] } }))).toBe('PHONE');
  });

  it('SĐT gõ ở đơn web vãng lai trùng người mời', () => {
    expect(firstOrderBlockReason(input({ referee: { guestPhone: '0901 111 111' } }))).toBe('PHONE');
  });

  it('trùng Zalo (kể cả phiên khách đã gộp)', () => {
    expect(firstOrderBlockReason(input({ referee: { zaloIds: ['zalo-f', 'zalo-r'] } }))).toBe('ZALO');
    // Cùng một máy, hai phiên khách đã gộp vào hai tài khoản: auth.service đổi zaloId thành `<khoá>_merged_<giờ>`.
    expect(
      firstOrderBlockReason(input({ referrer: { zaloIds: ['zalo-r', 'guest_D_merged_1700000000000'] }, referee: { zaloIds: ['zalo-f', 'guest_D_merged_1800000000000'] } })),
    ).toBe('ZALO');
  });

  it('đơn đầu giao tới địa chỉ người mời (khác dấu, khác cách viết)', () => {
    const order = { shippingAddress: addr({ phone: '0902222222', street: '12 le loi' }) };
    expect(firstOrderBlockReason(input({ order }))).toBe('ADDRESS');
  });

  it('địa chỉ trùng một đơn cũ của người mời (không có trong sổ)', () => {
    const shipped = addr({ phone: '0909999999', street: '7 Pasteur', wardCode: '500' });
    const order = { shippingAddress: { ...shipped, phone: '0902222222' } };
    const referrer = { addresses: [], orders: [{ createdAt: new Date('2026-01-01T00:00:00Z'), shippingAddress: shipped, ipHashes: [] }] };
    expect(firstOrderBlockReason(input({ order, referrer }))).toBe('ADDRESS');
  });

  it('cùng IP trong 24 giờ thì chặn, ngoài 24 giờ thì không', () => {
    const near = { orders: [{ createdAt: new Date(at.getTime() - 23 * 3600_000), shippingAddress: null, ipHashes: [null, 'ip-f'] }] };
    expect(firstOrderBlockReason(input({ referrer: near }))).toBe('IP');
    const far = { orders: [{ createdAt: new Date(at.getTime() - 25 * 3600_000), shippingAddress: null, ipHashes: ['ip-f'] }] };
    expect(firstOrderBlockReason(input({ referrer: far }))).toBeNull();
  });

  it('không có IP hay địa chỉ thì không so rỗng với rỗng', () => {
    const referrer = { addresses: [{ phone: null, street: '', ward: '' }], orders: [{ createdAt: at, shippingAddress: {}, ipHashes: [null, ''] }] };
    expect(firstOrderBlockReason(input({ referrer, order: { shippingAddress: {}, ipHashes: [null, ''] } }))).toBeNull();
  });
});

describe('addressKey', () => {
  it('gấp dấu và ký tự; thiếu phường hoặc số nhà thì null', () => {
    expect(addressKey(addr())).toBe(addressKey(addr({ street: '12, LE LOI.' })));
    expect(addressKey(addr({ wardCode: '' }))).toBe('phuongbennghe|quan1|tphcm#12leloi');
    expect(addressKey(addr({ street: ' ' }))).toBeNull();
    expect(addressKey(addr({ wardCode: '', ward: '', district: '', province: '' }))).toBeNull();
    expect(addressKey(null)).toBeNull();
  });
});

describe('vnMonthStart', () => {
  it('đầu tháng theo giờ Việt Nam', () => {
    expect(vnMonthStart(new Date('2026-11-19T10:00:00Z')).toISOString()).toBe('2026-10-31T17:00:00.000Z');
    // 30/11 18:00 UTC đã là 01/12 01:00 giờ Việt Nam.
    expect(vnMonthStart(new Date('2026-11-30T18:00:00Z')).toISOString()).toBe('2026-11-30T17:00:00.000Z');
  });
});
