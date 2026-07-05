import { FlashSaleService } from './flash-sale.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
const NOW = new Date('2026-07-05T10:00:00Z');
const activeItem = (over: Record<string, unknown> = {}) => ({
  id: 'fi1', variationId: 'v1', flashPrice: 80000, quota: 10, soldCount: 3,
  flashSale: { endAt: new Date('2026-07-05T12:00:00Z') },
  ...over,
});

describe('FlashSaleService.resolveEffective', () => {
  it('variation có flash ACTIVE còn quota → trả flashPrice + metadata', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([activeItem()]) } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config).resolveEffective(['v1'], NOW);
    expect(map.get('v1')).toMatchObject({ flashPrice: 80000, itemId: 'fi1', soldCount: 3, quota: 10 });
  });

  it('item hết quota (soldCount>=quota) → không có trong map', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([activeItem({ soldCount: 10 })]) } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config).resolveEffective(['v1'], NOW);
    expect(map.has('v1')).toBe(false);
  });

  it('variation không có item active → không có trong map', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config).resolveEffective(['v9'], NOW);
    expect(map.has('v9')).toBe(false);
  });

  it('variationIds rỗng → map rỗng, KHÔNG query', async () => {
    const findMany = jest.fn();
    const prisma = { flashSaleItem: { findMany } } as unknown as PrismaService;
    const map = await new FlashSaleService(prisma, config).resolveEffective([], NOW);
    expect(map.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('FlashSaleService.listActive', () => {
  it('trả item active còn quota kèm giá + endAt', async () => {
    const row = {
      id: 'fi1', variationId: 'v1', flashPrice: 80000, quota: 10, soldCount: 3,
      flashSale: { endAt: new Date('2026-07-05T12:00:00Z') },
      variation: { retailPrice: 100000, product: { slug: 'a', name: 'A', thumbnail: null } },
    };
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([row]) } } as unknown as PrismaService;
    const list = await new FlashSaleService(prisma, config).listActive(NOW);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ itemId: 'fi1', flashPrice: 80000, retailPrice: 100000, productSlug: 'a' });
  });
});
