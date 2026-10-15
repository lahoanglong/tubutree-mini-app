import { buildAdminOrderWhere, normalizeAdminOrderSearch, pancakeUnsyncedWhere, recipientPhoneVariants, searchPhone } from './admin-order-filter';

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
