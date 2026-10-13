import { describe, expect, it } from 'vitest';
import { journeyEvents, shippingEventLabel } from './shipping-events';

describe('shippingEventLabel — mã hãng → câu tiếng Việt', () => {
  it('rỗng → null', () => {
    expect(shippingEventLabel(null)).toBeNull();
    expect(shippingEventLabel('  ')).toBeNull();
  });

  it('mã đã biết (bất kể hoa/thường, dấu cách, gạch)', () => {
    expect(shippingEventLabel('delivering')).toBe('Đang giao hàng');
    expect(shippingEventLabel('Ready To Pick')).toBe('Chờ lấy hàng');
    expect(shippingEventLabel('DELIVERY-SUCCESS')).toBe('Giao hàng thành công');
  });

  it('chuỗi đã là tiếng Việt thì giữ nguyên', () => {
    expect(shippingEventLabel('Đã đến kho Hà Nội')).toBe('Đã đến kho Hà Nội');
  });

  it('mã lạ không bị in thô ra cho khách', () => {
    expect(shippingEventLabel('XYZ_42')).toBe('Đang cập nhật');
  });
});

describe('journeyEvents', () => {
  it('lọc mốc rác, đảo thành mới nhất trước, không đụng mảng gốc', () => {
    const history = [{ status: 'created' }, null, {}, { code: 'BE1' }, { status: 'delivering' }];
    const out = journeyEvents(history);
    expect(out).toEqual([{ status: 'delivering' }, { code: 'BE1' }, { status: 'created' }]);
    expect(history).toHaveLength(5);
  });

  it('không phải mảng (null/undefined/JSON lạ) → []', () => {
    expect(journeyEvents(null)).toEqual([]);
    expect(journeyEvents(undefined)).toEqual([]);
    expect(journeyEvents({} as never)).toEqual([]);
  });
});
