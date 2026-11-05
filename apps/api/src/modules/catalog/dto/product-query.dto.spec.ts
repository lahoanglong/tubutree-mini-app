import { createValidationPipe } from '../../../common/validation-pipe';
import { PRODUCT_SLUG_MAX, PRODUCT_SLUGS_LIST_MAX, PRODUCT_SLUGS_QUERY_MAX_CHARS } from '@tubutree/shared-types';
import { ProductQuery } from './product-query.dto';

// Cùng cấu hình ValidationPipe với main.ts — forbidNonWhitelisted: field lạ bị từ chối (400).
const pipe = createValidationPipe();
const asQuery = (value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'query', metatype: ProductQuery, data: undefined });

describe('ProductQuery (dự án 4b)', () => {
  it('tham số cũ vẫn nhận như trước (web shop, miniapp cũ)', async () => {
    await expect(asQuery({ brand: 'Tubu', q: 'nước', sort: 'best_seller', page: '2', limit: '30' })).resolves.toMatchObject({
      brand: 'Tubu', q: 'nước', sort: 'best_seller', page: 2, limit: 30,
    });
  });

  it('minPrice/maxPrice/minRating ép sang số; inStock "true"/"1" → true, "false"/"0" → false', async () => {
    await expect(asQuery({ minPrice: '100000', maxPrice: '200000', minRating: '4', inStock: 'true' })).resolves.toMatchObject({
      minPrice: 100000, maxPrice: 200000, minRating: 4, inStock: true,
    });
    await expect(asQuery({ inStock: '1' })).resolves.toMatchObject({ inStock: true });
    await expect(asQuery({ inStock: 'false' })).resolves.toMatchObject({ inStock: false });
    await expect(asQuery({ inStock: '0' })).resolves.toMatchObject({ inStock: false });
  });

  it('không truyền tham số mới → không có field nào bị gán mặc định', async () => {
    const q = (await asQuery({})) as ProductQuery;
    expect(q.minPrice).toBeUndefined();
    expect(q.maxPrice).toBeUndefined();
    expect(q.inStock).toBeUndefined();
    expect(q.minRating).toBeUndefined();
  });

  it('từ chối giá âm / lẻ / chữ, minRating ngoài 0..5, inStock lạ', async () => {
    await expect(asQuery({ minPrice: '-1' })).rejects.toThrow();
    await expect(asQuery({ maxPrice: '12.5' })).rejects.toThrow();
    await expect(asQuery({ minPrice: 'abc' })).rejects.toThrow();
    await expect(asQuery({ minRating: '6' })).rejects.toThrow();
    await expect(asQuery({ inStock: 'yes' })).rejects.toThrow();
  });

  it('slugs nhận đủ 20 slug dài PRODUCT_SLUG_MAX (dải "Đã xem gần đây"), từ chối khi có hơn 20 phần tử hoặc chuỗi vượt PRODUCT_SLUGS_QUERY_MAX_CHARS', async () => {
    const slug = (i: number) => `${String(i).padStart(2, '0')}${'x'.repeat(PRODUCT_SLUG_MAX - 2)}`;
    const twenty = Array.from({ length: PRODUCT_SLUGS_LIST_MAX }, (_, i) => slug(i)).join(',');
    expect(twenty.length).toBe(PRODUCT_SLUGS_QUERY_MAX_CHARS - 1);
    await expect(asQuery({ slugs: twenty })).resolves.toMatchObject({ slugs: twenty });
    const twentyOne = Array.from({ length: PRODUCT_SLUGS_LIST_MAX + 1 }, (_, i) => `s${i}`).join(',');
    await expect(asQuery({ slugs: twentyOne })).rejects.toMatchObject({ response: { message: [expect.stringMatching(/^Danh sách sản phẩm chỉ nhận tối đa 20 mục/)] } });
    await expect(asQuery({ slugs: 'x'.repeat(PRODUCT_SLUGS_QUERY_MAX_CHARS + 1) })).rejects.toThrow();
  });
  it('slugs nhận chuỗi slug cách nhau bằng dấu phẩy, từ chối chuỗi quá dài', async () => {
    await expect(asQuery({ slugs: 'a,b,c' })).resolves.toMatchObject({ slugs: 'a,b,c' });
    await expect(asQuery({ slugs: 'x'.repeat(PRODUCT_SLUGS_QUERY_MAX_CHARS + 1) })).rejects.toThrow();
  });

  it('field lạ vẫn bị từ chối — đây là lý do API trước 4b trả 400 cho tham số mới (miniapp phải tự lùi)', async () => {
    await expect(asQuery({ color: 'red' })).rejects.toThrow();
  });

  describe('seed (Gợi ý hôm nay)', () => {
    it('nhận ngày YYYYMMDD', async () => {
      await expect(asQuery({ seed: '20261101' })).resolves.toMatchObject({ seed: '20261101' });
    });
    it.each(['2026-11-01', '1234567', 'abc', '20261399', ''])('từ chối seed rác %p', async (seed) => {
      await expect(asQuery({ seed })).rejects.toBeDefined();
    });
    it('không truyền thì không có field seed', async () => {
      expect(((await asQuery({})) as ProductQuery).seed).toBeUndefined();
    });
  });
});
