import {
  buildAdminOrderWhere,
  normalizeAdminOrderSearch,
  ORDER_KINDS,
  pancakeUnsyncedWhere,
  recipientPhoneVariants,
  searchPhone,
} from './admin-order-filter';

describe('searchPhone — SĐT gõ/dán ở ô tìm về dạng 0xxxxxxxxx', () => {
  it.each([
    ['0911222333', '0911222333'],
    ['+84 911 222 333', '0911222333'],
    ['84911222333', '0911222333'],
    ['+840911222333', '0911222333'],
    ['0911.222.333', '0911222333'],
    // R4-ADMIN-4: chép từ Excel mất số 0 đầu.
    ['911222333', '0911222333'],
    ['911 222 333', '0911222333'],
  ])('%s → %s', (raw, local) => {
    expect(searchPhone(raw)).toBe(local);
    expect(recipientPhoneVariants(searchPhone(raw)!)).toEqual(['0911222333', '+84911222333', '84911222333']);
  });

  it('chuỗi số khác (mã đơn Pancake, một phần SĐT) giữ nguyên; không phải số → null', () => {
    expect(searchPhone('900033')).toBe('900033');
    expect(searchPhone('0911')).toBe('0911');
    expect(searchPhone('12345678901')).toBe('12345678901');
    expect(searchPhone('TUBU123')).toBeNull();
    expect(searchPhone('09')).toBeNull();
  });
});

describe('normalizeAdminOrderSearch', () => {
  it('bỏ khoảng trắng hai đầu và "#" đứng trước (mã Pancake hiện dạng #900033)', () => {
    expect(normalizeAdminOrderSearch(' #900033 ')).toBe('900033');
    expect(normalizeAdminOrderSearch('## TUBU2026')).toBe('TUBU2026');
    expect(normalizeAdminOrderSearch('#')).toBe('');
    expect(normalizeAdminOrderSearch('Mẹ #2')).toBe('Mẹ #2');
    expect(normalizeAdminOrderSearch(undefined)).toBe('');
  });

  it('buildAdminOrderWhere: "#" một mình không lọc gì; "#mã" so mã Pancake không kèm #', () => {
    expect(buildAdminOrderWhere({ search: ' # ' })).toEqual({});
    expect(buildAdminOrderWhere({ search: '#900033', searchUserIds: [] }).OR).toEqual(
      expect.arrayContaining([{ pancakeOrderId: '900033' }]),
    );
  });

  it('buildAdminOrderWhere: tên người nhận tìm theo cột không dấu, đã escape', () => {
    expect(buildAdminOrderWhere({ search: 'Mẹ Chồng 50%', searchUserIds: [] }).OR).toEqual(
      expect.arrayContaining([{ recipientSearch: { contains: 'me chong 50\\%' } }]),
    );
  });
});

describe('pancakeUnsyncedWhere — lọc "Chưa lên Pancake"', () => {
  it('loại đơn đại lý còn hàng đặt trước (chưa được phép lên kho, không phải lỗi đồng bộ)', () => {
    const where = pancakeUnsyncedWhere(new Date('2026-10-14T00:00:00Z'));
    expect(where.NOT).toEqual({ type: 'DEALER', items: { some: { backorderedQty: { gt: 0 } } } });
    expect(where).toMatchObject({
      pancakeOrderId: null,
      status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'] },
    });
  });

  it('filter pancake=unsynced dùng đúng vị từ đó', () => {
    expect(buildAdminOrderWhere({ pancake: 'unsynced' }).NOT).toEqual({
      type: 'DEALER',
      items: { some: { backorderedQty: { gt: 0 } } },
    });
  });
});

describe('buildAdminOrderWhere — loại đơn, thanh toán, nền tảng, người giới thiệu (D1-17)', () => {
  it('mỗi loại đơn là một điều kiện loại trừ nhau: đại lý > CTV lên hộ > gian hàng > CTV > lẻ', () => {
    expect(buildAdminOrderWhere({ kind: 'dealer' })).toEqual({ type: 'DEALER' });
    expect(buildAdminOrderWhere({ kind: 'ctv_assisted' })).toEqual({ type: 'RETAIL', placedForCustomer: true });
    expect(buildAdminOrderWhere({ kind: 'storefront' })).toEqual({
      type: 'RETAIL',
      placedForCustomer: false,
      storefrontId: { not: null },
    });
    expect(buildAdminOrderWhere({ kind: 'ctv' })).toEqual({
      type: 'RETAIL',
      placedForCustomer: false,
      storefrontId: null,
      referrerUserId: { not: null },
    });
    expect(buildAdminOrderWhere({ kind: 'retail' })).toEqual({
      type: 'RETAIL',
      placedForCustomer: false,
      storefrontId: null,
      referrerUserId: null,
    });
    expect(ORDER_KINDS).toEqual(['retail', 'ctv', 'dealer', 'ctv_assisted', 'storefront']);
  });

  it('tình trạng thanh toán, nền tảng, CTV và gian hàng lọc đúng cột có index', () => {
    expect(buildAdminOrderWhere({ payment: 'PAID' })).toEqual({ paymentStatus: 'PAID' });
    expect(buildAdminOrderWhere({ platform: 'web' })).toEqual({ platform: 'web' });
    expect(buildAdminOrderWhere({ referrerUserId: 'u1' })).toEqual({ referrerUserId: 'u1' });
    expect(buildAdminOrderWhere({ storefrontId: 's1' })).toEqual({ storefrontId: 's1' });
  });

  it('ghép AND với bộ lọc sẵn có và không đè lên search (search có OR riêng)', () => {
    expect(buildAdminOrderWhere({ status: 'DELIVERED', payment: 'UNPAID', platform: 'miniapp', kind: 'dealer' })).toEqual({
      AND: [{ status: 'DELIVERED' }, { type: 'DEALER' }, { paymentStatus: 'UNPAID' }, { platform: 'miniapp' }],
    });
    const w = buildAdminOrderWhere({ search: 'abc', searchUserIds: [], kind: 'retail' });
    expect(w.AND).toHaveLength(2);
  });

  it('không chọn gì thì không thêm điều kiện nào', () => {
    expect(buildAdminOrderWhere({ kind: undefined, payment: undefined, platform: undefined })).toEqual({});
  });
});
