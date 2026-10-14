import { buildAdminOrderWhere, pancakeUnsyncedWhere } from './admin-order-filter';

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
