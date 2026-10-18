import { describe, expect, it } from 'vitest';
import { buildCatalogRedirects } from './catalog-redirects.mjs';

// Danh mục chuyển từ "/" sang /san-pham; URL "/?q=", "/?category=", "/?brand=" đã được lập chỉ mục và đã chia sẻ nên phải còn dùng được.
describe('buildCatalogRedirects', () => {
  const rows = buildCatalogRedirects();

  const hostRule = (r: (typeof rows)[number]) => new RegExp((r.missing as { value: string }[])[0]!.value);

  it('mỗi khoá tìm/lọc/phân trang cũ của trang chủ có một dòng 307 từ "/" sang /san-pham, chỉ khi URL có khoá đó', () => {
    expect(rows.map((r) => [r.source, r.has, r.destination, r.permanent])).toEqual(
      ['q', 'category', 'brand', 'page'].map((key) => ['/', [{ type: 'query', key }], '/san-pham', false]),
    );
  });

  it('bỏ qua host gian hàng CTV: ở đó middleware rewrite "/" sang /s/<slug>, chuyển hướng sẽ làm mất gian hàng', () => {
    for (const r of rows) {
      expect(r.missing).toEqual([{ type: 'host', value: expect.any(String) }]);
      const re = hostRule(r);
      expect(re.test('ctv-an.tubutree.com')).toBe(true);
      expect(re.test('ctv-an.localhost')).toBe(true);
      expect(re.test('tubutree.com')).toBe(false);
      expect(re.test('www.tubutree.com')).toBe(false);
      expect(re.test('app.tubutree.com')).toBe(false);
      expect(re.test('localhost')).toBe(false);
      expect(re.test('du-an.vercel.app')).toBe(false);
      expect(re.test('a.b.tubutree.com')).toBe(false);
    }
  });

  it('gốc tenant tuỳ biến (staging) được dùng cho nhận diện host', () => {
    const re = hostRule(buildCatalogRedirects('staging.tubutree.com')[0]!);
    expect(re.test('ctv-an.staging.tubutree.com')).toBe(true);
    expect(re.test('ctv-an.tubutree.com')).toBe(false);
  });

  it('chuyển tạm thời (307), không vĩnh viễn: trang chủ sẽ có lại nội dung riêng', () => {
    expect(rows.every((r) => r.permanent === false)).toBe(true);
  });

  it('đích không mang query riêng: Next giữ nguyên query gốc (q, brand, page, utm, ref, s)', () => {
    expect(rows.every((r) => !r.destination.includes('?'))).toBe(true);
  });
});
