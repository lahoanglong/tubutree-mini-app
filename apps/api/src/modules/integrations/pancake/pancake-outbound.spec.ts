import { extractPancakeOrderId, isPancakeCancelled, isPancakeHandedOver, pancakeOrderHasCode, pancakeOrderIdOf } from './pancake-outbound';

describe('extractPancakeOrderId', () => {
  it('phản hồi phẳng (Open API) hoặc bọc data (bản thật)', () => {
    expect(extractPancakeOrderId({ id: 9006 })).toBe('9006');
    expect(extractPancakeOrderId({ order_id: 'p1' })).toBe('p1');
    expect(extractPancakeOrderId({ success: true, data: { id: 'p2' } })).toBe('p2');
    expect(extractPancakeOrderId({ success: true, data: { order_id: 77 } })).toBe('77');
  });
  it('ô đầu rỗng/rác thì thử ô sau, không dừng ở chuỗi rỗng', () => {
    expect(extractPancakeOrderId({ data: { id: '' }, order_id: 'p9' })).toBe('p9');
    expect(extractPancakeOrderId({ data: { id: { a: 1 } }, id: 'p8' } as never)).toBe('p8');
  });
  it.each([[null], [undefined], [{}], [{ data: {} }], [{ id: { a: 1 } }], [{ id: [] }], [{ id: '' }], [{ id: true }], [{ id: 1.5 }], [{ data: { id: 'undefined' } }]])(
    'phản hồi %j không mang mã đọc được: null (không ghi "[object Object]" làm mã đơn Pancake)',
    (res) => {
      expect(extractPancakeOrderId(res as never)).toBeNull();
    },
  );
});

describe('pancakeOrderIdOf', () => {
  it('mã đơn của một dòng trả về từ Pancake', () => {
    expect(pancakeOrderIdOf({ id: 9006 })).toBe('9006');
    expect(pancakeOrderIdOf({ id: 'p1' })).toBe('p1');
  });
  it.each([[null], [undefined], [{}], [{ id: null }], [{ id: { a: 1 } }], ['x'], [5]])('%j → null', (o) => {
    expect(pancakeOrderIdOf(o as never)).toBeNull();
  });
});

describe('pancakeOrderHasCode', () => {
  it('khớp theo custom_id, extension hoặc ghi chú, không theo chuỗi con', () => {
    expect(pancakeOrderHasCode({ custom_id: 'TUBU1' }, 'TUBU1')).toBe(true);
    expect(pancakeOrderHasCode({ extension: { external_order_id: 'TUBU1' } }, 'TUBU1')).toBe(true);
    expect(pancakeOrderHasCode({ note: 'Order code: TUBU1 | ghi chú' }, 'TUBU1')).toBe(true);
    expect(pancakeOrderHasCode({ note: 'Order code: TUBU12' }, 'TUBU1')).toBe(false);
  });
  it.each([[{ custom_id: 5, extension: 'x', note: { a: 1 } }], [{ custom_id: null, extension: null, note: null }], [{}]])('trường kiểu lạ %j: false, không ném', (o) => {
    expect(pancakeOrderHasCode(o as never, 'TUBU1')).toBe(false);
  });
});

describe('isPancakeHandedOver / isPancakeCancelled — kiểu lạ', () => {
  it('mã số và chuỗi số', () => {
    expect(isPancakeHandedOver(2)).toBe(true);
    expect(isPancakeHandedOver('3')).toBe(true);
    expect(isPancakeHandedOver(' 16 ')).toBe(true);
    expect(isPancakeHandedOver(1)).toBe(false);
    expect(isPancakeCancelled(6)).toBe(true);
    expect(isPancakeCancelled('7')).toBe(true);
    expect(isPancakeCancelled(2)).toBe(false);
  });
  it.each([[[6]], [[2]], [true], [{}], [''], [null], [undefined], [6.5], ['6.5'], ['abc'], [NaN]])('%j không phải mã trạng thái: cả hai đều false', (v) => {
    expect(isPancakeCancelled(v)).toBe(false);
    expect(isPancakeHandedOver(v)).toBe(false);
  });
});
