import type { OrderStatus } from '@prisma/client';
import {
  addressEditable,
  countCustomerEdits,
  customerEditBlock,
  ORDER_EDIT_HISTORY_NOTE,
  ORDER_EDIT_MAX,
  orderEditHistoryNote,
  orderEditRefusalMessage,
  planCustomerEdit,
  snapshotOf,
  type OrderEditFacts,
  type OrderEditRefusal,
} from './order-customer-edit';

const base: OrderEditFacts = {
  type: 'RETAIL',
  status: 'CONFIRMED',
  fulfiller: 'TUBU',
  placedForCustomer: false,
  guestTokenHash: null,
  hasRecyclingPickup: false,
  gomdonOrderId: null,
  gomdonPartnerCode: null,
  gomdonStatus: null,
  autoCancelBlockedAt: null,
  shippingCode: null,
  shippingPartner: null,
  shippedAt: null,
  pancakeOrderId: null,
  pancakePushStatus: null,
  pancakePushClaimedAt: null,
};
const on = { flagOn: true, editsUsed: 0 };

describe('customerEditBlock', () => {
  it('đơn lẻ của kho Tubu, đã xác nhận hoặc chờ thanh toán: sửa được', () => {
    expect(customerEditBlock(base, on)).toBeNull();
    expect(customerEditBlock({ ...base, status: 'PENDING_PAYMENT' }, on)).toBeNull();
  });

  it('cờ tắt: DISABLED trước mọi lý do khác', () => {
    expect(customerEditBlock({ ...base, status: 'DELIVERED', guestTokenHash: 'h' }, { flagOn: false, editsUsed: 9 })).toBe('DISABLED');
  });

  it.each<OrderStatus>(['PACKED', 'SHIPPING', 'DELIVERED', 'RETURNED', 'CANCELLED'])('trạng thái %s: NOT_EDITABLE_STATUS', (status) => {
    expect(customerEditBlock({ ...base, status }, on)).toBe('NOT_EDITABLE_STATUS');
  });

  it.each<[string, Partial<OrderEditFacts>]>([
    ['đơn vãng lai (kể cả đã gộp vào tài khoản)', { guestTokenHash: 'hash' }],
    ['đại lý', { type: 'DEALER' }],
    ['CTV lên hộ người nhận', { placedForCustomer: true }],
    ['gian hàng tự giao', { fulfiller: 'MERCHANT' }],
    ['đơn thu gom tái chế', { hasRecyclingPickup: true }],
    ['có vận đơn Gomdon', { gomdonOrderId: 'G1' }],
    ['có trạng thái Gomdon', { gomdonStatus: 'AWAITING_PAYMENT' }],
  ])('%s: NOT_ELIGIBLE (kể cả khi trạng thái đã đóng gói)', (_l, over) => {
    expect(customerEditBlock({ ...base, ...over }, on)).toBe('NOT_ELIGIBLE');
    expect(customerEditBlock({ ...base, ...over, status: 'PACKED' }, on)).toBe('NOT_ELIGIBLE');
  });

  it.each<[string, Partial<OrderEditFacts>]>([
    ['hệ thống thôi tự huỷ (Pancake đã gửi hàng)', { autoCancelBlockedAt: new Date() }],
    ['đã có mã vận đơn hãng', { shippingCode: 'GHN123', shippingPartner: 'GHN' }],
    ['đã báo gửi hàng', { shippedAt: new Date() }],
  ])('%s: HANDED_OVER', (_l, over) => {
    expect(customerEditBlock({ ...base, ...over }, on)).toBe('HANDED_OVER');
  });

  it('lệnh tạo đơn Pancake đang bay: SYNCING', () => {
    expect(customerEditBlock({ ...base, pancakePushStatus: 'PUSHING' }, on)).toBe('SYNCING');
    expect(customerEditBlock({ ...base, pancakePushClaimedAt: new Date() }, on)).toBe('SYNCING');
    expect(customerEditBlock({ ...base, pancakePushStatus: 'PUSHING', pancakeOrderId: 'P1' }, on)).toBe('SYNCING');
  });

  it('quá cửa sổ tự đẩy (STALE): NOT_ELIGIBLE, kho có thể đã lên đơn tay mà Tubu không có mã', () => {
    expect(customerEditBlock({ ...base, pancakePushStatus: 'STALE' }, on)).toBe('NOT_ELIGIBLE');
    expect(customerEditBlock({ ...base, pancakePushStatus: 'STALE', pancakeOrderId: 'P1' }, on)).toBe('NOT_ELIGIBLE');
  });

  it('đã lên Pancake xong (có mã, không PUSHING): sửa được, dấu gửi cũ không chặn', () => {
    expect(customerEditBlock({ ...base, pancakeOrderId: 'P1', pancakePushStatus: 'SYNCED', pancakePushClaimedAt: new Date() }, on)).toBeNull();
  });

  it(`đủ ${ORDER_EDIT_MAX} lần sửa: EDIT_LIMIT`, () => {
    expect(customerEditBlock(base, { flagOn: true, editsUsed: ORDER_EDIT_MAX - 1 })).toBeNull();
    expect(customerEditBlock(base, { flagOn: true, editsUsed: ORDER_EDIT_MAX })).toBe('EDIT_LIMIT');
  });
});

describe('orderEditRefusalMessage', () => {
  const reasons: OrderEditRefusal[] = [
    'DISABLED',
    'NOT_ELIGIBLE',
    'NOT_EDITABLE_STATUS',
    'HANDED_OVER',
    'PACKING_ON_PANCAKE',
    'PANCAKE_UNREACHABLE',
    'SYNCING',
    'EDIT_LIMIT',
    'PROVINCE_CHANGED',
    'PROVINCE_LOCKED',
  ];
  it.each(reasons)('%s có câu tiếng Việt riêng', (r) => {
    const msg = orderEditRefusalMessage(r, 'Hà Nội');
    expect(msg.length).toBeGreaterThan(10);
    expect(msg).not.toMatch(/undefined|null/);
  });
  it('PROVINCE_CHANGED ghi tên tỉnh của đơn', () => {
    expect(orderEditRefusalMessage('PROVINCE_CHANGED', 'Hà Nội')).toBe('Chỉ đổi được địa chỉ trong Hà Nội. Muốn giao tỉnh khác, bạn huỷ đơn rồi đặt lại nhé.');
    expect(orderEditRefusalMessage('PROVINCE_CHANGED')).toContain('tỉnh/thành của đơn');
  });
});

const snap = {
  recipient: 'Lan',
  phone: '0912345678',
  province: 'Hà Nội',
  district: '',
  ward: 'Phường Ba Đình',
  street: '12 Kim Mã',
  provinceCode: '84_VN01',
  districtCode: '',
  wardCode: '84_VN0100004',
};
const current = { shippingAddress: snap, note: 'Giao giờ hành chính', notifyRecipientZalo: false };
const addr = { recipient: 'Lan', phone: '0912345678', ward: 'Phường Ba Đình', street: '12 Kim Mã', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN0100004' };

describe('planCustomerEdit', () => {
  it('đổi phường + số nhà + ghi chú: giữ tên tỉnh và mã tỉnh của đơn', () => {
    const plan = planCustomerEdit(current, {
      address: { ...addr, ward: 'Phường Giảng Võ', wardCode: '84_VN0100007', street: '5 Giảng Võ' },
      note: 'Gọi trước khi giao',
    });
    expect(plan).toEqual({
      kind: 'WRITE',
      shippingAddress: { ...snap, ward: 'Phường Giảng Võ', wardCode: '84_VN0100007', street: '5 Giảng Võ' },
      note: 'Gọi trước khi giao',
      disableRecipientZalo: false,
      changed: ['phường/xã', 'số nhà', 'ghi chú'],
      addressChanged: true,
    });
  });

  it('khác tỉnh: PROVINCE_CHANGED (so sau trim), không ghi gì', () => {
    expect(planCustomerEdit(current, { address: { ...addr, provinceCode: '84_VN79' } })).toEqual({ kind: 'REFUSED', reason: 'PROVINCE_CHANGED' });
    expect(planCustomerEdit(current, { address: { ...addr, provinceCode: ' 84_VN01 ', street: '1 A' } }).kind).toBe('WRITE');
  });

  it('đơn cũ thiếu mã tỉnh hoặc mã tỉnh hệ cũ: địa chỉ khoá (PROVINCE_LOCKED), ghi chú vẫn sửa được', () => {
    const old = { ...current, shippingAddress: { ...snap, provinceCode: '' } };
    expect(planCustomerEdit(old, { address: addr })).toEqual({ kind: 'REFUSED', reason: 'PROVINCE_LOCKED' });
    expect(planCustomerEdit({ ...current, shippingAddress: { ...snap, provinceCode: '01' } }, { address: addr })).toEqual({ kind: 'REFUSED', reason: 'PROVINCE_LOCKED' });
    expect(planCustomerEdit(old, { note: 'mới' })).toMatchObject({ kind: 'WRITE', changed: ['ghi chú'], addressChanged: false });
  });

  it('không đổi gì (trim, +84 ↔ 0, ghi chú trùng): NOOP', () => {
    expect(planCustomerEdit(current, { address: { ...addr, recipient: ' Lan ', phone: '+84912345678' }, note: ' Giao giờ hành chính ' })).toEqual({ kind: 'NOOP' });
    expect(planCustomerEdit(current, { note: undefined })).toEqual({ kind: 'NOOP' });
  });

  it("ghi chú '' hoặc null: xoá ghi chú", () => {
    expect(planCustomerEdit(current, { note: '' })).toMatchObject({ kind: 'WRITE', note: null, changed: ['ghi chú'] });
    expect(planCustomerEdit(current, { note: null })).toMatchObject({ kind: 'WRITE', note: null });
    expect(planCustomerEdit({ ...current, note: null }, { note: '  ' })).toEqual({ kind: 'NOOP' });
  });

  it('đổi SĐT khi đang báo Zalo người nhận: tắt báo Zalo; không đổi SĐT thì giữ', () => {
    const zalo = { ...current, notifyRecipientZalo: true };
    expect(planCustomerEdit(zalo, { address: { ...addr, phone: '0987654321' } })).toMatchObject({ disableRecipientZalo: true, changed: ['SĐT'] });
    expect(planCustomerEdit(zalo, { address: { ...addr, recipient: 'Mai' } })).toMatchObject({ disableRecipientZalo: false, changed: ['người nhận'] });
    expect(planCustomerEdit(current, { address: { ...addr, phone: '0987654321' } })).toMatchObject({ disableRecipientZalo: false });
  });

  it('chỉ ghi chú đổi: ảnh chụp địa chỉ giữ nguyên', () => {
    const plan = planCustomerEdit(current, { address: { ...addr, phone: '+84912345678' }, note: 'mới' });
    expect(plan).toMatchObject({ kind: 'WRITE', shippingAddress: snap, addressChanged: false, changed: ['ghi chú'] });
  });
});

describe('snapshotOf / addressEditable / history note', () => {
  it('Json lạ: chuỗi rỗng, không ném', () => {
    expect(snapshotOf(null).provinceCode).toBe('');
    expect(snapshotOf(['x']).recipient).toBe('');
    expect(snapshotOf({ recipient: 5, phone: ' 09 ' }).phone).toBe('09');
  });
  it('chỉ tỉnh hệ mới đổi được địa chỉ', () => {
    expect(addressEditable({ provinceCode: '84_VN01' })).toBe(true);
    expect(addressEditable({ provinceCode: '01' })).toBe(false);
    expect(addressEditable({ provinceCode: '' })).toBe(false);
  });
  it('dòng lịch sử chỉ có tên trường, không có giá trị', () => {
    expect(orderEditHistoryNote(['phường/xã', 'số nhà', 'ghi chú'])).toBe(`${ORDER_EDIT_HISTORY_NOTE}: phường/xã, số nhà, ghi chú`);
  });
});

describe('countCustomerEdits', () => {
  it('chỉ đếm dòng cùng trạng thái của khách mang dấu sửa', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { fromStatus: 'CONFIRMED', toStatus: 'CONFIRMED' },
      { fromStatus: 'PENDING_PAYMENT', toStatus: 'PENDING_PAYMENT' },
      { fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED' },
    ]);
    await expect(countCustomerEdits({ orderStatusHistory: { findMany } } as never, 'o1')).resolves.toBe(2);
    expect(findMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', actorType: 'CUSTOMER', note: { startsWith: ORDER_EDIT_HISTORY_NOTE } },
      select: { fromStatus: true, toStatus: true },
    });
  });
});
