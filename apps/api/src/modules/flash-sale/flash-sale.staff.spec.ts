import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FlashSaleService } from './flash-sale.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { LifecycleService } from '../lifecycle/lifecycle.service';

const cfg = (over: Record<string, unknown> = {}) =>
  ({ get: async <T>(k: string, fb?: T): Promise<T> => (k in over ? over[k] : fb) as T }) as unknown as SystemConfigService;
const notifications = { notify: jest.fn() } as unknown as NotificationsService;
const lifecycle = {} as unknown as LifecycleService;
const NOW = new Date('2026-07-05T10:00:00Z');

const STAFF = { id: 'm1', staff: true };
const ADMIN = { id: 'a1', staff: false };

/** Đợt do `createdBy` tạo; người tạo có vai trò `creatorRole`. Giá niêm yết 100.000đ, tồn 1.000. */
function setup(opts: { createdBy?: string | null; creatorRole?: 'STAFF' | 'ADMIN'; used?: number; price?: number } = {}) {
  const { createdBy = 'm1', creatorRole = 'STAFF', used = 0, price = 100_000 } = opts;
  const sale = {
    id: 's1',
    createdBy,
    createdAt: new Date('2026-07-05T03:00:00Z'),
    startAt: new Date('2026-07-05T09:00:00Z'),
    endAt: new Date('2026-07-05T12:00:00Z'),
    items: [],
  };
  const prisma = {
    flashSale: {
      findUnique: jest.fn().mockResolvedValue(sale),
      findUniqueOrThrow: jest.fn().mockResolvedValue(sale),
      update: jest.fn().mockResolvedValue({ id: 's1' }),
      delete: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn().mockResolvedValue(createdBy ? { id: createdBy, role: creatorRole } : null) },
    variation: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', retailPrice: price, salePrice: null, stock: 1_000 }) },
    flashSaleItem: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'fi1' }),
      findUnique: jest.fn().mockResolvedValue({ soldCount: 0, flashSale: { createdBy } }),
      delete: jest.fn().mockResolvedValue({}),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ used: BigInt(used) }]),
    $transaction: jest.fn(),
  } as any;
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const svc = (config: SystemConfigService = cfg()) => new FlashSaleService(prisma as PrismaService, config, notifications, lifecycle);
  return { prisma, svc };
}

describe('FlashSaleService.addItem — nhân viên (D2-01)', () => {
  it('nhân viên thêm item giảm 50% → 400 nêu trần %, không tạo', async () => {
    const { prisma, svc } = setup();
    const p = svc().addItem('s1', { variationId: 'v1', flashPrice: 50_000, quota: 5, perUserLimit: 1 }, STAFF);
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc().addItem('s1', { variationId: 'v1', flashPrice: 50_000, quota: 5, perUserLimit: 1 }, STAFF)).rejects.toThrow(
      /tối đa 30%.*nhờ quản trị viên/,
    );
    expect(prisma.flashSaleItem.create).not.toHaveBeenCalled();
  });

  it('trần % đọc từ coupon.staff_max_percent; đúng trần thì được', async () => {
    const { prisma, svc } = setup();
    await expect(
      svc(cfg({ 'coupon.staff_max_percent': 10 })).addItem('s1', { variationId: 'v1', flashPrice: 89_000, quota: 5, perUserLimit: 1 }, STAFF),
    ).rejects.toThrow('tối đa 10%');
    await svc(cfg({ 'coupon.staff_max_percent': 10 })).addItem('s1', { variationId: 'v1', flashPrice: 90_000, quota: 5, perUserLimit: 1 }, STAFF);
    expect(prisma.flashSaleItem.create).toHaveBeenCalledTimes(1);
  });

  it('(giá gốc − giá flash) × perUserLimit vượt coupon.staff_max_amount_vnd → 400', async () => {
    const { prisma, svc } = setup({ price: 500_000 });
    // 10% = 50.000đ mỗi cái, 3 cái mỗi khách = 150.000đ > 100.000đ
    await expect(svc().addItem('s1', { variationId: 'v1', flashPrice: 450_000, quota: 5, perUserLimit: 3 }, STAFF)).rejects.toThrow(
      /100\.000đ/,
    );
    // perUserLimit bỏ trống lấy mặc định 5 → 250.000đ
    await expect(svc().addItem('s1', { variationId: 'v1', flashPrice: 450_000, quota: 5 }, STAFF)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.flashSaleItem.create).not.toHaveBeenCalled();
    await svc().addItem('s1', { variationId: 'v1', flashPrice: 450_000, quota: 5, perUserLimit: 2 }, STAFF);
    expect(prisma.flashSaleItem.create).toHaveBeenCalledTimes(1);
  });

  it('ngân sách ngày: đã dùng + (giá gốc − giá flash) × quota vượt coupon.staff_daily_budget_vnd → 400 nói còn bao nhiêu', async () => {
    // 20.000đ × 200 = 4.000.000đ
    const ok = setup({ used: 5_000_000 });
    await ok.svc().addItem('s1', { variationId: 'v1', flashPrice: 80_000, quota: 200, perUserLimit: 1 }, STAFF);
    expect(ok.prisma.flashSaleItem.create).toHaveBeenCalledTimes(1);
    expect(ok.prisma.$executeRaw.mock.calls.flatMap((c: unknown[]) => c.slice(1))).toContain('coupon.staff_budget:m1');

    const over = setup({ used: 7_000_000 });
    const call = () => over.svc().addItem('s1', { variationId: 'v1', flashPrice: 80_000, quota: 200, perUserLimit: 1 }, STAFF);
    await expect(call()).rejects.toBeInstanceOf(BadRequestException);
    await expect(call()).rejects.toThrow(/còn 3\.000\.000đ/);
    expect(over.prisma.flashSaleItem.create).not.toHaveBeenCalled();

    const small = setup({ used: 0 });
    await expect(
      small.svc(cfg({ 'coupon.staff_daily_budget_vnd': 1_000_000 })).addItem('s1', { variationId: 'v1', flashPrice: 80_000, quota: 51, perUserLimit: 1 }, STAFF),
    ).rejects.toThrow('còn 1.000.000đ');
  });

  it('ADMIN thêm item giảm 90%, quota lớn, perUserLimit lớn vẫn được; không khoá, không tính ngân sách', async () => {
    const { prisma, svc } = setup({ createdBy: 'a1', creatorRole: 'ADMIN', used: 1_000_000_000 });
    await svc().addItem('s1', { variationId: 'v1', flashPrice: 10_000, quota: 1_000, perUserLimit: 200 }, ADMIN);
    expect(prisma.flashSaleItem.create).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('không truyền actor (job/seed) cũng không bị trần', async () => {
    const { prisma, svc } = setup({ createdBy: 'a1', creatorRole: 'ADMIN' });
    await svc().addItem('s1', { variationId: 'v1', flashPrice: 10_000, quota: 5 });
    expect(prisma.flashSaleItem.create).toHaveBeenCalledTimes(1);
  });
});

describe('FlashSaleService — nhân viên không đụng đợt của quản trị viên (D2-05)', () => {
  const adminSale = () => setup({ createdBy: 'a1', creatorRole: 'ADMIN' });
  const adminOnly = /quản trị viên/;

  it('PATCH đợt của ADMIN → 403, không ghi', async () => {
    const { prisma, svc } = adminSale();
    await expect(svc().updateSale('s1', { isActive: false }, STAFF)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc().updateSale('s1', { endAt: '2026-08-01T00:00:00Z' }, STAFF)).rejects.toThrow(adminOnly);
    expect(prisma.flashSale.update).not.toHaveBeenCalled();
  });

  it('xoá đợt, thêm item, xoá item của đợt ADMIN → 403', async () => {
    const { prisma, svc } = adminSale();
    await expect(svc().deleteSale('s1', STAFF)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc().addItem('s1', { variationId: 'v1', flashPrice: 90_000, quota: 5, perUserLimit: 1 }, STAFF)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc().removeItem('fi1', STAFF)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.flashSale.delete).not.toHaveBeenCalled();
    expect(prisma.flashSaleItem.create).not.toHaveBeenCalled();
    expect(prisma.flashSaleItem.delete).not.toHaveBeenCalled();
  });

  it('đợt không rõ người tạo (createdBy rỗng hoặc tài khoản đã xoá) cũng thuộc quản trị viên', async () => {
    const { svc } = setup({ createdBy: null });
    await expect(svc().updateSale('s1', { isActive: true }, STAFF)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('nhân viên sửa/xoá đợt do nhân viên tạo thì được', async () => {
    const { prisma, svc } = setup();
    await svc().updateSale('s1', { isActive: false }, STAFF);
    expect(prisma.flashSale.update).toHaveBeenCalledTimes(1);
    await svc().removeItem('fi1', STAFF);
    expect(prisma.flashSaleItem.delete).toHaveBeenCalledTimes(1);
  });

  it('ADMIN sửa đợt của chính mình hay của nhân viên đều được', async () => {
    const mine = adminSale();
    await mine.svc().updateSale('s1', { isActive: false }, ADMIN);
    expect(mine.prisma.flashSale.update).toHaveBeenCalledTimes(1);
    const theirs = setup();
    await theirs.svc().deleteSale('s1', ADMIN).catch(() => undefined);
    expect(theirs.prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('FlashSaleService.resolveEffective — người tạo đợt không được giá flash của đợt mình (D2-01)', () => {
  const item = (createdBy: string) => ({
    id: 'fi1', variationId: 'v1', flashPrice: 50_000, quota: 10, soldCount: 0, perUserLimit: 2,
    flashSale: { endAt: new Date('2026-07-05T12:00:00Z'), createdBy },
  });
  const svcWith = (createdBy: string) => {
    const prisma = {
      flashSaleItem: { findMany: jest.fn().mockResolvedValue([item(createdBy)]) },
      flashSalePurchase: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    return new FlashSaleService(prisma, cfg(), notifications, lifecycle);
  };

  it('người mua chính là người tạo đợt → không có giá flash (tính giá thường)', async () => {
    expect((await svcWith('m1').resolveEffective(['v1'], NOW, 'm1')).has('v1')).toBe(false);
  });

  it('khách khác vẫn có giá flash; tra không theo người mua (trang chủ) không đổi', async () => {
    expect((await svcWith('m1').resolveEffective(['v1'], NOW, 'u2')).get('v1')).toMatchObject({ flashPrice: 50_000, allowance: 2 });
    expect((await svcWith('m1').resolveEffective(['v1'], NOW)).has('v1')).toBe(true);
  });
});
