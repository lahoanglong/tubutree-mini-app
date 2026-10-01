import { ValidationPipe } from '@nestjs/common';
import { ProductQuery } from './product-query.dto';

// Cùng cấu hình ValidationPipe với main.ts — forbidNonWhitelisted: field lạ bị từ chối (400).
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
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

  it('field lạ vẫn bị từ chối — đây là lý do API trước 4b trả 400 cho tham số mới (miniapp phải tự lùi)', async () => {
    await expect(asQuery({ color: 'red' })).rejects.toThrow();
  });
});
