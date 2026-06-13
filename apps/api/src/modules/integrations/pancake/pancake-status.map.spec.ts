import { mapPancakeStatus } from './pancake-status.map';

describe('mapPancakeStatus', () => {
  it('mã số Pancake → OrderStatus', () => {
    expect(mapPancakeStatus(1)).toBe('CONFIRMED');
    expect(mapPancakeStatus('16')).toBe('DELIVERED');
    expect(mapPancakeStatus('15')).toBe('DELIVERED');
    expect(mapPancakeStatus(6)).toBe('CANCELLED');
    expect(mapPancakeStatus(4)).toBe('RETURNED');
  });

  it('chuỗi trạng thái (không phân biệt hoa thường + có space) → OrderStatus', () => {
    expect(mapPancakeStatus('Delivered')).toBe('DELIVERED');
    expect(mapPancakeStatus('  completed ')).toBe('DELIVERED'); // trim + lowercase
    expect(mapPancakeStatus('CANCELED')).toBe('CANCELLED');
    expect(mapPancakeStatus('shipped')).toBe('SHIPPING');
  });

  it('null/undefined/không khớp → null (giữ nguyên trạng thái)', () => {
    expect(mapPancakeStatus(null)).toBeNull();
    expect(mapPancakeStatus(undefined)).toBeNull();
    expect(mapPancakeStatus('xyz')).toBeNull();
    expect(mapPancakeStatus(999)).toBeNull();
  });
});
