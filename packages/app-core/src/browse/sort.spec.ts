import { describe, expect, it } from 'vitest';
import { browseSortOptions, sortForTab, sortTab } from './sort';

describe('sortTab', () => {
  it('gom hai chiều giá vào một tab, 30 ngày vào Bán chạy', () => {
    expect(sortTab('price_asc')).toBe('price');
    expect(sortTab('price_desc')).toBe('price');
    expect(sortTab('best_seller')).toBe('best_seller');
    expect(sortTab('best_seller_30d')).toBe('best_seller');
    expect(sortTab('newest')).toBe('newest');
    expect(sortTab(undefined)).toBe('default');
  });
});

describe('sortForTab', () => {
  it('chạm tab giá lần đầu: thấp → cao; chạm lại thì đảo chiều', () => {
    expect(sortForTab(undefined, 'price')).toBe('price_asc');
    expect(sortForTab('newest', 'price')).toBe('price_asc');
    expect(sortForTab('price_asc', 'price')).toBe('price_desc');
    expect(sortForTab('price_desc', 'price')).toBe('price_asc');
  });

  it('các tab còn lại ghi sort cố định; Phổ biến bỏ sort', () => {
    expect(sortForTab('newest', 'default')).toBeUndefined();
    expect(sortForTab(undefined, 'best_seller')).toBe('best_seller');
    expect(sortForTab(undefined, 'newest')).toBe('newest');
  });
});

describe('browseSortOptions', () => {
  it('nhãn mặc định: Phổ biến · Bán chạy · Mới · Giá ⇅', () => {
    const o = browseSortOptions(undefined, false);
    expect(o.map((x) => x.label)).toEqual(['Phổ biến', 'Bán chạy', 'Mới', 'Giá ⇅']);
    expect(o.map((x) => x.value)).toEqual(['default', 'best_seller', 'newest', 'price']);
  });

  it('có từ khoá: tab đầu là Liên quan', () => {
    expect(browseSortOptions(undefined, true)[0]!.label).toBe('Liên quan');
  });

  it('tab giá đang chọn nói rõ chiều (UC-05: không để "Giá giảm" đọc thành đang giảm giá)', () => {
    const asc = browseSortOptions('price_asc', false).find((x) => x.value === 'price')!;
    const desc = browseSortOptions('price_desc', false).find((x) => x.value === 'price')!;
    expect(asc.label).toBe('Giá thấp');
    expect(asc.spoken).toMatch(/từ thấp đến cao/);
    expect(desc.label).toBe('Giá cao');
    expect(desc.spoken).toMatch(/từ cao đến thấp/);
    expect(browseSortOptions(undefined, false).find((x) => x.value === 'price')!.spoken).toBeTruthy();
  });
});
