import { pancakeDedupeKey, pancakeEventData, pancakeEventId, pancakeEventOrderCode, pancakeEventRef } from './pancake-webhook-dedupe';

describe('pancakeDedupeKey', () => {
  it('thứ tự khoá và khoá undefined không làm đổi khoá chống trùng', () => {
    const a = pancakeDedupeKey('orders', { id: 'p1', status: 2, nested: { x: 1, y: [1, 2] } });
    const b = pancakeDedupeKey('orders', { nested: { y: [1, 2], x: 1 }, status: 2, id: 'p1', gone: undefined });
    expect(a).toBe(b);
  });
  it('khác giá trị, khác thứ tự mảng, khác loại sự kiện → khác khoá', () => {
    const base = pancakeDedupeKey('orders', { id: 'p1', status: 2, l: [1, 2] });
    expect(pancakeDedupeKey('orders', { id: 'p1', status: 3, l: [1, 2] })).not.toBe(base);
    expect(pancakeDedupeKey('orders', { id: 'p1', status: 2, l: [2, 1] })).not.toBe(base);
    expect(pancakeDedupeKey('order', { id: 'p1', status: 2, l: [1, 2] })).not.toBe(base);
  });
  it('null và vắng mặt là hai payload khác nhau; số "1" và 1 khác nhau', () => {
    expect(pancakeDedupeKey('o', { a: null })).not.toBe(pancakeDedupeKey('o', {}));
    expect(pancakeDedupeKey('o', { a: 1 })).not.toBe(pancakeDedupeKey('o', { a: '1' }));
  });
  it.each([[null], [undefined], ['x'], [5], [[]], [{}]])('body %p không ném', (b) => {
    expect(pancakeDedupeKey('orders', b)).toMatch(/^orders\|[0-9a-f]{64}$/);
  });
  it('loại sự kiện dài bị cắt 120 ký tự để khoá không phình', () => {
    expect(pancakeDedupeKey('x'.repeat(500), {}).split('|')[0]).toHaveLength(120);
  });
});

describe('pancakeEventData', () => {
  it('object đơn top-level hoặc bọc trong data', () => {
    expect(pancakeEventData({ id: 'p1' })).toEqual({ id: 'p1' });
    expect(pancakeEventData({ event: 'x', data: { id: 'p2' } })).toEqual({ id: 'p2' });
  });
  it.each([[null], [undefined], ['x'], [5], [[]]])('payload %p: object rỗng, không ném', (raw) => {
    expect(pancakeEventData(raw)).toEqual({});
  });
  it.each([[[1]], ['x'], [5], [null]])('data=%p không phải object: dùng chính payload', (data) => {
    expect(pancakeEventData({ id: 'p1', data })).toEqual({ id: 'p1', data });
  });
});

describe('pancakeEventId', () => {
  it('id hoặc order_id: chuỗi hoặc số nguyên an toàn', () => {
    expect(pancakeEventId({ id: 9006 })).toBe('9006');
    expect(pancakeEventId({ order_id: ' abc ' })).toBe('abc');
    expect(pancakeEventId({ id: 'p1', order_id: 'p2' })).toBe('p1');
  });
  it('id không đọc được thì thử order_id, không thành "[object Object]"', () => {
    expect(pancakeEventId({ id: { a: 1 }, order_id: 77 })).toBe('77');
    expect(pancakeEventId({ id: { a: 1 } })).toBeNull();
  });
  it.each([[''], ['   '], [null], [undefined], [true], [[]], [1.5], [1e21], ['undefined']])('id=%p → null', (id) => {
    expect(pancakeEventId({ id })).toBeNull();
  });
});

describe('pancakeEventOrderCode', () => {
  it('external_order_id là chuỗi → lấy (cắt khoảng trắng)', () => {
    expect(pancakeEventOrderCode({ extension: { external_order_id: ' TUBU1 ' } })).toBe('TUBU1');
  });
  it('external_order_id không phải chuỗi hoặc rỗng → bỏ qua, đọc từ ghi chú', () => {
    for (const v of [{ a: 1 }, 123, ['TUBU1'], '', '  ', null, true]) {
      expect(pancakeEventOrderCode({ extension: { external_order_id: v }, note: 'Order code: TUBU9' })).toBe('TUBU9');
    }
  });
  it.each([[null], ['x'], [5], [[]]])('extension=%p: null, không ném', (extension) => {
    expect(pancakeEventOrderCode({ extension })).toBeNull();
  });
  it('note không phải chuỗi: null', () => {
    expect(pancakeEventOrderCode({ note: { a: 1 } })).toBeNull();
    expect(pancakeEventOrderCode({ note: 5 })).toBeNull();
  });
});

describe('pancakeEventRef', () => {
  it('ưu tiên mã đơn Tubu, không có thì #id', () => {
    expect(pancakeEventRef({ note: 'Order code: TUBU7', id: 'p1' })).toBe('TUBU7');
    expect(pancakeEventRef({ id: 9006 })).toBe('#9006');
    expect(pancakeEventRef({ data: { order_id: 'p3' } })).toBe('#p3');
  });
  it.each([[{ id: { a: 1 } }], [{ id: [] }], [{ id: '' }], [{}], [null], ['x']])('payload %j: null, không có "#[object Object]"', (raw) => {
    expect(pancakeEventRef(raw)).toBeNull();
  });
});
