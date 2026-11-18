import { MerchShelfReader } from './merch-shelf-reader';

type Row = { productId: string; startsAt: Date | null; endsAt: Date | null };

function setup(opts: { config?: Record<string, unknown>; rows?: Row[]; withSales?: number; failPins?: boolean; failCount?: boolean } = {}) {
  const findMany = jest.fn(async () => {
    if (opts.failPins) throw new Error('db down');
    return opts.rows ?? [];
  });
  const count = jest.fn(async () => {
    if (opts.failCount) throw new Error('db down');
    return opts.withSales ?? 0;
  });
  const values = opts.config ?? {};
  const get = jest.fn(async (key: string, fallback: unknown) => (key in values ? values[key] : fallback));
  const reader = new MerchShelfReader({ merchShelfPin: { findMany }, product: { count } } as never, { get } as never);
  return { reader, findMany, count, get };
}

describe('MerchShelfReader', () => {
  it('cờ chỉ bật khi đúng giá trị true; không có cấu hình hay đọc lỗi thì tắt', async () => {
    expect(await new MerchShelfReader({} as never).enabled()).toBe(false);
    expect(await setup().reader.enabled()).toBe(false);
    expect(await setup({ config: { 'merch.shelves_enabled': 'true' } }).reader.enabled()).toBe(false);
    expect(await setup({ config: { 'merch.shelves_enabled': 1 } }).reader.enabled()).toBe(false);
    expect(await setup({ config: { 'merch.shelves_enabled': true } }).reader.enabled()).toBe(true);
    const broken = new MerchShelfReader({} as never, { get: jest.fn().mockRejectedValue(new Error('x')) } as never);
    expect(await broken.enabled()).toBe(false);
  });

  it('chỉ trả món trong khung giờ, đọc kệ đúng khoá với điều kiện đang bán và còn hàng, nhớ 60 giây, invalidate thì đọc lại', async () => {
    const now = new Date('2026-11-18T10:00:00Z');
    const rows: Row[] = [
      { productId: 'a', startsAt: null, endsAt: null },
      { productId: 'later', startsAt: new Date('2026-11-18T10:00:30Z'), endsAt: null },
      { productId: 'expired', startsAt: null, endsAt: new Date('2026-11-18T09:00:00Z') },
      { productId: 'b', startsAt: new Date('2026-11-18T09:00:00Z'), endsAt: new Date('2026-11-18T12:00:00Z') },
    ];
    const { reader, findMany } = setup({ rows });
    expect(await reader.livePins('home_featured', now)).toEqual(['a', 'b']);
    const call = (findMany.mock.calls as unknown as [{ where: { shelfKey: string; product: { isActive: boolean; approvalStatus: string; variations: unknown } } }][])[0]![0];
    expect(call.where.shelfKey).toBe('home_featured');
    expect(call.where.product).toMatchObject({ isActive: true, approvalStatus: 'APPROVED', variations: { some: { isActive: true, stock: { gt: 0 } } } });

    // Khung giờ xét lúc đọc, không theo lúc nhớ: tới 10:00:30 món "later" vào kệ mà không đọc lại DB.
    expect(await reader.livePins('home_featured', new Date('2026-11-18T10:00:30Z'))).toEqual(['a', 'later', 'b']);
    expect(findMany).toHaveBeenCalledTimes(1);
    await reader.livePins('home_featured', new Date(now.getTime() + 61_000));
    expect(findMany).toHaveBeenCalledTimes(2);
    reader.invalidate();
    await reader.livePins('home_featured', new Date(now.getTime() + 62_000));
    expect(findMany).toHaveBeenCalledTimes(3);
  });

  it('đọc ghim lỗi thì coi như không có ghim', async () => {
    expect(await setup({ failPins: true }).reader.livePins('home_featured')).toEqual([]);
  });

  it('kệ chọn tay khi số sản phẩm có số bán dưới ngưỡng cấu hình; mặc định 6 sản phẩm có từ 3 lượt', async () => {
    const at = (withSales: number, config?: Record<string, unknown>) => setup({ withSales, config });
    expect(await at(5).reader.isCurated()).toBe(true);
    expect(await at(6).reader.isCurated()).toBe(false);
    const s = at(9, { 'merch.best_seller_min_products': 10, 'merch.best_seller_min_sold': 1 });
    expect(await s.reader.isCurated()).toBe(true);
    expect(s.count).toHaveBeenCalledWith({ where: { isActive: true, approvalStatus: 'APPROVED', soldApp30d: { gte: 1 } } });
    expect(await at(6, { 'merch.best_seller_min_products': 'bad' }).reader.isCurated()).toBe(false);
  });

  it('kết quả ngưỡng nhớ 60 giây; đếm lỗi thì không đổi nhãn (giữ Bán chạy như cũ)', async () => {
    const s = setup({ withSales: 0 });
    expect(await s.reader.isCurated(1_000)).toBe(true);
    expect(await s.reader.isCurated(30_000)).toBe(true);
    expect(s.count).toHaveBeenCalledTimes(1);
    await s.reader.isCurated(62_000);
    expect(s.count).toHaveBeenCalledTimes(2);
    expect(await setup({ failCount: true }).reader.isCurated()).toBe(false);
  });
});
