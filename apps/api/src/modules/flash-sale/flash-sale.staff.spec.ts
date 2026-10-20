import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FlashSaleService } from './flash-sale.service';
import { priceFlashLine } from './flash-line-price';
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
function setup(opts: { createdBy?: string | null; creatorRole?: 'STAFF' | 'ADMIN'; used?: number; exposure?: number; price?: number } = {}) {
  const { createdBy = 'm1', creatorRole = 'STAFF', used = 0, exposure = 0, price = 100_000 } = opts;
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
    $queryRaw: jest.fn().mockResolvedValue([{ used: BigInt(used), exposure: BigInt(exposure) }]),
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

  it('nhân viên khác thêm vào đợt của m1: ngân sách và khoá tính theo người tạo đợt (m1), không theo người thêm (m2)', async () => {
    const { prisma, svc } = setup({ createdBy: 'm1', used: 7_000_000 });
    const other = { id: 'm2', staff: true };
    // 20.000đ × 200 = 4.000.000đ; phần đã dùng đọc là của m1 nên 7.000.000 + 4.000.000 > 10.000.000
    await expect(svc().addItem('s1', { variationId: 'v1', flashPrice: 80_000, quota: 200, perUserLimit: 1 }, other)).rejects.toThrow('Vượt ngân sách');
    expect(prisma.flashSaleItem.create).not.toHaveBeenCalled();
    const lockKeys = prisma.$executeRaw.mock.calls.flatMap((c: unknown[]) => c.slice(1));
    expect(lockKeys).toContain('coupon.staff_budget:m1');
    expect(lockKeys).not.toContain('coupon.staff_budget:m2');
    const queryValues = prisma.$queryRaw.mock.calls.flatMap((c: unknown[]) => c.slice(1));
    expect(queryValues).toContain('m1');
    expect(queryValues).not.toContain('m2');
  });

  it('trần 100.000đ tính theo ĐƠN: tổng mức giảm tối đa của các sản phẩm flash cùng người tạo, cùng khung giờ, không theo từng dòng', async () => {
    // Giá gốc 200.000đ: dòng này giảm 25% = 50.000đ × 1 suất (trong trần dòng) nhưng các dòng khác đang chạy đã có 60.000đ → một đơn mua đủ
    // các dòng được giảm 110.000đ.
    const over = setup({ exposure: 60_000, price: 200_000 });
    const call = () => over.svc().addItem('s1', { variationId: 'v1', flashPrice: 150_000, quota: 5, perUserLimit: 1 }, STAFF);
    await expect(call()).rejects.toBeInstanceOf(BadRequestException);
    await expect(call()).rejects.toThrow(/Một đơn.*100\.000đ.*60\.000đ.*50\.000đ.*nhờ quản trị viên/);
    expect(over.prisma.flashSaleItem.create).not.toHaveBeenCalled();

    const ok = setup({ exposure: 50_000, price: 200_000 });
    await ok.svc().addItem('s1', { variationId: 'v1', flashPrice: 150_000, quota: 5, perUserLimit: 1 }, STAFF);
    expect(ok.prisma.flashSaleItem.create).toHaveBeenCalledTimes(1);
  });

  it('trần theo đơn đọc coupon.staff_max_amount_vnd và khoá theo người tạo để hai lần thêm song song không cùng lọt', async () => {
    const { prisma, svc } = setup({ exposure: 20_000 });
    await expect(
      svc(cfg({ 'coupon.staff_max_amount_vnd': 60_000 })).addItem('s1', { variationId: 'v1', flashPrice: 70_000, quota: 5, perUserLimit: 1 }, STAFF),
    ).resolves.toBeDefined();
    const lockKeys = prisma.$executeRaw.mock.calls.flatMap((c: unknown[]) => c.slice(1));
    expect(lockKeys).toContain('flash.staff_order_cap:m1');
    // 20.000 + 30.000 = 50.000 ≤ 60.000 ở trên; 31.000 + 30.000 = 61.000 thì vượt.
    const tight = setup({ exposure: 31_000 });
    await expect(
      tight.svc(cfg({ 'coupon.staff_max_amount_vnd': 60_000 })).addItem('s1', { variationId: 'v1', flashPrice: 70_000, quota: 5, perUserLimit: 1 }, STAFF),
    ).rejects.toThrow(/60\.000đ/);
  });

  it('ADMIN thêm item giảm 90%, quota lớn, perUserLimit lớn vẫn được; không khoá, không tính ngân sách', async () => {
    const { prisma, svc } = setup({ createdBy: 'a1', creatorRole: 'ADMIN', used: 1_000_000_000 });
    await svc().addItem('s1', { variationId: 'v1', flashPrice: 10_000, quota: 1_000, perUserLimit: 200 }, ADMIN);
    expect(prisma.flashSaleItem.create).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('không truyền actor (job/seed) cũng không bị trần', async () => {
    const { prisma, svc } = setup({ createdBy: 'a1', creatorRole: 'ADMIN' });
    await svc().addItem('s1', { variationId: 'v1', flashPrice: 10_000, quota: 5 });
    expect(prisma.flashSaleItem.create).toHaveBeenCalledTimes(1);
  });
});

describe('FlashSaleService.updateSale — dời giờ không được làm hai đợt cùng người tạo chồng giờ vượt trần đơn', () => {
  const extend = { endAt: '2026-07-05T14:00:00Z' };
  const ADMIN_ACTOR = { id: 'a1', staff: false };
  // Đợt trong setup() chạy 09:00–12:00; ghim 08:00 để đợt chưa bắt đầu (dời được cả giờ bắt đầu lẫn giờ kết thúc).
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-05T08:00:00Z').getTime()));
  afterEach(() => jest.restoreAllMocks());

  const exposures = (prisma: { $queryRaw: jest.Mock }, before: number, after: number) => {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockResolvedValueOnce([{ exposure: BigInt(before) }]).mockResolvedValueOnce([{ exposure: BigInt(after) }]);
  };

  it('nhân viên kéo dài đợt cho chồng giờ đợt khác, tổng giảm một đơn tăng lên vượt 100.000đ → 400, không ghi', async () => {
    const { prisma, svc } = setup();
    exposures(prisma, 90_000, 160_000);
    const call = () => svc().updateSale('s1', extend, STAFF);
    await expect(call()).rejects.toBeInstanceOf(BadRequestException);
    exposures(prisma, 90_000, 160_000);
    await expect(call()).rejects.toThrow(/Một đơn mua đủ.*100\.000đ.*160\.000đ.*nhờ quản trị viên/);
    expect(prisma.flashSale.update).not.toHaveBeenCalled();
  });

  it('đợt đã kết thúc: câu tính mức giảm không đếm đợt khác khi khung [từ, đến) rỗng (không thổi phồng mức "trước" để lách trần)', async () => {
    const { prisma, svc } = setup();
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-05T13:00:00Z').getTime());
    await svc().updateSale('s1', { endAt: '2026-07-06T00:00:00Z' }, ADMIN_ACTOR).catch(() => undefined);
    const sqls = prisma.$queryRaw.mock.calls.map((c: unknown[]) => (c[0] as readonly string[]).join('?').replace(/\s+/g, ' '));
    expect(sqls.length).toBeGreaterThan(0);
    for (const sql of sqls) expect(sql).toMatch(/"startAt" < \? AND fs\."endAt" > \? AND \? < \?/);
  });

  it('đợt đã vượt trần từ trước (admin thêm dòng): PATCH không làm tăng mức giảm (thu hẹp giờ, giữ nguyên) vẫn được', async () => {
    const shrink = setup();
    exposures(shrink.prisma, 160_000, 160_000);
    await shrink.svc().updateSale('s1', { endAt: '2026-07-05T11:00:00Z' }, ADMIN_ACTOR);
    expect(shrink.prisma.flashSale.update).toHaveBeenCalledTimes(1);

    const lower = setup();
    exposures(lower.prisma, 160_000, 120_000);
    await lower.svc().updateSale('s1', { endAt: '2026-07-05T11:00:00Z' }, STAFF);
    expect(lower.prisma.flashSale.update).toHaveBeenCalledTimes(1);
  });

  it('đợt đã vượt trần mà PATCH làm tăng thêm dù chỉ một chút thì vẫn bị chặn', async () => {
    const { prisma, svc } = setup();
    exposures(prisma, 160_000, 160_001);
    await expect(svc().updateSale('s1', extend, STAFF)).rejects.toThrow(/Một đơn mua đủ/);
    expect(prisma.flashSale.update).not.toHaveBeenCalled();
  });

  it('đúng trần thì được; ghi và tính tổng cùng một giao dịch, khoá theo người tạo đợt', async () => {
    const { prisma, svc } = setup({ exposure: 100_000 });
    await svc().updateSale('s1', extend, STAFF);
    expect(prisma.flashSale.update).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.calls.flatMap((c: unknown[]) => c.slice(1))).toContain('flash.staff_order_cap:m1');
  });

  it('quản trị viên dời giờ đợt của nhân viên cũng bị trần đơn của nhân viên đó', async () => {
    const { prisma, svc } = setup();
    exposures(prisma, 90_000, 160_000);
    const err = await svc().updateSale('s1', { startAt: '2026-07-05T09:30:00Z' }, ADMIN_ACTOR).catch((e: Error) => e);
    expect(String((err as Error).message)).toMatch(/Một đơn mua đủ/);
    expect(String((err as Error).message)).not.toMatch(/nhờ quản trị viên/);
    expect(prisma.flashSale.update).not.toHaveBeenCalled();
  });

  it('đợt của quản trị viên và chỉ đổi tên/bật tắt: không khoá, không tính trần', async () => {
    const adminSale = setup({ createdBy: 'a1', creatorRole: 'ADMIN' });
    await adminSale.svc().updateSale('s1', extend, ADMIN_ACTOR);
    expect(adminSale.prisma.flashSale.update).toHaveBeenCalledTimes(1);
    expect(adminSale.prisma.$queryRaw).not.toHaveBeenCalled();
    const rename = setup({ exposure: 999_000 });
    await rename.svc().updateSale('s1', { title: 'Tên mới', isActive: true }, STAFF);
    expect(rename.prisma.flashSale.update).toHaveBeenCalledTimes(1);
    expect(rename.prisma.$queryRaw).not.toHaveBeenCalled();
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
  const svcWith = (createdBy: string, role: string | null = 'STAFF') => {
    const prisma = {
      flashSaleItem: { findMany: jest.fn().mockResolvedValue([item(createdBy)]) },
      flashSalePurchase: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findUnique: jest.fn().mockResolvedValue(role ? { role } : null) },
    } as unknown as PrismaService;
    return new FlashSaleService(prisma, cfg(), notifications, lifecycle);
  };

  it('người mua chính là người tạo đợt → không có giá flash (tính giá thường), kèm lý do để app báo cho họ', async () => {
    const offer = (await svcWith('m1').resolveEffective(['v1'], NOW, 'm1')).get('v1');
    expect(offer).toMatchObject({ ownSale: true, allowance: 0 });
    const priced = priceFlashLine(100_000, 1, offer);
    expect(priced).toMatchObject({ unitPrice: 100_000, flash: null });
    expect(priced.flashLimitNotice).toBe('Bạn tạo sale này nên không mua được giá flash.');
  });

  it('khách khác vẫn có giá flash; tra không theo người mua (trang chủ) không đổi', async () => {
    expect((await svcWith('m1').resolveEffective(['v1'], NOW, 'u2')).get('v1')).toMatchObject({ flashPrice: 50_000, allowance: 2 });
    expect((await svcWith('m1').resolveEffective(['v1'], NOW)).has('v1')).toBe(true);
  });

  it('ADMIN tạo đợt rồi tự mua vẫn có giá flash (như isOwnStaffCoupon miễn ADMIN), để thử đợt trước giờ mở khách', async () => {
    expect((await svcWith('a1', 'ADMIN').resolveEffective(['v1'], NOW, 'a1')).get('v1')).toMatchObject({ flashPrice: 50_000, allowance: 2 });
  });

  it('không tra được vai trò của người tạo thì coi như nhân viên: vẫn không có giá flash', async () => {
    const priced = priceFlashLine(100_000, 1, (await svcWith('m1', null).resolveEffective(['v1'], NOW, 'm1')).get('v1'));
    expect(priced.flash).toBeNull();
    expect(priced.unitPrice).toBe(100_000);
  });
});

describe('FlashSaleService — kiểm trùng biến thể giữa các đợt chạy dưới khoá, cùng giao dịch với lần ghi', () => {
  const lockOrder = (prisma: { $executeRaw: jest.Mock }, other: jest.Mock) => {
    const lockCall = prisma.$executeRaw.mock.calls.findIndex((c: unknown[]) => c.slice(1).includes('flash.item_clash'));
    expect(lockCall).toBeGreaterThanOrEqual(0);
    expect(prisma.$executeRaw.mock.invocationCallOrder[lockCall]).toBeLessThan(other.mock.invocationCallOrder[0]!);
  };

  it('addItem của ADMIN: khoá chống trùng trước khi tra trùng và tạo dòng, trong một giao dịch', async () => {
    const { prisma, svc } = setup({ createdBy: 'a1', creatorRole: 'ADMIN' });
    await svc().addItem('s1', { variationId: 'v1', flashPrice: 80_000, quota: 5 }, ADMIN);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    lockOrder(prisma, prisma.flashSaleItem.findFirst);
    expect(prisma.flashSaleItem.findFirst.mock.invocationCallOrder[0]).toBeLessThan(prisma.flashSaleItem.create.mock.invocationCallOrder[0]);
  });

  it('addItem của nhân viên: khoá chống trùng trước khi tra trùng, cùng giao dịch với kiểm trần', async () => {
    const { prisma, svc } = setup();
    await svc().addItem('s1', { variationId: 'v1', flashPrice: 90_000, quota: 5, perUserLimit: 1 }, STAFF);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    lockOrder(prisma, prisma.flashSaleItem.findFirst);
  });

  it('addItem phát hiện trùng thì không tạo dòng', async () => {
    const { prisma, svc } = setup({ createdBy: 'a1', creatorRole: 'ADMIN' });
    prisma.flashSaleItem.findFirst.mockResolvedValue({ id: 'other' });
    await expect(svc().addItem('s1', { variationId: 'v1', flashPrice: 80_000, quota: 5 }, ADMIN)).rejects.toThrow(/đợt flash khác|trùng/i);
    expect(prisma.flashSaleItem.create).not.toHaveBeenCalled();
  });

  it('updateSale đổi giờ (kể cả đợt của ADMIN): khoá chống trùng trước khi tra trùng, tra và ghi trong cùng giao dịch', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-05T08:00:00Z').getTime());
    try {
      const { prisma, svc } = setup({ createdBy: 'a1', creatorRole: 'ADMIN' });
      prisma.flashSale.findUniqueOrThrow.mockResolvedValue({
        id: 's1', createdBy: 'a1', createdAt: new Date('2026-07-05T03:00:00Z'),
        startAt: new Date('2026-07-05T09:00:00Z'), endAt: new Date('2026-07-05T12:00:00Z'), items: [{ variationId: 'v1' }],
      });
      await svc().updateSale('s1', { endAt: '2026-07-05T11:00:00Z' }, { id: 'a1', staff: false });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      lockOrder(prisma, prisma.flashSaleItem.findFirst);
      expect(prisma.flashSaleItem.findFirst.mock.invocationCallOrder[0]).toBeLessThan(prisma.flashSale.update.mock.invocationCallOrder[0]);
    } finally {
      jest.restoreAllMocks();
    }
  });
});
