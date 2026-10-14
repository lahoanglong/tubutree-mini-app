import { actorAllowedTransitions, actorTransitionBlock } from './order-actor-transitions';

const onPancake = { fulfiller: 'TUBU', pancakeOrderId: 'pk1' };
const notOnPancake = { fulfiller: 'TUBU', pancakeOrderId: null };
const merchant = { fulfiller: 'MERCHANT', pancakeOrderId: null };
const all = ['PACKED', 'SHIPPING', 'DELIVERED', 'CANCELLED'] as const;

describe('chuyển trạng thái tay theo người bấm (R2-ADMINOPS-2)', () => {
  it('CSKH chỉ huỷ, KHO chỉ đóng gói, có cả hai nhóm thì có cả hai', () => {
    expect(actorAllowedTransitions({ role: 'STAFF', staffPermissions: ['CSKH'] }, onPancake, [...all])).toEqual(['CANCELLED']);
    expect(actorAllowedTransitions({ role: 'STAFF', staffPermissions: ['KHO'] }, onPancake, [...all])).toEqual(['PACKED']);
    expect(actorAllowedTransitions({ role: 'STAFF', staffPermissions: ['CSKH', 'KHO'] }, onPancake, [...all])).toEqual([
      'PACKED',
      'CANCELLED',
    ]);
    expect(actorAllowedTransitions({ role: 'STAFF', staffPermissions: [] }, onPancake, [...all])).toEqual([]);
    expect(actorAllowedTransitions({ role: 'STAFF', staffPermissions: ['KHO'] }, onPancake, ['RETURNED'])).toEqual([]);
  });

  it('ADMIN: đủ nút cho đơn đã lên Pancake; đơn Tubu chưa lên Pancake không có Giao vận/Đã giao', () => {
    expect(actorAllowedTransitions({ role: 'ADMIN' }, onPancake, [...all])).toEqual([...all]);
    expect(actorAllowedTransitions({ role: 'ADMIN' }, notOnPancake, [...all])).toEqual(['PACKED', 'CANCELLED']);
    expect(actorAllowedTransitions({ role: 'ADMIN' }, merchant, [...all])).toEqual([...all]);
  });

  it('lý do chặn nói rõ cần làm gì', () => {
    expect(actorTransitionBlock({ role: 'STAFF', staffPermissions: ['CSKH'] }, onPancake, 'DELIVERED')).toEqual({
      kind: 'FORBIDDEN',
      message: expect.stringContaining('CSKH chỉ huỷ đơn'),
    });
    expect(actorTransitionBlock({ role: 'ADMIN' }, notOnPancake, 'DELIVERED')).toEqual({
      kind: 'BAD_REQUEST',
      message: expect.stringContaining('chưa lên Pancake'),
    });
    expect(actorTransitionBlock({ role: 'ADMIN' }, onPancake, 'DELIVERED')).toBeNull();
    expect(actorTransitionBlock({ role: 'STAFF', staffPermissions: ['KHO'] }, onPancake, 'PACKED')).toBeNull();
  });

  it('người bấm không phải ADMIN/STAFF thì không đổi được gì', () => {
    expect(actorAllowedTransitions({ role: 'CUSTOMER' }, onPancake, [...all])).toEqual([]);
  });
});
