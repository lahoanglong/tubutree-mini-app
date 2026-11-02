import { FLASH_ALLOWANCE_MAX_ITEMS } from '@tubutree/shared-types';
import { describe, expect, it } from 'vitest';
import { allowanceItemIds, flashAllowanceKey, withFlashAllowance } from './flash-allowance';

describe('flashAllowanceKey', () => {
  it('nằm dưới "orders" để đặt đơn thành công (invalidate ["orders"]) làm số suất tải lại, và không chứa số lượng', () => {
    expect(flashAllowanceKey(['b', 'a'])).toEqual(['orders', 'flash-allowance', 'b,a']);
    expect(flashAllowanceKey(['a', 'b'])[0]).toBe('orders');
  });
});

describe('allowanceItemIds', () => {
  const flash = [
    { itemId: 'fi2', variationId: 'v2' },
    { itemId: 'fi1', variationId: 'v1' },
    { itemId: 'fi9', variationId: 'v9' },
    { variationId: 'v1' },
    { itemId: 'fi1', variationId: 'v1' },
  ];

  it('chỉ suất của các phân loại được hỏi, không trùng, sắp xếp (khoá ổn định), bỏ suất không có itemId', () => {
    expect(allowanceItemIds(flash, ['v1', 'v2'])).toEqual(['fi1', 'fi2']);
    expect(allowanceItemIds(flash, ['v2', 'v1'])).toEqual(['fi1', 'fi2']);
  });

  it('không có phân loại hoặc không có suất thì rỗng', () => {
    expect(allowanceItemIds(flash, [])).toEqual([]);
    expect(allowanceItemIds([], ['v1'])).toEqual([]);
  });

  it(`cắt ở ${FLASH_ALLOWANCE_MAX_ITEMS} suất (giới hạn của endpoint)`, () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ itemId: `fi${String(i).padStart(3, '0')}`, variationId: `v${i}` }));
    expect(allowanceItemIds(many, many.map((m) => m.variationId))).toHaveLength(FLASH_ALLOWANCE_MAX_ITEMS);
  });
});

describe('withFlashAllowance', () => {
  const flash = [
    { itemId: 'fi1', variationId: 'v1', flashPrice: 26_000 },
    { itemId: 'fi2', variationId: 'v2', flashPrice: 30_000 },
  ];

  it('trộn perUserLeft vào đúng suất, không sửa phần tử gốc', () => {
    const merged = withFlashAllowance(flash, { items: { fi1: { perUserLeft: 0, allowance: 0 } } });
    expect(merged).toEqual([{ ...flash[0], perUserLeft: 0 }, flash[1]]);
    expect(flash[0]).not.toHaveProperty('perUserLeft');
    expect(merged[1]).toBe(flash[1]);
  });

  it('chưa có kết quả, kết quả rỗng hoặc không khớp suất nào: trả đúng mảng đầu vào (giữ tham chiếu)', () => {
    expect(withFlashAllowance(flash, undefined)).toBe(flash);
    expect(withFlashAllowance(flash, null)).toBe(flash);
    expect(withFlashAllowance(flash, { items: {} })).toBe(flash);
    expect(withFlashAllowance(flash, { items: { khac: { perUserLeft: 1, allowance: 1 } } })).toBe(flash);
  });

  it('kết quả hỏng (không phải object, perUserLeft không phải số) thì bỏ qua, không ném', () => {
    expect(withFlashAllowance(flash, { items: 'x' } as never)).toBe(flash);
    expect(withFlashAllowance(flash, { items: { fi1: { perUserLeft: '0' } } } as never)).toBe(flash);
    expect(withFlashAllowance(flash, { items: { fi1: null } } as never)).toBe(flash);
  });
});
