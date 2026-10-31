import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BrandProductsQuery } from './brand-products-query.dto';

const check = (q: Record<string, string>) => validate(plainToInstance(BrandProductsQuery, q));

describe('BrandProductsQuery', () => {
  it('mặc định trang 1, 20 món; query chuỗi được đổi sang số', async () => {
    const q = plainToInstance(BrandProductsQuery, {});
    expect([q.page, q.limit, q.sort]).toEqual([1, 20, undefined]);
    expect(await check({ page: '2', limit: '100', sort: 'best_seller_30d' })).toHaveLength(0);
  });

  it('limit quá 100, trang 0 hoặc kiểu sắp xếp lạ bị từ chối', async () => {
    expect(await check({ limit: '101' })).not.toHaveLength(0);
    expect(await check({ page: '0' })).not.toHaveLength(0);
    expect(await check({ sort: 'lung_tung' })).not.toHaveLength(0);
  });

  it('nhận đủ kiểu sắp xếp của danh sách sản phẩm', async () => {
    for (const sort of ['price_asc', 'price_desc', 'newest', 'best_seller', 'best_seller_30d', 'rating']) {
      expect(await check({ sort })).toHaveLength(0);
    }
  });
});
