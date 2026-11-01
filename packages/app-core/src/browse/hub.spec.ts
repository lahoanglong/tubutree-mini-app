import { describe, expect, it } from 'vitest';
import { HUB_BRAND_MAX, HUB_BRAND_MIN, HUB_CATEGORY_MAX, HUB_TILE_HEIGHT, hubBestSellers, hubBrands, hubPlaceholderTiles } from './hub';

const brand = (name: string, count: number) => ({ brand: name, count });
const item = (id: string) => ({ id });

describe('hubBrands', () => {
  it('sắp theo số sản phẩm giảm dần rồi tên, cắt 12', () => {
    const list = Array.from({ length: 20 }, (_, i) => brand(`B${String(i).padStart(2, '0')}`, i % 5));
    const out = hubBrands(list);
    expect(out).toHaveLength(HUB_BRAND_MAX);
    expect(out[0]!.count).toBe(4);
    expect(out.map((b) => b.count)).toEqual([...out.map((b) => b.count)].sort((a, b) => b - a));
  });

  it('dưới 4 nhãn hoặc thiếu dữ liệu: ẩn cả khối', () => {
    expect(hubBrands([brand('A', 1), brand('B', 1), brand('C', 1)])).toEqual([]);
    expect(hubBrands(undefined)).toEqual([]);
    expect(hubBrands(Array.from({ length: HUB_BRAND_MIN }, (_, i) => brand(`B${i}`, 1)))).toHaveLength(HUB_BRAND_MIN);
  });

  it('không đổi mảng đầu vào', () => {
    const list = [brand('B', 1), brand('A', 9), brand('C', 3), brand('D', 2)];
    hubBrands(list);
    expect(list.map((b) => b.brand)).toEqual(['B', 'A', 'C', 'D']);
  });
});

describe('hubBestSellers', () => {
  it('12 món cắt còn 10', () => {
    expect(hubBestSellers(Array.from({ length: 12 }, (_, i) => item(`p${i}`)))).toHaveLength(10);
  });

  it('dưới 3 món: kệ ẩn (không để tiêu đề trơ)', () => {
    expect(hubBestSellers([item('a'), item('b')])).toEqual([]);
    expect(hubBestSellers(undefined)).toEqual([]);
  });

  it('trùng id chỉ tính một lần', () => {
    expect(hubBestSellers([item('a'), item('a'), item('b'), item('c')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

it('hub tối đa 8 danh mục gốc (≤8 cha theo thiết kế)', () => {
  expect(HUB_CATEGORY_MAX).toBe(8);
});

describe('hubPlaceholderTiles', () => {
  it('đếm số ô thật sẽ vẽ (trần 8) cộng ô "Tất cả", không vượt khi lần tải trước nhiều hơn trần', () => {
    expect(hubPlaceholderTiles(4)).toBe(5);
    expect(hubPlaceholderTiles(HUB_CATEGORY_MAX)).toBe(HUB_CATEGORY_MAX + 1);
    expect(hubPlaceholderTiles(12)).toBe(HUB_CATEGORY_MAX + 1);
    expect(hubPlaceholderTiles(24)).toBe(HUB_CATEGORY_MAX + 1);
  });

  it('số hỏng hoặc 0 vẫn còn ô "Tất cả"', () => {
    expect(hubPlaceholderTiles(0)).toBe(1);
    expect(hubPlaceholderTiles(-3)).toBe(1);
    expect(hubPlaceholderTiles(Number.NaN)).toBe(1);
  });

  it('chiều cao ô đặt chỗ cho nhãn 2 dòng, lớn hơn vùng chạm tối thiểu', () => {
    expect(HUB_TILE_HEIGHT).toBe(8 + 40 + 6 + 2 * 20 + 8);
    expect(HUB_TILE_HEIGHT).toBeGreaterThanOrEqual(88);
  });
});
