import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS, SHOP_COPY, fillCopy } from './shop-copy';
import { SHOP_COPY_MAX } from './shop-copy-budget';

// Giá trị xấu nhất của từng biến để đo độ dài. Biến mang chữ tự do (name, title, a, b, when) không có ở đây:
// khoá dùng chúng phải có max null.
const WORST: Record<string, string> = {
  t: '23:59:59',
  time: '12:00',
  day: '02/11',
  n: '99',
  pct: '99',
  d: '99',
  h: '23',
  m: '59',
  price: '999.999đ',
  save: '999.999đ',
  x: '999k',
  min: '999k',
  max: '999k',
  amount: '999.999đ',
  date: '31/12',
  avg: '5,0',
  i: '9',
  clock: '03:15',
};

const hit = (text: string) => FORBIDDEN_TERMS.filter((t) => t.pattern.test(text)).map((t) => t.use);

describe('SHOP_COPY', () => {
  it('SHOP_COPY và SHOP_COPY_MAX cùng tập khoá, không có chữ rỗng', () => {
    expect(Object.keys(SHOP_COPY).sort()).toEqual(Object.keys(SHOP_COPY_MAX).sort());
    for (const [key, text] of Object.entries(SHOP_COPY)) expect(text.trim(), key).not.toBe('');
  });

  it('mọi khoá có ngân sách thì chữ điền giá trị xấu nhất vẫn trong ngân sách', () => {
    for (const [key, max] of Object.entries(SHOP_COPY_MAX)) {
      if (max === null) continue;
      expect(fillCopy(key, WORST).length, key).toBeLessThanOrEqual(max);
    }
  });

  it('không chữ nào dính thuật ngữ cấm hay dấu chấm than', () => {
    for (const [key, text] of Object.entries(SHOP_COPY)) {
      expect(hit(text), key).toEqual([]);
      expect(text, key).not.toContain('!');
    }
  });

  it('chữ chốt ở thiết kế §4 Q5 và Giờ vàng theo kế hoạch', () => {
    expect(SHOP_COPY['rank.title']).toBe('Bán chạy nhất');
    expect(SHOP_COPY['badge.freeship']).toBe('Miễn phí giao hàng');
    expect(SHOP_COPY['badge.loved']).toBe('Được yêu thích');
    expect(SHOP_COPY['badge.featured']).toBe('Tubu chọn');
    expect(SHOP_COPY['coupon.title']).toBe('Mã giảm giá');
    expect(SHOP_COPY['brand.title']).toBe('Thương hiệu');
    expect(SHOP_COPY['stock.out']).toBe('Tạm hết hàng');
    expect(SHOP_COPY['stock.discontinued']).toBe('Ngừng bán');
    expect(fillCopy('flash.endsIn', { t: '02:05:33' })).toBe('Kết thúc sau 02:05:33');
    expect(SHOP_COPY['flash.justOpened']).toBe('Vừa mở bán');
    expect(SHOP_COPY['flash.almostGone']).toBe('Sắp hết');
    expect(SHOP_COPY['flash.soldOut']).toBe('Đã bán hết');
  });
});

describe('FORBIDDEN_TERMS', () => {
  const caught = ['Nhãn hàng', 'Top bán chạy', 'Freeship', 'Kho voucher', 'Flash sale', 'ưu đãi giờ vàng', 'HSD', 'Chỉ còn 3', 'Vui lòng', 'chúng tôi', 'cửa hàng', 'Đang tải...', '2h 05m'];
  const skipped = ['Giờ vàng', 'Bán chạy nhất', 'Topping', 'Miễn phí giao hàng', 'Hạn dùng', 'Còn 3 sản phẩm', 'Đang tải…', 'Gian hàng', 'Mã giảm giá', 'Thương hiệu'];

  it.each(caught)('bắt "%s"', (text) => {
    expect(hit(text).length).toBeGreaterThan(0);
  });

  it.each(skipped)('bỏ qua "%s"', (text) => {
    expect(hit(text)).toEqual([]);
  });

  it('mỗi luật nói chữ nên dùng thay thế', () => {
    for (const t of FORBIDDEN_TERMS) expect(t.use.trim()).not.toBe('');
  });
});

describe('chữ của bộ thành phần section-kit', () => {
  it('chữ chốt cho SectionHeader, SortBar, ComboCard', () => {
    expect(fillCopy('section.seeAll')).toBe('Xem tất cả');
    expect(fillCopy('section.seeAllSpoken', { title: 'Giờ vàng' })).toBe('Xem tất cả Giờ vàng');
    expect(fillCopy('sort.groupLabel')).toBe('Sắp xếp');
    expect(fillCopy('sort.filter')).toBe('Lọc');
    expect(fillCopy('sort.filterCount', { n: 2 })).toBe('Lọc (2)');
    expect(fillCopy('sort.filterSpoken', { n: 2 })).toBe('Lọc, 2 bộ lọc đang bật');
    expect(fillCopy('combo.badge', { pct: 10 })).toBe('Combo -10%');
    expect(fillCopy('combo.setLabel')).toBe('Mua cả bộ');
    expect(fillCopy('combo.save', { save: '36.700đ' })).toBe('Tiết kiệm 36.700đ');
    expect(fillCopy('combo.addSpoken', { title: 'Bếp xanh', n: 3, price: '337.300đ' })).toBe('Thêm cả combo Bếp xanh, 3 món, 337.300đ');
    expect(fillCopy('combo.seeItems')).toBe('Xem từng món');
    expect(fillCopy('combo.itemsLabel', { n: 3 })).toBe('Gồm 3 món');
    expect(fillCopy('combo.more', { n: 2 })).toBe('+2');
  });
});

describe('fillCopy', () => {
  it('thay mọi lần xuất hiện của một biến', () => {
    expect(fillCopy('combo.rule', { n: 2, pct: 5 })).toBe('Mua 2 giảm 5%');
    expect(fillCopy('flash.endsIn', { t: '1' })).toBe('Kết thúc sau 1');
  });

  it('ném lỗi khi khoá lạ', () => {
    expect(() => fillCopy('khong.co.khoa')).toThrow(/khong\.co\.khoa/);
  });

  it('ném lỗi khi thiếu biến, không để lộ "{t}" ra cho khách', () => {
    expect(() => fillCopy('flash.endsIn', {})).toThrow(/\{t\}|\bt\b/);
  });
});
