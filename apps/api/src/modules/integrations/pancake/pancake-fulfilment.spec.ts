import { isPancakeFulfilledLine, isRealPancakeId } from './pancake-fulfilment';

describe('isPancakeFulfilledLine', () => {
  it('hàng Tubu có mã Pancake thật → đi Pancake', () => {
    expect(isPancakeFulfilledLine({ pancakeId: '7f3c-var', fulfilment: 'TUBU' })).toBe(true);
    expect(isPancakeFulfilledLine({ pancakeId: '7f3c-var' })).toBe(true);
  });

  it('hàng đối tác tự giao → không đi Pancake, kể cả khi có mã', () => {
    expect(isPancakeFulfilledLine({ pancakeId: null, fulfilment: 'MERCHANT' })).toBe(false);
    expect(isPancakeFulfilledLine({ pancakeId: '7f3c-var', fulfilment: 'MERCHANT' })).toBe(false);
  });

  it('không có mã hoặc mã giả MCH_ → không bao giờ đi Pancake', () => {
    expect(isPancakeFulfilledLine({ pancakeId: null, fulfilment: 'TUBU' })).toBe(false);
    expect(isPancakeFulfilledLine({ pancakeId: '', fulfilment: 'TUBU' })).toBe(false);
    expect(isPancakeFulfilledLine({ pancakeId: '   ', fulfilment: 'TUBU' })).toBe(false);
    expect(isPancakeFulfilledLine({ pancakeId: 'MCH_1791908999268_79l8w_VAR', fulfilment: 'TUBU' })).toBe(false);
    expect(isRealPancakeId(undefined)).toBe(false);
  });
});
