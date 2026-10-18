import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PARTNER_STORE_WHERE } from '../../merchant/partner-store';
import { writeWasteEvent } from '../core/waste-events';
import { WASTE_PERKS_PENDING_WHERE, WASTE_POINTS_PENDING_WHERE } from '../core/waste-queue-filters';
import { lockWastePointCreate } from '../waste-locks';
import { WasteAdminPointsService } from './waste-admin-points.service';

jest.mock('../core/waste-events', () => ({
  ...jest.requireActual('../core/waste-events'),
  writeWasteEvent: jest.fn().mockResolvedValue({ id: 'ev-1' }),
}));
jest.mock('../waste-locks', () => ({ lockWastePointCreate: jest.fn() }));

const writeEvent = writeWasteEvent as unknown as jest.Mock;
const lockCreate = lockWastePointCreate as unknown as jest.Mock;

const p2002 = (target: string) =>
  new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${target}`, { code: 'P2002', clientVersion: 'test', meta: { target } });

const NOW = new Date('2026-10-17T03:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const WAREHOUSE_ALWAYS_ON = 'Kho Tubu luôn đang nhận. Muốn dừng nhận mới, tắt waste.enabled hoặc cờ waste.lane_* trong cấu hình.';
const NEEDS_ONE_OWNER = 'Điểm đại lý chỉ kích hoạt được khi đã có đúng một chủ điểm hợp lệ.';
const NEEDS_QUOTA = 'Điểm nhận đại lý cần hạn mức điểm tháng.';
const NO_HANDOVER = 'Đợt này chưa bật trao quà tại điểm đại lý.';
const BAD_HOURS = 'Giờ mở cửa không hợp lệ.';
const BAD_HOURS_BODY = { MON: [{ open: '18:00', close: '08:00' }] };

const addr = { addressLine: '1 Đường A', provinceCode: '79', provinceName: 'TP.HCM', communeCode: '1', communeName: 'P1' };
const point = (o: Record<string, unknown> = {}) => ({
  id: 'p1', kind: 'PARTNER', name: 'Tạp hoá Cô Ba', ...addr, lat: null, lng: null, phone: null, openingHours: {}, status: 'ACTIVE',
  monthlyQuotaPoints: 100_000, perkText: null, perkPendingText: null, giftHandoverEnabled: false, note: null, sortOrder: 10,
  activatedAt: new Date('2026-08-08T00:00:00Z'), lastConfirmedAt: null, items: [{ itemId: 'i1' }, { itemId: 'i2' }], staff: [], ...o,
});

async function expectHttp(p: Promise<unknown>, cls: new (...a: never[]) => Error, message: string) {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(cls);
  expect((e as Error).message).toBe(message);
}

const order: string[] = [];

const sqlOf = (call: unknown[]) => {
  const [strings] = call as [TemplateStringsArray, ...unknown[]];
  return strings.join('?');
};

function setup() {
  const wastePoint = {
    findMany: jest.fn().mockResolvedValue([point()]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue({ id: 'p9' }),
    update: jest.fn(),
  };
  const wastePointItem = {
    findMany: jest.fn().mockResolvedValue([{ itemId: 'i1' }, { itemId: 'i2' }]),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  };
  const wasteItem = { count: jest.fn(async (a: { where: { id: { in: string[] } } }) => a.where.id.in.length) };
  const wastePointUsage = { findMany: jest.fn().mockResolvedValue([]) };
  const $queryRaw = jest.fn().mockResolvedValue([point()]);
  const user = {
    findUnique: jest.fn().mockResolvedValue({ id: 'o1', isBlocked: false, mergedIntoId: null, phone: '0912345678', zaloId: 'z_o1' }),
  };
  const wasteUserFlags = { findUnique: jest.fn().mockResolvedValue(null) };
  const storefront = { findFirst: jest.fn().mockResolvedValue({ id: 'sf1' }) };
  const wastePointStaff = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue({ userId: 'o1', role: 'OWNER' }),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const tx = { wastePoint, wastePointItem, wasteItem, wastePointStaff, wasteUserFlags, storefront, user, $queryRaw };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'a1', role: 'ADMIN', isBlocked: false, mergedIntoId: null, phone: null }) },
    wastePoint,
    wastePointUsage,
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => {
      const r = await cb(tx);
      order.push('tx end');
      return r;
    }),
  };
  const access = { availablePointIds: jest.fn().mockResolvedValue(new Set(['p1'])) };
  const config = { snapshot: jest.fn().mockResolvedValue({ pointInactiveDays: 60 }) };
  const notifier = {
    perkReviewed: jest.fn(async () => {
      order.push('perkReviewed');
    }),
  };
  const svc = new WasteAdminPointsService(prisma as never, access as never, config as never, notifier as never);
  return { svc, prisma, tx, wastePoint, wastePointItem, wasteItem, wastePointUsage, wastePointStaff, wasteUserFlags, storefront, user, $queryRaw, access, config, notifier };
}

describe('WasteAdminPointsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    writeEvent.mockClear();
    lockCreate.mockClear();
    order.length = 0;
  });
  afterEach(() => jest.useRealTimers());

  describe('list', () => {
    it('maps a PARTNER row with usage, unmasked staff and a full quota', async () => {
      const h = setup();
      h.wastePoint.findMany.mockResolvedValue([
        point({ staff: [{ userId: 'o1', role: 'OWNER', isActive: true, user: { id: 'o1', fullName: 'Trần Thị Ba', phone: '0912345678' } }] }),
      ]);
      h.wastePointUsage.findMany.mockResolvedValue([{ pointId: 'p1', monthKey: '2026-10', pointsUsed: 100_000, confirmations: 7 }]);

      const [row] = await h.svc.list('a1', {});

      expect(h.wastePointUsage.findMany).toHaveBeenCalledWith({ where: { monthKey: '2026-10', pointId: { in: ['p1'] } } });
      expect(row).toMatchObject({
        id: 'p1',
        kind: 'PARTNER',
        status: 'ACTIVE',
        acceptedItemIds: ['i1', 'i2'],
        monthlyQuotaPoints: 100_000,
        monthUsage: { monthKey: '2026-10', pointsUsed: 100_000, confirmations: 7 },
        quotaFull: true,
        distanceKm: null,
        activatedAt: '2026-08-08T00:00:00.000Z',
        lastConfirmedAt: null,
        staff: [{ userId: 'o1', role: 'OWNER', isActive: true, fullName: 'Trần Thị Ba', phone: '0912345678' }],
      });
    });

    it('a point with no usage row has zero usage and is not full', async () => {
      const h = setup();

      const [row] = await h.svc.list('a1', {});

      expect(row!.monthUsage).toEqual({ monthKey: '2026-10', pointsUsed: 0, confirmations: 0 });
      expect(row!.quotaFull).toBe(false);
    });

    it('builds the where from status and perkPending', async () => {
      const h = setup();
      const whereOf = (i: number) => (h.wastePoint.findMany.mock.calls[i]![0] as { where: unknown }).where;

      await h.svc.list('a1', { status: 'PENDING' });
      await h.svc.list('a1', { perkPending: true });
      await h.svc.list('a1', { status: 'PAUSED' });

      expect(whereOf(0)).toEqual({ AND: [WASTE_POINTS_PENDING_WHERE, {}] });
      expect(whereOf(1)).toEqual({ AND: [{}, WASTE_PERKS_PENDING_WHERE] });
      expect(whereOf(2)).toEqual({ AND: [{ status: 'PAUSED' }, {}] });
      expect(h.wastePoint.findMany.mock.calls[0]![0]).toMatchObject({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          items: { select: { itemId: true } },
          staff: {
            include: { user: { select: { id: true, fullName: true, phone: true } } },
            orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          },
        },
      });
    });

    it.each([
      ['PARTNER ACTIVE, last confirm 61 days ago', { lastConfirmedAt: ago(61), activatedAt: ago(90) }, true],
      ['PARTNER ACTIVE, never confirmed, activated 59 days ago', { lastConfirmedAt: null, activatedAt: ago(59) }, false],
      ['PARTNER ACTIVE, activated 70 days ago but confirmed 10 days ago', { activatedAt: ago(70), lastConfirmedAt: ago(10) }, false],
      ['WAREHOUSE with no dates', { kind: 'WAREHOUSE', activatedAt: null, lastConfirmedAt: null }, false],
    ])('hiddenInactive: %s', async (_name, over, expected) => {
      const h = setup();
      h.wastePoint.findMany.mockResolvedValue([point(over)]);

      const [row] = await h.svc.list('a1', {});

      expect(row!.hiddenInactive).toBe(expected);
    });

    it('hiddenInactive: a PARTNER ACTIVE point with no date at all is not hidden', async () => {
      const h = setup();
      h.wastePoint.findMany.mockResolvedValue([point({ activatedAt: null, lastConfirmedAt: null })]);

      const [row] = await h.svc.list('a1', {});

      expect(row!.hiddenInactive).toBe(false);
    });
  });

  describe('create', () => {
    it('PARTNER: locks first, dedupes items, starts PENDING and logs POINT_CREATED', async () => {
      const h = setup();

      await h.svc.create('a1', { kind: 'PARTNER', name: 'Tạp hoá Cô Ba', ...addr, monthlyQuotaPoints: 100_000, itemIds: ['i1', 'i1', 'i2'] });

      expect(lockCreate).toHaveBeenCalledWith(h.tx);
      expect(lockCreate.mock.invocationCallOrder[0]).toBeLessThan(h.wastePoint.count.mock.invocationCallOrder[0]!);
      expect(h.wasteItem.count).toHaveBeenCalledWith({ where: { id: { in: ['i1', 'i2'] } } });
      expect(h.wastePoint.create).toHaveBeenCalledTimes(1);
      expect(h.wastePoint.create.mock.calls[0]![0].data).toMatchObject({
        kind: 'PARTNER',
        name: 'Tạp hoá Cô Ba',
        ...addr,
        status: 'PENDING',
        activatedAt: null,
        giftHandoverEnabled: false,
        items: { create: [{ itemId: 'i1' }, { itemId: 'i2' }] },
        lat: null,
        openingHours: {},
        sortOrder: 0,
        monthlyQuotaPoints: 100_000,
      });
      expect(writeEvent).toHaveBeenCalledTimes(1);
      expect(writeEvent.mock.calls[0]![1]).toEqual(
        expect.objectContaining({
          kind: 'POINT_CREATED',
          actorUserId: 'a1',
          actorRole: 'ADMIN',
          pointId: 'p9',
          meta: { before: null, after: { kind: 'PARTNER', status: 'PENDING', monthlyQuotaPoints: 100_000, itemIds: ['i1', 'i2'] } },
        }),
      );
    });

    it('WAREHOUSE without a status is ACTIVE from now and has no quota', async () => {
      const h = setup();

      await h.svc.create('a1', { kind: 'WAREHOUSE', name: 'Kho Tubu', ...addr });

      expect(h.wastePoint.create.mock.calls[0]![0].data).toMatchObject({ status: 'ACTIVE', activatedAt: NOW, monthlyQuotaPoints: null });
    });

    it.each([
      ['no kind', { name: 'A', ...addr, monthlyQuotaPoints: 1000 }, 'Chọn loại điểm nhận.'],
      ['PARTNER without a quota', { kind: 'PARTNER', name: 'A', ...addr }, NEEDS_QUOTA],
      ['PARTNER created ACTIVE', { kind: 'PARTNER', name: 'A', ...addr, monthlyQuotaPoints: 1000, status: 'ACTIVE' }, NEEDS_ONE_OWNER],
      ['PARTNER with gift handover', { kind: 'PARTNER', name: 'A', ...addr, monthlyQuotaPoints: 1000, giftHandoverEnabled: true }, NO_HANDOVER],
      ['WAREHOUSE with a quota', { kind: 'WAREHOUSE', name: 'Kho', ...addr, monthlyQuotaPoints: 50_000 }, 'Kho Tubu không có hạn mức điểm.'],
      ['WAREHOUSE PAUSED', { kind: 'WAREHOUSE', name: 'Kho', ...addr, status: 'PAUSED' }, WAREHOUSE_ALWAYS_ON],
      ['reversed opening hours', { kind: 'PARTNER', name: 'A', ...addr, monthlyQuotaPoints: 1000, openingHours: BAD_HOURS_BODY }, BAD_HOURS],
    ])('rejects %s', async (_name, body, message) => {
      const h = setup();

      await expectHttp(h.svc.create('a1', body as never), BadRequestException, message);

      expect(h.wastePoint.create).not.toHaveBeenCalled();
      expect(writeEvent).not.toHaveBeenCalled();
    });

    it('answers 409 at 200 points or a second warehouse, and 400 for an unknown item', async () => {
      const partner = { kind: 'PARTNER' as const, name: 'A', ...addr, monthlyQuotaPoints: 1000 };

      const full = setup();
      full.wastePoint.count.mockResolvedValueOnce(200);
      await expectHttp(full.svc.create('a1', partner), ConflictException, 'Đã đủ 200 điểm nhận, không tạo thêm được.');

      const second = setup();
      second.wastePoint.count.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
      await expectHttp(second.svc.create('a1', { kind: 'WAREHOUSE', name: 'Kho 2', ...addr }), ConflictException, 'Đã có kho Tubu, không tạo thêm.');
      expect(second.wastePoint.count).toHaveBeenLastCalledWith({ where: { kind: 'WAREHOUSE' } });

      const unknown = setup();
      unknown.wasteItem.count.mockResolvedValueOnce(1);
      await expectHttp(unknown.svc.create('a1', { ...partner, itemIds: ['i1', 'nope'] }), BadRequestException, 'Có món không tồn tại.');

      for (const h of [full, second, unknown]) {
        expect(h.wastePoint.create).not.toHaveBeenCalled();
        expect(writeEvent).not.toHaveBeenCalled();
      }
    });

    it('maps a P2002 on the index name or on the field list to the one-warehouse 409', async () => {
      for (const target of ['waste_points_one_warehouse_key', 'kind']) {
        const h = setup();
        (h.prisma.$transaction as jest.Mock).mockRejectedValueOnce(p2002(target));

        await expectHttp(h.svc.create('a1', { kind: 'WAREHOUSE', name: 'Kho', ...addr }), ConflictException, 'Đã có kho Tubu, không tạo thêm.');
      }
    });
  });

  describe('update', () => {
    it('WAREHOUSE stays always on, keeps its kind, and a plain rename logs one event', async () => {
      const h = setup();
      const warehouse = point({ kind: 'WAREHOUSE', name: 'Kho Tubu', monthlyQuotaPoints: null });
      h.$queryRaw.mockResolvedValue([warehouse]);

      await expectHttp(h.svc.update('a1', 'p1', { status: 'PENDING' }), BadRequestException, WAREHOUSE_ALWAYS_ON);
      await expectHttp(h.svc.update('a1', 'p1', { status: 'PAUSED' }), BadRequestException, WAREHOUSE_ALWAYS_ON);
      await expectHttp(h.svc.update('a1', 'p1', { kind: 'PARTNER' }), BadRequestException, 'Không đổi được loại điểm nhận.');
      expect(h.wastePoint.update).not.toHaveBeenCalled();
      h.$queryRaw.mockResolvedValueOnce([]);
      await expectHttp(h.svc.update('a1', 'nope', { name: 'X' }), NotFoundException, 'Không tìm thấy điểm nhận.');

      h.wastePoint.update.mockResolvedValue(point({ kind: 'WAREHOUSE', name: 'Kho Tubu HCM', monthlyQuotaPoints: null }));
      await h.svc.update('a1', 'p1', { name: 'Kho Tubu HCM' });

      expect(h.wastePoint.update).toHaveBeenCalledTimes(1);
      expect(h.wastePoint.update.mock.calls[0]![0].data).toEqual({ name: 'Kho Tubu HCM' });
      expect(sqlOf(h.$queryRaw.mock.calls[0]!)).toContain('FROM "waste_points" WHERE "id" = ? FOR NO KEY UPDATE');
      expect(writeEvent).toHaveBeenCalledTimes(1);
      expect(writeEvent.mock.calls[0]![1]).toEqual(
        expect.objectContaining({
          kind: 'POINT_UPDATED',
          actorUserId: 'a1',
          actorRole: 'ADMIN',
          pointId: 'p1',
          meta: { before: { name: 'Kho Tubu' }, after: { name: 'Kho Tubu HCM' } },
        }),
      );
    });

    it('moving a PENDING PARTNER to ACTIVE stamps activatedAt and checks the owner after the write', async () => {
      const h = setup();
      h.$queryRaw.mockResolvedValue([point({ status: 'PENDING', activatedAt: null })]);
      h.wastePoint.update.mockResolvedValue(point({ status: 'ACTIVE', activatedAt: NOW }));

      await h.svc.update('a1', 'p1', { status: 'ACTIVE' });

      expect(h.wastePoint.update.mock.calls[0]![0].data).toEqual({ status: 'ACTIVE', activatedAt: NOW });
      expect(h.access.availablePointIds).toHaveBeenCalledWith(h.tx, ['p1']);
      expect(h.access.availablePointIds.mock.invocationCallOrder[0]).toBeGreaterThan(h.wastePoint.update.mock.invocationCallOrder[0]!);
      expect(writeEvent.mock.calls[0]![1].meta).toEqual({
        before: { status: 'PENDING', activatedAt: null },
        after: { status: 'ACTIVE', activatedAt: NOW.toISOString() },
      });
    });

    it('refuses ACTIVE without exactly one valid owner and rolls everything back', async () => {
      const h = setup();
      h.$queryRaw.mockResolvedValue([point({ status: 'PENDING', activatedAt: null })]);
      h.wastePoint.update.mockResolvedValue(point({ status: 'ACTIVE', activatedAt: NOW }));
      h.access.availablePointIds.mockResolvedValue(new Set());

      await expectHttp(h.svc.update('a1', 'p1', { status: 'ACTIVE' }), BadRequestException, NEEDS_ONE_OWNER);

      expect(writeEvent).not.toHaveBeenCalled();
    });

    it('re-sending ACTIVE on an ACTIVE point resets activatedAt and logs it', async () => {
      const h = setup();
      h.$queryRaw.mockResolvedValue([point({ activatedAt: ago(70) })]);
      h.wastePoint.update.mockResolvedValue(point({ activatedAt: NOW }));

      await h.svc.update('a1', 'p1', { status: 'ACTIVE' });

      expect(h.wastePoint.update.mock.calls[0]![0].data).toEqual({ activatedAt: NOW });
      expect(writeEvent).toHaveBeenCalledTimes(1);
      expect(writeEvent.mock.calls[0]![1].meta).toEqual({
        before: { activatedAt: ago(70).toISOString() },
        after: { activatedAt: NOW.toISOString() },
      });
    });

    it('replaces the item set and quota with before/after, and refuses null quota, gift handover and bad hours on a PARTNER', async () => {
      const h = setup();
      h.wastePointItem.findMany.mockResolvedValue([{ itemId: 'i2' }, { itemId: 'i1' }]);
      h.wastePoint.update.mockResolvedValue(point({ monthlyQuotaPoints: 300_000 }));

      await h.svc.update('a1', 'p1', { monthlyQuotaPoints: 300_000, itemIds: ['i2'] });

      expect(h.wastePointItem.deleteMany).toHaveBeenCalledWith({ where: { pointId: 'p1' } });
      expect(h.wastePointItem.createMany).toHaveBeenCalledWith({ data: [{ pointId: 'p1', itemId: 'i2' }] });
      expect(writeEvent.mock.calls[0]![1].meta).toEqual({
        before: { monthlyQuotaPoints: 100_000, itemIds: ['i1', 'i2'] },
        after: { monthlyQuotaPoints: 300_000, itemIds: ['i2'] },
      });

      h.wastePoint.update.mockClear();
      writeEvent.mockClear();
      await expectHttp(h.svc.update('a1', 'p1', { monthlyQuotaPoints: null }), BadRequestException, NEEDS_QUOTA);
      await expectHttp(h.svc.update('a1', 'p1', { giftHandoverEnabled: true }), BadRequestException, NO_HANDOVER);
      await expectHttp(h.svc.update('a1', 'p1', { openingHours: BAD_HOURS_BODY }), BadRequestException, BAD_HOURS);
      expect(h.wastePoint.update).not.toHaveBeenCalled();
      expect(writeEvent).not.toHaveBeenCalled();

      h.wastePointItem.deleteMany.mockClear();
      await h.svc.update('a1', 'p1', { name: 'Tạp hoá Cô Ba', itemIds: ['i2', 'i1'] });
      expect(h.wastePoint.update).not.toHaveBeenCalled();
      expect(h.wastePointItem.deleteMany).not.toHaveBeenCalled();
      expect(writeEvent).not.toHaveBeenCalled();

      h.$queryRaw.mockResolvedValue([point({ openingHours: { FRI: [], MON: [] } })]);
      await h.svc.update('a1', 'p1', { openingHours: { MON: [], FRI: [] } });
      expect(h.wastePoint.update).not.toHaveBeenCalled();
      expect(writeEvent).not.toHaveBeenCalled();
    });
  });

  describe('reorder', () => {
    it('locks every row first, numbers 10, 20, 30 and logs one POINTS_REORDERED', async () => {
      const h = setup();
      h.wastePoint.findMany.mockResolvedValue([point({ id: 'p1' }), point({ id: 'p2' }), point({ id: 'p3' })]);

      await h.svc.reorder('a1', { ids: ['p3', 'p1', 'p2'] });

      expect(sqlOf(h.$queryRaw.mock.calls[0]!)).toContain('FROM "waste_points" ORDER BY "id" FOR NO KEY UPDATE');
      expect(h.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(h.wastePoint.findMany.mock.invocationCallOrder[0]!);
      expect(h.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(h.wastePoint.update.mock.invocationCallOrder[0]!);
      expect(h.wastePoint.update.mock.calls.map((c) => c[0])).toEqual([
        { where: { id: 'p3' }, data: { sortOrder: 10 } },
        { where: { id: 'p1' }, data: { sortOrder: 20 } },
        { where: { id: 'p2' }, data: { sortOrder: 30 } },
      ]);
      expect(writeEvent).toHaveBeenCalledTimes(1);
      expect(writeEvent.mock.calls[0]![1]).toEqual(
        expect.objectContaining({
          kind: 'POINTS_REORDERED',
          actorUserId: 'a1',
          actorRole: 'ADMIN',
          meta: { before: { ids: ['p1', 'p2', 'p3'] }, after: { ids: ['p3', 'p1', 'p2'] } },
        }),
      );

      writeEvent.mockClear();
      h.wastePoint.update.mockClear();
      await expectHttp(
        h.svc.reorder('a1', { ids: ['p1', 'p1', 'p2'] }),
        BadRequestException,
        'Danh sách sắp xếp phải gồm đủ mọi điểm nhận, mỗi điểm một lần.',
      );
      expect(h.wastePoint.update).not.toHaveBeenCalled();
      expect(writeEvent).not.toHaveBeenCalled();
    });
  });

  describe('staff and perk', () => {
    const OWNER_EXISTS = 'Điểm đã có chủ điểm. Bỏ chủ điểm cũ trước khi thêm chủ mới.';
    const IN_POINT = 'Người này đã ở điểm nhận.';
    const NOT_IN_POINT = 'Người này không ở điểm nhận.';
    const NO_PERK = 'Không có ưu đãi chờ duyệt.';
    const PERK = 'Giảm 10% hoá đơn đầu';
    const NAME = 'Tạp hoá Cô Ba';
    const lockRow = { id: 'p1', kind: 'PARTNER', name: NAME, perkText: null, perkPendingText: PERK };
    const staffSetup = () => {
      const h = setup();
      h.$queryRaw.mockResolvedValue([lockRow]);
      return h;
    };
    const warehouseRow = { id: 'p1', kind: 'WAREHOUSE', name: 'Kho Tubu', perkText: null, perkPendingText: null };

    it('add OWNER ok: locks the point, checks the partner store, creates the row and one event', async () => {
      const h = staffSetup();

      await h.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'OWNER' });

      expect(sqlOf(h.$queryRaw.mock.calls[0]!)).toContain('FOR NO KEY UPDATE');
      expect(h.storefront.findFirst.mock.calls[0]![0].where).toEqual({ ownerUserId: 'o1', ...PARTNER_STORE_WHERE });
      expect(h.wastePointStaff.create).toHaveBeenCalledWith({ data: { pointId: 'p1', userId: 'o1', role: 'OWNER' } });
      expect(writeEvent).toHaveBeenCalledTimes(1);
      expect(writeEvent).toHaveBeenCalledWith(
        h.tx,
        expect.objectContaining({
          kind: 'POINT_STAFF_ADDED',
          actorUserId: 'a1',
          actorRole: 'ADMIN',
          pointId: 'p1',
          meta: { staffUserId: 'o1', before: null, after: { role: 'OWNER', isActive: true } },
        }),
      );
    });

    it('add STAFF re-activates an inactive row instead of creating one', async () => {
      const h = staffSetup();
      h.wastePointStaff.findMany.mockResolvedValue([{ id: 's9', userId: 'o1', role: 'OWNER', isActive: false }]);

      await h.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'STAFF' });

      expect(h.wastePointStaff.update).toHaveBeenCalledWith({ where: { id: 's9' }, data: { isActive: true, role: 'STAFF' } });
      expect(h.wastePointStaff.create).not.toHaveBeenCalled();
      expect(writeEvent).toHaveBeenCalledWith(
        h.tx,
        expect.objectContaining({ meta: { staffUserId: 'o1', before: { role: 'OWNER', isActive: false }, after: { role: 'STAFF', isActive: true } } }),
      );
    });

    it('add on the WAREHOUSE point is refused', async () => {
      const h = staffSetup();
      h.$queryRaw.mockResolvedValue([warehouseRow]);

      await expectHttp(
        h.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'STAFF' }),
        BadRequestException,
        'Kho Tubu không gắn người ở điểm; nhân viên và quản trị viên thao tác theo vai trò.',
      );
      expect(h.wastePointStaff.create).not.toHaveBeenCalled();
    });

    it('unknown point and unknown user are 404', async () => {
      const h = staffSetup();
      h.$queryRaw.mockResolvedValue([]);
      await expectHttp(h.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'STAFF' }), NotFoundException, 'Không tìm thấy điểm nhận.');

      const g = staffSetup();
      g.user.findUnique.mockResolvedValue(null);
      await expectHttp(g.svc.addStaff('a1', 'p1', { userId: 'zz', role: 'STAFF' }), NotFoundException, 'Không tìm thấy người dùng.');

      const m = staffSetup();
      m.user.findUnique.mockResolvedValue({ id: 'o1', isBlocked: false, mergedIntoId: 'o2', phone: '0912345678', zaloId: 'z_o1' });
      await expectHttp(m.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'STAFF' }), NotFoundException, 'Không tìm thấy người dùng.');
    });

    it('OWNER without a partner store is refused', async () => {
      const h = staffSetup();
      h.storefront.findFirst.mockResolvedValue(null);

      await expectHttp(h.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'OWNER' }), BadRequestException, 'Chủ điểm phải là chủ một gian hàng đối tác.');
      expect(h.wastePointStaff.create).not.toHaveBeenCalled();
    });

    it('a blocked, waste-blocked or guest user is refused and nothing is written', async () => {
      const blocked = staffSetup();
      blocked.user.findUnique.mockResolvedValue({ id: 'o1', isBlocked: true, mergedIntoId: null, phone: '0912345678', zaloId: 'z_o1' });
      await expectHttp(blocked.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'STAFF' }), BadRequestException, 'Người này đang bị khoá tài khoản.');

      const flagged = staffSetup();
      flagged.wasteUserFlags.findUnique.mockResolvedValue({ blockedAt: new Date('2026-10-01T00:00:00Z') });
      await expectHttp(flagged.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'STAFF' }), BadRequestException, 'Người này đang bị khoá chương trình đổi rác.');

      const guest = staffSetup();
      guest.user.findUnique.mockResolvedValue({ id: 'g1', isBlocked: false, mergedIntoId: null, phone: null, zaloId: 'guest_abc' });
      await expectHttp(
        guest.svc.addStaff('a1', 'p1', { userId: 'g1', role: 'STAFF' }),
        BadRequestException,
        'Người này chưa đăng nhập bằng Zalo nên chưa gắn được vào điểm nhận.',
      );

      for (const h of [blocked, flagged, guest]) {
        expect(h.wastePointStaff.create).not.toHaveBeenCalled();
        expect(h.wastePointStaff.update).not.toHaveBeenCalled();
      }
    });

    it('a user already active at the point is 409', async () => {
      const h = staffSetup();
      h.wastePointStaff.findMany.mockResolvedValue([{ id: 's1', userId: 'o1', role: 'STAFF', isActive: true }]);

      await expectHttp(h.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'STAFF' }), ConflictException, IN_POINT);
    });

    it('a sixth person is 409', async () => {
      const h = staffSetup();
      h.wastePointStaff.findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, userId: `x${i}`, role: 'STAFF', isActive: true })),
      );

      await expectHttp(h.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'STAFF' }), ConflictException, 'Mỗi điểm nhận tối đa 5 người.');
      expect(h.wastePointStaff.create).not.toHaveBeenCalled();
    });

    it('a second OWNER is 409', async () => {
      const h = staffSetup();
      h.wastePointStaff.findMany.mockResolvedValue([{ id: 's1', userId: 'x1', role: 'OWNER', isActive: true }]);

      await expectHttp(h.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'OWNER' }), ConflictException, OWNER_EXISTS);
      expect(h.wastePointStaff.create).not.toHaveBeenCalled();
    });

    it('a P2002 on the one-owner index is the same 409, caught outside the transaction', async () => {
      const h = staffSetup();
      h.prisma.$transaction.mockRejectedValue(p2002('waste_point_staff_one_owner_key'));
      await expectHttp(h.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'OWNER' }), ConflictException, OWNER_EXISTS);

      const g = staffSetup();
      g.prisma.$transaction.mockRejectedValue({ code: 'P2002', meta: { target: ['pointId'] } });
      await expectHttp(g.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'OWNER' }), ConflictException, OWNER_EXISTS);

      const k = staffSetup();
      k.prisma.$transaction.mockRejectedValue(p2002('pointId,userId'));
      await expectHttp(k.svc.addStaff('a1', 'p1', { userId: 'o1', role: 'STAFF' }), ConflictException, IN_POINT);
    });

    it('remove ok deactivates the row and writes one event; a missing row is 404 with no update', async () => {
      const h = staffSetup();

      await h.svc.removeStaff('a1', 'p1', 'o1');

      expect(h.wastePointStaff.updateMany).toHaveBeenCalledWith({ where: { pointId: 'p1', userId: 'o1', isActive: true }, data: { isActive: false } });
      expect(writeEvent).toHaveBeenCalledTimes(1);
      expect(writeEvent).toHaveBeenCalledWith(
        h.tx,
        expect.objectContaining({
          kind: 'POINT_STAFF_REMOVED',
          actorUserId: 'a1',
          actorRole: 'ADMIN',
          pointId: 'p1',
          meta: { staffUserId: 'o1', before: { role: 'OWNER', isActive: true }, after: { role: 'OWNER', isActive: false } },
        }),
      );

      const g = staffSetup();
      g.wastePointStaff.findFirst.mockResolvedValue(null);
      await expectHttp(g.svc.removeStaff('a1', 'p1', 'o1'), NotFoundException, NOT_IN_POINT);
      expect(g.wastePointStaff.updateMany).not.toHaveBeenCalled();
    });

    it('approve moves the pending text to the live text and notifies the owner after commit', async () => {
      const h = staffSetup();

      await h.svc.approvePerk('a1', 'p1');

      expect(h.wastePoint.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { perkText: PERK, perkPendingText: null } });
      expect(writeEvent).toHaveBeenCalledWith(
        h.tx,
        expect.objectContaining({
          kind: 'PERK_APPROVED',
          actorUserId: 'a1',
          actorRole: 'ADMIN',
          pointId: 'p1',
          meta: { before: { perkText: null, perkPendingText: PERK }, after: { perkText: PERK, perkPendingText: null } },
        }),
      );
      expect(h.notifier.perkReviewed).toHaveBeenCalledWith('o1', { id: 'p1', name: NAME }, true, 'ev-1');
      expect(order.indexOf('tx end')).toBeLessThan(order.indexOf('perkReviewed'));
    });

    it('reject clears the pending text, keeps the live text and notifies the owner after commit', async () => {
      const h = staffSetup();

      await h.svc.rejectPerk('a1', 'p1');

      expect(h.wastePoint.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { perkPendingText: null } });
      expect(writeEvent).toHaveBeenCalledWith(
        h.tx,
        expect.objectContaining({
          kind: 'PERK_REJECTED',
          pointId: 'p1',
          meta: { before: { perkPendingText: PERK }, after: { perkPendingText: null } },
        }),
      );
      expect(h.notifier.perkReviewed).toHaveBeenCalledWith('o1', { id: 'p1', name: NAME }, false, 'ev-1');
      expect(order.indexOf('tx end')).toBeLessThan(order.indexOf('perkReviewed'));
    });

    it('approve and reject without a pending perk are 409 and send nothing', async () => {
      const h = staffSetup();
      h.$queryRaw.mockResolvedValue([{ ...lockRow, perkPendingText: null }]);

      await expectHttp(h.svc.approvePerk('a1', 'p1'), ConflictException, NO_PERK);
      await expectHttp(h.svc.rejectPerk('a1', 'p1'), ConflictException, NO_PERK);

      expect(h.wastePoint.update).not.toHaveBeenCalled();
      expect(h.notifier.perkReviewed).not.toHaveBeenCalled();
    });

    it('approve on a point without an active OWNER writes the event and notifies nobody', async () => {
      const h = staffSetup();
      h.wastePointStaff.findFirst.mockResolvedValue(null);

      await h.svc.approvePerk('a1', 'p1');

      expect(writeEvent).toHaveBeenCalledWith(h.tx, expect.objectContaining({ kind: 'PERK_APPROVED' }));
      expect(h.notifier.perkReviewed).not.toHaveBeenCalled();
    });

    it.each(['removeStaff', 'approvePerk', 'rejectPerk'] as const)('%s: STAFF caller is 403, no transaction, no write', async (m) => {
      const h = staffSetup();
      h.prisma.user.findUnique.mockResolvedValue({ id: 's1', role: 'STAFF', isBlocked: false, mergedIntoId: null, phone: null });

      const call = m === 'removeStaff' ? h.svc.removeStaff('s1', 'p1', 'o1') : h.svc[m]('s1', 'p1');
      await expect(call).rejects.toBeInstanceOf(ForbiddenException);

      expect(h.prisma.$transaction).not.toHaveBeenCalled();
      expect(h.notifier.perkReviewed).not.toHaveBeenCalled();
    });
  });
});
