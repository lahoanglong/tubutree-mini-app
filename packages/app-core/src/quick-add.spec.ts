import { describe, expect, it } from 'vitest';
import { quickAddPlan } from './quick-add';

const v = (id: string, stock: number) => ({ id, stock });

describe('quickAddPlan', () => {
  it('một phân loại còn hàng: thêm thẳng phân loại đó', () => {
    expect(quickAddPlan([v('a', 3)])).toEqual({ kind: 'add', variationId: 'a' });
  });

  it('từ hai phân loại: hỏi khách chọn, như trang chi tiết', () => {
    expect(quickAddPlan([v('a', 3), v('b', 3)])).toEqual({ kind: 'pick' });
  });

  it('nhiều phân loại nhưng chỉ một còn hàng vẫn mở bảng chọn để khách thấy phân loại hết', () => {
    expect(quickAddPlan([v('a', 0), v('b', 2)])).toEqual({ kind: 'pick' });
  });

  it('không còn phân loại nào có hàng: báo hết hàng, không thêm', () => {
    expect(quickAddPlan([v('a', 0)])).toEqual({ kind: 'soldOut' });
    expect(quickAddPlan([v('a', 0), v('b', 0)])).toEqual({ kind: 'soldOut' });
  });

  it('không có phân loại (dữ liệu thiếu): báo hết hàng, không đoán id', () => {
    expect(quickAddPlan([])).toEqual({ kind: 'soldOut' });
  });
});
