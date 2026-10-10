import { ValidationPipe } from '@nestjs/common';
import { ProductQuery } from './product-query.dto';
import { SEARCH_Q_MAX_LENGTH, SuggestQuery } from './suggest-query.dto';

// Cùng cấu hình ValidationPipe với main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const as = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'query', metatype, data: undefined });

describe('Giới hạn độ dài từ khoá tìm kiếm (C-038)', () => {
  it('GET /search/suggest: q tới 100 ký tự nhận; dài hơn → 400; thiếu q vẫn nhận (service trả [])', async () => {
    expect(SEARCH_Q_MAX_LENGTH).toBe(100);
    await expect(as(SuggestQuery, { q: 'nước rửa' })).resolves.toMatchObject({ q: 'nước rửa' });
    await expect(as(SuggestQuery, { q: 'a'.repeat(100) })).resolves.toMatchObject({ q: 'a'.repeat(100) });
    await expect(as(SuggestQuery, { q: 'a'.repeat(101) })).rejects.toThrow();
    await expect(as(SuggestQuery, {})).resolves.toEqual({});
  });

  it('q lặp (?q=a&q=b → mảng) bị từ chối thay vì làm sập service', async () => {
    await expect(as(SuggestQuery, { q: ['a', 'b'] })).rejects.toThrow();
  });

  it('GET /products?q= cũng chặn từ khoá dài hơn 100 ký tự', async () => {
    await expect(as(ProductQuery, { q: 'a'.repeat(100) })).resolves.toMatchObject({ q: 'a'.repeat(100) });
    await expect(as(ProductQuery, { q: 'a'.repeat(101) })).rejects.toThrow();
  });
});
