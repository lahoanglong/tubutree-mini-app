import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  const tx = { wastePoint, wastePointItem, wasteItem, $queryRaw };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'a1', role: 'ADMIN', isBlocked: false, mergedIntoId: null, phone: null }) },
    wastePoint,
    wastePointUsage,
    $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
  };
  const access = { availablePointIds: jest.fn().mockResolvedValue(new Set(['p1'])) };
  const config = { snapshot: jest.fn().mockResolvedValue({ pointInactiveDays: 60 }) };
  const notifier = {};
  const svc = new WasteAdminPointsService(prisma as never, access as never, config as never, notifier as never);
  return { svc, prisma, tx, wastePoint, wastePointItem, wasteItem, wastePointUsage, $queryRaw, access, config };
}

describe('WasteAdminPointsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    writeEvent.mockClear();
    lockCreate.mockClear();
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
});
