import {
  discountFractionToPct,
  discountPctToFraction,
  resolveMaxDiscount,
  tierProblems,
  TIER_MAX_VND,
} from './dealer-tier-input';

const OK = { name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 30, creditLimit: 20_000_000, paymentTerms: 'NET 15' };

describe('resolveMaxDiscount — trần chiết khấu lấy từ dealer.max_discount_pct', () => {
  it('đọc phân số hợp lệ; giá trị hỏng rơi về mặc định 0,45 như dealerContext', () => {
    expect(resolveMaxDiscount(0.4)).toBe(0.4);
    expect(resolveMaxDiscount(0)).toBe(0);
    for (const bad of [undefined, null, '0.3', -1, 1.5, Number.NaN, {}]) expect(resolveMaxDiscount(bad)).toBe(0.45);
  });
});

describe('discountPctToFraction / discountFractionToPct', () => {
  it('đổi qua lại không lệch số lẻ trôi nổi', () => {
    expect(discountPctToFraction(38)).toBe(0.38);
    expect(discountPctToFraction(12.5)).toBe(0.125);
    expect(discountPctToFraction(33.33)).toBe(0.3333);
    expect(discountFractionToPct(0.38)).toBe(38);
    expect(discountFractionToPct(0.3333)).toBe(33.33);
    expect(discountFractionToPct(0.1 + 0.2)).toBe(30);
  });
});

describe('tierProblems — khoảng giá trị của một bậc đại lý', () => {
  it('bậc hợp lệ → không lỗi', () => {
    expect(tierProblems(OK, 0.45)).toEqual([]);
    expect(tierProblems({ ...OK, discountPct: 45, paymentTerms: 'PREPAID', creditLimit: 0, minOrderVolume: 0 }, 0.45)).toEqual([]);
    expect(tierProblems({ ...OK, paymentTerms: null }, 0.45)).toEqual([]);
  });

  it('chiết khấu không vượt dealer.max_discount_pct, nói rõ con số và khoá cấu hình', () => {
    const [msg] = tierProblems({ ...OK, discountPct: 46 }, 0.45);
    expect(msg).toMatch(/46%/);
    expect(msg).toMatch(/45%/);
    expect(msg).toMatch(/dealer\.max_discount_pct/);
    expect(tierProblems({ ...OK, discountPct: 45.01 }, 0.45)).toHaveLength(1);
    expect(tierProblems({ ...OK, discountPct: 40 }, 0.4)).toEqual([]);
  });

  it('chiết khấu phải > 0, tối đa 2 chữ số thập phân, là số hữu hạn', () => {
    for (const discountPct of [0, -5, 12.345, Number.NaN, Number.POSITIVE_INFINITY, '30' as unknown as number]) {
      expect(tierProblems({ ...OK, discountPct }, 0.45)).not.toEqual([]);
    }
  });

  it('hạn mức và doanh số tối thiểu: số nguyên đồng, 0..trần INT4; không âm', () => {
    expect(tierProblems({ ...OK, creditLimit: -1 }, 0.45)).not.toEqual([]);
    expect(tierProblems({ ...OK, creditLimit: 1.5 }, 0.45)).not.toEqual([]);
    expect(tierProblems({ ...OK, creditLimit: TIER_MAX_VND + 1 }, 0.45)).not.toEqual([]);
    expect(tierProblems({ ...OK, creditLimit: TIER_MAX_VND }, 0.45)).toEqual([]);
    expect(tierProblems({ ...OK, minOrderVolume: -1 }, 0.45)).not.toEqual([]);
    expect(tierProblems({ ...OK, minOrderVolume: TIER_MAX_VND + 1 }, 0.45)).not.toEqual([]);
  });

  it('điều kiện thanh toán: PREPAID hoặc NET <số ngày 1..365>; để trống được', () => {
    for (const paymentTerms of ['PREPAID', 'NET 7', 'NET 30', 'NET 365']) expect(tierProblems({ ...OK, paymentTerms }, 0.45)).toEqual([]);
    for (const paymentTerms of ['net 30', 'NET 0', 'NET 366', 'NET', 'Trả sau', 'NET 30; DROP', ' NET 30']) {
      expect(tierProblems({ ...OK, paymentTerms }, 0.45)).not.toEqual([]);
    }
  });

  it('tên bậc không rỗng, ≤ 60 ký tự', () => {
    expect(tierProblems({ ...OK, name: '   ' }, 0.45)).not.toEqual([]);
    expect(tierProblems({ ...OK, name: 'a'.repeat(61) }, 0.45)).not.toEqual([]);
    expect(tierProblems({ ...OK, name: 'a'.repeat(60) }, 0.45)).toEqual([]);
  });

  it('gom mọi lỗi để admin sửa một lượt', () => {
    expect(tierProblems({ name: '', minOrderVolume: -1, discountPct: 99, creditLimit: -5, paymentTerms: 'x' }, 0.45).length).toBe(5);
  });
});
