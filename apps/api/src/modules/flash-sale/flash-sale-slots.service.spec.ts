import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FLASH_LIMIT, FLASH_OVER_LIMIT_MSG, FlashSaleService, flashOverLimitMessage } from './flash-sale.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { LifecycleService } from '../lifecycle/lifecycle.service';

const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
const notifications = { notify: jest.fn() } as unknown as NotificationsService;
const lifecycle = { notifyWishlistPriceDrop: jest.fn() } as unknown as LifecycleService;
const svcWith = (prisma: object) => new FlashSaleService(prisma as unknown as PrismaService, config, notifications, lifecycle);

// 13:00 giờ VN ngày 1/11/2026: khung 12:00 đang chạy, 20:00 sắp tới.
const NOW = new Date('2026-11-01T06:00:00Z');
const at = (iso: string) => new Date(iso);

const slotItem = (over: Record<string, unknown> = {}) => ({
  id: 'fi1', variationId: 'v1', flashPrice: 80_000, quota: 10, soldCount: 3, perUserLimit: 5, sortOrder: 0,
  variation: {
    productId: 'p1', name: '500g', retailPrice: 100_000, salePrice: null, stock: 50,
    product: { slug: 'a', name: 'A', thumbnail: null, categoryIds: ['c1'], _count: { variations: 1 } },
  },
  ...over,
});
const sale = (over: Record<string, unknown> = {}) => ({
  id: 's1', title: 'Khung 12:00', startAt: at('2026-11-01T05:00:00Z'), endAt: at('2026-11-01T07:00:00Z'), isActive: true,
  items: [slotItem()],
  ...over,
});

describe('FlashSaleService.listSlots', () => {
  it('chỉ lấy đợt đang bật, chưa kết thúc, bắt đầu trước 00:00 giờ VN của ngày kia, xếp theo giờ bắt đầu', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await svcWith({ flashSale: { findMany } }).listSlots(NOW);
    const arg = findMany.mock.calls[0][0] as { where: unknown; orderBy: unknown };
    expect(arg.where).toEqual({ isActive: true, endAt: { gt: NOW }, startAt: { lt: at('2026-11-02T17:00:00Z') } });
    expect(arg.orderBy).toEqual([{ startAt: 'asc' }, { id: 'asc' }]);
  });

  it('trả status theo giờ máy chủ, itemCount đếm món còn rẻ hơn giá đang bán, bỏ đợt không còn món nào', async () => {
    const findMany = jest.fn().mockResolvedValue([
      sale({ items: [slotItem(), slotItem({ id: 'fi2', flashPrice: 120_000 })] }),
      sale({ id: 's2', title: 'Khung 20:00', startAt: at('2026-11-01T13:00:00Z'), endAt: at('2026-11-01T15:00:00Z') }),
      sale({ id: 's3', title: 'Đợt rỗng', startAt: at('2026-11-02T05:00:00Z'), endAt: at('2026-11-02T07:00:00Z'), items: [] }),
    ]);
    const res = await svcWith({ flashSale: { findMany } }).listSlots(NOW);
    expect(res.serverNow).toBe(NOW.toISOString());
    expect(res.slots).toEqual([
      { id: 's1', title: 'Khung 12:00', startAt: '2026-11-01T05:00:00.000Z', endAt: '2026-11-01T07:00:00.000Z', status: 'LIVE', itemCount: 1 },
      { id: 's2', title: 'Khung 20:00', startAt: '2026-11-01T13:00:00.000Z', endAt: '2026-11-01T15:00:00.000Z', status: 'UPCOMING', itemCount: 1 },
    ]);
  });

  it('hai lần gọi trong 3 giây chỉ đọc DB một lần và serverNow là của lần gọi sau', async () => {
    const findMany = jest.fn().mockResolvedValue([sale()]);
    const svc = svcWith({ flashSale: { findMany } });
    await svc.listSlots(NOW);
    const second = await svc.listSlots(new Date(NOW.getTime() + 2_000));
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(second.serverNow).toBe(new Date(NOW.getTime() + 2_000).toISOString());
  });

  it('sau 3 giây đọc lại DB; status của khung sát giờ kết thúc không đứng yên theo bản cache', async () => {
    const findMany = jest.fn().mockResolvedValue([sale({ endAt: at('2026-11-01T06:00:02Z') })]);
    const svc = svcWith({ flashSale: { findMany } });
    expect((await svc.listSlots(NOW)).slots).toHaveLength(1);
    const later = await svc.listSlots(new Date(NOW.getTime() + 2_500));
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(later.slots).toEqual([]);
    await svc.listSlots(new Date(NOW.getTime() + 3_500));
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('request đồng thời gom thành một lần đọc DB', async () => {
    const findMany = jest.fn().mockResolvedValue([sale()]);
    const svc = svcWith({ flashSale: { findMany } });
    await Promise.all([svc.listSlots(NOW), svc.listSlots(NOW), svc.listSlots(NOW)]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe('FlashSaleService.listSlotItems', () => {
  const run = (rows: unknown, now = NOW) => {
    const findFirst = jest.fn().mockResolvedValue(rows);
    return { findFirst, call: () => svcWith({ flashSale: { findFirst } }).listSlotItems('s1', now) };
  };

  it('tìm đợt đang bật theo id, lấy món theo SLOT_ITEM_ORDER_BY và chỉ biến thể bán được', async () => {
    const { findFirst, call } = run(sale());
    await call();
    const arg = findFirst.mock.calls[0][0] as { where: unknown; include: { items: { orderBy: unknown; where: unknown } } };
    expect(arg.where).toEqual({ id: 's1', isActive: true });
    expect(arg.include.items.orderBy).toEqual([{ sortOrder: 'asc' }, { flashPrice: 'asc' }, { variationId: 'asc' }, { id: 'asc' }]);
    expect(arg.include.items.where).toEqual({ variation: { isActive: true, product: { isActive: true, approvalStatus: 'APPROVED' } } });
  });

  it('giữ món hết suất (soldOut true) và món hết hàng thật (soldOut true), loại món không còn rẻ hơn giá đang bán', async () => {
    const { call } = run(
      sale({
        items: [
          slotItem({ id: 'ok' }),
          slotItem({ id: 'sold', soldCount: 10 }),
          slotItem({ id: 'nostock', variation: { ...slotItem().variation, stock: 0 } }),
          slotItem({ id: 'dear', flashPrice: 100_000 }),
        ],
      }),
    );
    const res = await call();
    expect(res.items.map((i) => [i.itemId, i.soldOut])).toEqual([['ok', false], ['sold', true], ['nostock', true]]);
    expect(res.slot).toMatchObject({ id: 's1', status: 'LIVE', itemCount: 3 });
  });

  it('thẻ món có đủ trường: tên phân loại chỉ khi sản phẩm nhiều phân loại, categoryIds, perUserLimit, giá', async () => {
    const multi = slotItem({
      variation: { ...slotItem().variation, product: { ...slotItem().variation.product, _count: { variations: 3 } } },
    });
    const res = await run(sale({ items: [multi] })).call();
    expect(res.items[0]).toEqual({
      itemId: 'fi1', variationId: 'v1', variationName: '500g', productId: 'p1', productSlug: 'a', productName: 'A', thumbnail: null,
      categoryIds: ['c1'], flashPrice: 80_000, retailPrice: 100_000, salePrice: null, soldCount: 3, quota: 10, soldOut: false, perUserLimit: 5,
    });
    expect((await run(sale()).call()).items[0]!.variationName).toBeNull();
  });

  it('đợt đã kết thúc thì 200 với status ENDED và items rỗng', async () => {
    const res = await run(sale({ endAt: at('2026-11-01T05:30:00Z') })).call();
    expect(res.slot.status).toBe('ENDED');
    expect(res.slot.itemCount).toBe(0);
    expect(res.items).toEqual([]);
  });

  it('id lạ hoặc đợt đã tắt thì NotFoundException', async () => {
    await expect(run(null).call()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hai lần gọi trong 3 giây chỉ đọc DB một lần, kể cả khi lần đầu là 404', async () => {
    const { findFirst } = run(null);
    const svc = svcWith({ flashSale: { findFirst } });
    await expect(svc.listSlotItems('zzz', NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.listSlotItems('zzz', new Date(NOW.getTime() + 1_000))).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('khoá cache bị kẹp ở 50: id mới đẩy id cũ nhất ra, id cũ phải đọc lại DB', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const svc = svcWith({ flashSale: { findFirst } });
    for (let i = 0; i < 51; i++) await svc.listSlotItems(`id${i}`, NOW).catch(() => undefined);
    expect(findFirst).toHaveBeenCalledTimes(51);
    await svc.listSlotItems('id50', NOW).catch(() => undefined);
    expect(findFirst).toHaveBeenCalledTimes(51);
    await svc.listSlotItems('id0', NOW).catch(() => undefined);
    expect(findFirst).toHaveBeenCalledTimes(52);
  });
});

describe('FlashSaleService.listActive mở rộng', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'fi1', flashSaleId: 's1', variationId: 'v1', flashPrice: 80_000, quota: 10, soldCount: 3, perUserLimit: 5,
    flashSale: { endAt: at('2026-11-01T07:00:00Z'), startAt: at('2026-11-01T05:00:00Z'), title: 'Khung 12:00' },
    variation: { productId: 'p1', name: 'M', retailPrice: 100_000, salePrice: null, product: { slug: 'a', name: 'A', thumbnail: null, _count: { variations: 1 } } },
    ...over,
  });

  it('mỗi dòng có saleId, title, startAt, perUserLimit', async () => {
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue([row()]) } };
    const [first] = await svcWith(prisma).listActive(NOW);
    expect(first).toMatchObject({ saleId: 's1', title: 'Khung 12:00', startAt: at('2026-11-01T05:00:00Z'), perUserLimit: 5 });
  });

  it('limit cắt sau khi đã loại món hết suất; không truyền limit thì giữ đủ', async () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', soldCount: 10 }), row({ id: 'c' }), row({ id: 'd' })];
    const prisma = { flashSaleItem: { findMany: jest.fn().mockResolvedValue(rows) } };
    expect((await svcWith(prisma).listActive(NOW, 2)).map((i) => i.itemId)).toEqual(['a', 'c']);
    expect((await svcWith(prisma).listActive(NOW)).map((i) => i.itemId)).toEqual(['a', 'c', 'd']);
  });
});

describe('FlashSaleService.overLimitError', () => {
  it('đọc perUserLimit của suất trong tx đang mở và ném FLASH_LIMIT kèm câu hoàn chỉnh', async () => {
    const findUnique = jest.fn().mockResolvedValue({ perUserLimit: 5 });
    const tx = { flashSaleItem: { findUnique } };
    const err = await svcWith({}).overLimitError(tx as never, 'fi1');
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'fi1' }, select: { perUserLimit: true } });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      code: FLASH_LIMIT,
      limit: 5,
      message: 'Giá Giờ vàng chỉ áp cho 5 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.',
    });
  });

  it('suất không còn trong tx thì rơi về câu cũ, không báo giới hạn bịa', async () => {
    const tx = { flashSaleItem: { findUnique: jest.fn().mockResolvedValue(null) } };
    const err = await svcWith({}).overLimitError(tx as never, 'gone');
    expect(err.message).toBe(FLASH_OVER_LIMIT_MSG);
  });

  it('flashOverLimitMessage điền số vào câu kế hoạch', () => {
    expect(flashOverLimitMessage(2)).toBe('Giá Giờ vàng chỉ áp cho 2 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.');
    expect(FLASH_LIMIT).toBe('FLASH_LIMIT');
  });
});

describe('FlashSaleService.setItemSortOrder', () => {
  it('ghi sortOrder cho món; món lạ báo lỗi tiếng Việt', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'fi1', sortOrder: 3 });
    const findUnique = jest.fn().mockResolvedValue({ id: 'fi1', flashSale: { createdBy: 'staff1' } });
    const svc = svcWith({ flashSaleItem: { findUnique, update } });
    await svc.setItemSortOrder('fi1', 3);
    expect(update).toHaveBeenCalledWith({ where: { id: 'fi1' }, data: { sortOrder: 3 } });
    findUnique.mockResolvedValue(null);
    await expect(svc.setItemSortOrder('nope', 1)).rejects.toThrow('Không tìm thấy sản phẩm flash.');
  });
});
