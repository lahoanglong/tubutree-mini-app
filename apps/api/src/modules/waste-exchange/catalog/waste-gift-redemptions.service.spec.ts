import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { maskPhoneOrNull } from '../../../common/mask-pii';
import { writeWasteEvent } from '../core/waste-events';
import { wasteGiftOverdueWhere } from '../core/waste-queue-filters';
import { customerView } from '../core/waste-mask';
import { lookupMissMeta } from '../waste-codes';
import { WasteGiftRedemptionsService } from './waste-gift-redemptions.service';

jest.mock('../core/waste-events', () => ({
  ...jest.requireActual('../core/waste-events'),
  writeWasteEvent: jest.fn().mockResolvedValue({ id: 'ev-1' }),
}));

const writeEvent = writeWasteEvent as unknown as jest.Mock;

const ALREADY = 'Lượt đổi quà này đã được trao hoặc đã huỷ.';
const NOT_FOUND_CODE = 'Không tìm thấy mã';

const ready = {
  id: 'r1',
  userId: 'u1',
  giftId: 'g1',
  giftKind: 'GIFT',
  giftName: 'Túi vải Tubu',
  pointsCost: 30_000,
  status: 'READY',
  code: 'QG-ABCDEFGH',
  couponId: null,
  idempotencyKey: 'k',
  claimExpiresAt: new Date('2026-12-16T00:00:00Z'),
  fulfilledAt: null,
  fulfilledByUserId: null,
  fulfilledPointId: null,
  cancelledAt: null,
  cancelledByUserId: null,
  cancelReason: null,
  refundedPoints: null,
  createdAt: new Date('2026-10-17T00:00:00Z'),
};

const warehouseAccess = { pointId: 'wh', kind: 'WAREHOUSE', giftHandoverEnabled: false, actorRole: 'STAFF', status: 'ACTIVE' };

function setup() {
  const order: string[] = [];
  const tx = {
    wasteGiftRedemption: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...ready, status: 'FULFILLED', fulfilledAt: new Date('2026-10-18T00:00:00Z') }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const prisma = {
    wasteGiftRedemption: { findUnique: jest.fn().mockResolvedValue(ready), findMany: jest.fn().mockResolvedValue([]) },
    wasteUserFlags: { findUnique: jest.fn().mockResolvedValue(null) },
    wasteRequest: { count: jest.fn().mockResolvedValue(0) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'a1', role: 'ADMIN', isBlocked: false, mergedIntoId: null, phone: '0900000000' }) },
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => {
      const r = await cb(tx);
      order.push('tx end');
      return r;
    }),
  };
  const access = {
    assertPointAccess: jest.fn().mockResolvedValue(warehouseAccess),
    assertWarehouseActor: jest.fn().mockResolvedValue({ id: 's1', role: 'STAFF', phone: null }),
    warehousePoint: jest.fn().mockResolvedValue({ id: 'wh' }),
  };
  const config = { snapshot: jest.fn().mockResolvedValue({ enabled: true }) };
  const rewards = {
    grant: jest.fn().mockResolvedValue(true),
    expiresAt: jest.fn().mockResolvedValue(new Date('2027-10-17T00:00:00Z')),
  };
  const notifier = {
    giftCancelled: jest.fn(async () => {
      order.push('giftCancelled');
    }),
  };
  const svc = new WasteGiftRedemptionsService(prisma as never, access as never, config as never, rewards as never, notifier as never);
  const setRole = (role: 'STAFF' | 'ADMIN' | 'CUSTOMER') =>
    prisma.user.findUnique.mockResolvedValue({ id: 'a1', role, isBlocked: false, mergedIntoId: null, phone: '0900000000' });
  return { svc, prisma, tx, access, config, rewards, notifier, order, setRole };
}

let h: ReturnType<typeof setup>;

beforeEach(() => {
  writeEvent.mockClear();
  h = setup();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('WasteGiftRedemptionsService.fulfilAtDesk', () => {
  it('hands over at the warehouse: normalises the code, one guarded updateMany, one GIFT_FULFILLED event', async () => {
    const res = await h.svc.fulfilAtDesk('s1', { code: ' qg-abcd efgh ', pointId: 'wh' });

    expect(h.prisma.wasteGiftRedemption.findUnique).toHaveBeenCalledWith({ where: { code: 'QG-ABCDEFGH' } });
    expect(h.tx.wasteGiftRedemption.updateMany).toHaveBeenCalledWith({
      where: { code: 'QG-ABCDEFGH', status: 'READY' },
      data: { status: 'FULFILLED', fulfilledAt: expect.any(Date), fulfilledByUserId: 's1', fulfilledPointId: 'wh' },
    });
    expect(writeEvent).toHaveBeenCalledTimes(1);
    expect(writeEvent).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({
        kind: 'GIFT_FULFILLED',
        actorUserId: 's1',
        actorRole: 'STAFF',
        pointId: 'wh',
        giftRedemptionId: 'r1',
        meta: { giftId: 'g1', subjectUserId: 'u1', before: { status: 'READY' }, after: { status: 'FULFILLED' } },
      }),
    );
    expect(res.status).toBe('FULFILLED');
  });

  it('unknown code: 404 and one LOOKUP_MISS event, nothing updated', async () => {
    h.prisma.wasteGiftRedemption.findUnique.mockResolvedValue(null);

    await expect(h.svc.fulfilAtDesk('s1', { code: ' qg-zzzz zzzz ', pointId: 'wh' })).rejects.toThrow(new NotFoundException(NOT_FOUND_CODE));

    expect(writeEvent).toHaveBeenCalledTimes(1);
    expect(writeEvent).toHaveBeenCalledWith(
      h.prisma,
      expect.objectContaining({ kind: 'LOOKUP_MISS', actorUserId: 's1', actorRole: 'STAFF', pointId: 'wh', meta: lookupMissMeta(' qg-zzzz zzzz ') }),
    );
    expect(h.tx.wasteGiftRedemption.updateMany).not.toHaveBeenCalled();
  });

  it('count 0 (already fulfilled or cancelled): 409 and no event', async () => {
    h.tx.wasteGiftRedemption.updateMany.mockResolvedValue({ count: 0 });

    await expect(h.svc.fulfilAtDesk('s1', { code: 'QG-ABCDEFGH', pointId: 'wh' })).rejects.toThrow(new ConflictException(ALREADY));

    expect(writeEvent).not.toHaveBeenCalled();
  });

  it('PARTNER point without gift handover: 403, the code is never looked up', async () => {
    h.access.assertPointAccess.mockResolvedValue({ ...warehouseAccess, pointId: 'p1', kind: 'PARTNER', giftHandoverEnabled: false, actorRole: 'POINT_STAFF' });

    await expect(h.svc.fulfilAtDesk('s1', { code: 'QG-ABCDEFGH', pointId: 'p1' })).rejects.toThrow(
      new ForbiddenException('Điểm nhận này chưa được bật trao quà; khách nhận quà tại kho Tubu.'),
    );

    expect(h.prisma.wasteGiftRedemption.findUnique).not.toHaveBeenCalled();
  });

  it('waste.enabled off: the warehouse still hands over (programmeEnabled false goes to the access helper)', async () => {
    h.config.snapshot.mockResolvedValue({ enabled: false });

    const res = await h.svc.fulfilAtDesk('s1', { code: 'QG-ABCDEFGH', pointId: 'wh' });

    expect(h.access.assertPointAccess).toHaveBeenCalledWith('s1', 'wh', { programmeEnabled: false });
    expect(res.status).toBe('FULFILLED');
  });
});

describe('WasteGiftRedemptionsService.fulfilById', () => {
  it('hands over an OVERDUE READY row without any claimExpiresAt condition (spec 8)', async () => {
    h.access.assertWarehouseActor.mockResolvedValue({ id: 's1', role: 'ADMIN', phone: null });
    h.prisma.wasteGiftRedemption.findUnique.mockResolvedValue({ ...ready, claimExpiresAt: new Date(Date.now() - 86_400_000) });

    const res = await h.svc.fulfilById('s1', 'r1', { code: 'qg-abcdefgh' });

    expect(h.tx.wasteGiftRedemption.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'READY' },
      data: expect.objectContaining({ fulfilledPointId: 'wh', fulfilledByUserId: 's1' }),
    });
    expect(res.status).toBe('FULFILLED');
    expect(writeEvent).toHaveBeenCalledWith(h.tx, expect.objectContaining({ kind: 'GIFT_FULFILLED', actorRole: 'ADMIN', pointId: 'wh' }));
  });

  it('wrong code: 404 plus one LOOKUP_MISS event pinned to the warehouse, nothing updated', async () => {
    await expect(h.svc.fulfilById('s1', 'r1', { code: 'QG-ZZZZZZZZ' })).rejects.toThrow(new NotFoundException(NOT_FOUND_CODE));

    expect(writeEvent).toHaveBeenCalledTimes(1);
    expect(writeEvent).toHaveBeenCalledWith(
      h.prisma,
      expect.objectContaining({ kind: 'LOOKUP_MISS', actorUserId: 's1', actorRole: 'STAFF', pointId: 'wh', meta: lookupMissMeta('QG-ZZZZZZZZ') }),
    );
    expect(h.tx.wasteGiftRedemption.updateMany).not.toHaveBeenCalled();
  });

  it('unknown id: the same 404 and LOOKUP_MISS', async () => {
    h.prisma.wasteGiftRedemption.findUnique.mockResolvedValue(null);

    await expect(h.svc.fulfilById('s1', 'nope', { code: 'QG-ABCDEFGH' })).rejects.toThrow(new NotFoundException(NOT_FOUND_CODE));

    expect(writeEvent).toHaveBeenCalledTimes(1);
    expect(writeEvent).toHaveBeenCalledWith(h.prisma, expect.objectContaining({ kind: 'LOOKUP_MISS', pointId: 'wh' }));
  });

  it('count 0: 409 with the same sentence and no event', async () => {
    h.tx.wasteGiftRedemption.updateMany.mockResolvedValue({ count: 0 });

    await expect(h.svc.fulfilById('s1', 'r1', { code: 'QG-ABCDEFGH' })).rejects.toThrow(new ConflictException(ALREADY));

    expect(writeEvent).not.toHaveBeenCalled();
  });
});

describe('WasteGiftRedemptionsService.cancel', () => {
  const cancelledRow = { ...ready, status: 'CANCELLED', cancelledAt: new Date('2026-10-18T00:00:00Z'), cancelReason: 'Khách đổi ý', refundedPoints: 30_000 };

  it('default refund: guarded updateMany, grant, stock back, one event, notify after commit, in lock order 12', async () => {
    h.tx.wasteGiftRedemption.findUniqueOrThrow.mockResolvedValue(cancelledRow);

    const res = await h.svc.cancel('a1', 'r1', { reason: 'Khách đổi ý' });

    expect(h.tx.wasteGiftRedemption.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'READY' },
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date), cancelledByUserId: 'a1', cancelReason: 'Khách đổi ý', refundedPoints: 30_000 },
    });
    expect(h.rewards.grant).toHaveBeenCalledWith('u1', 30_000, 'GIFT_REFUND:QG-ABCDEFGH', 'GIFT_REFUND', 'r1', h.tx, new Date('2027-10-17T00:00:00Z'));
    expect(h.rewards.expiresAt.mock.invocationCallOrder[0]).toBeLessThan(h.prisma.$transaction.mock.invocationCallOrder[0]!);

    const [strings, ...values] = h.tx.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join('?');
    expect(sql).toContain('SET "stock" = "stock" + 1');
    expect(sql).toContain('"stock" IS NOT NULL');
    expect(values).toEqual(['g1']);

    const upd = h.tx.wasteGiftRedemption.updateMany.mock.invocationCallOrder[0]!;
    const grant = h.rewards.grant.mock.invocationCallOrder[0]!;
    const stock = h.tx.$executeRaw.mock.invocationCallOrder[0]!;
    expect(upd).toBeLessThan(grant);
    expect(grant).toBeLessThan(stock);

    expect(writeEvent).toHaveBeenCalledTimes(1);
    expect(writeEvent).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({
        kind: 'GIFT_CANCELLED',
        actorUserId: 'a1',
        actorRole: 'ADMIN',
        giftRedemptionId: 'r1',
        meta: {
          giftId: 'g1',
          subjectUserId: 'u1',
          reason: 'Khách đổi ý',
          before: { status: 'READY' },
          after: { status: 'CANCELLED', refundedPoints: 30_000 },
        },
      }),
    );
    expect(h.notifier.giftCancelled).toHaveBeenCalledWith('u1', { id: 'r1', giftName: 'Túi vải Tubu' }, 30_000);
    expect(h.order.indexOf('tx end')).toBeLessThan(h.order.indexOf('giftCancelled'));
    expect(res.status).toBe('CANCELLED');
  });

  it('refundPoints false: no grant, refundedPoints 0, and an explicit choice skips the blocked/reversed check', async () => {
    h.tx.wasteGiftRedemption.findUniqueOrThrow.mockResolvedValue({ ...cancelledRow, refundedPoints: 0 });

    await h.svc.cancel('a1', 'r1', { reason: 'Khách đổi ý', refundPoints: false });

    expect(h.rewards.grant).not.toHaveBeenCalled();
    expect(h.tx.wasteGiftRedemption.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ refundedPoints: 0 }) }));
    expect(h.notifier.giftCancelled).toHaveBeenCalledWith('u1', { id: 'r1', giftName: 'Túi vải Tubu' }, 0);

    h.tx.wasteGiftRedemption.updateMany.mockClear();
    h.rewards.grant.mockClear();
    h.prisma.wasteUserFlags.findUnique.mockClear();
    h.prisma.wasteRequest.count.mockClear();
    h.prisma.wasteUserFlags.findUnique.mockResolvedValue({ blockedAt: new Date() });
    h.prisma.wasteRequest.count.mockResolvedValue(1);

    await expect(h.svc.cancel('a1', 'r1', { reason: 'Gian lận', refundPoints: false })).resolves.toBeDefined();

    expect(h.tx.wasteGiftRedemption.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ refundedPoints: 0 }) }));
    expect(h.rewards.grant).not.toHaveBeenCalled();
    expect(h.prisma.wasteUserFlags.findUnique).not.toHaveBeenCalled();
    expect(h.prisma.wasteRequest.count).not.toHaveBeenCalled();
  });

  it.each([
    ['blocked customer', () => h.prisma.wasteUserFlags.findUnique.mockResolvedValue({ blockedAt: new Date() })],
    ['customer with a REVERSED request', () => h.prisma.wasteRequest.count.mockResolvedValue(1)],
  ])('%s and no refundPoints in the body: 400, no transaction', async (_name, arrange) => {
    arrange();

    await expect(h.svc.cancel('a1', 'r1', { reason: 'Khách đổi ý' })).rejects.toThrow(
      new BadRequestException('Khách đang bị khoá hoặc từng bị thu hồi điểm đổi rác: hãy chọn rõ có hoàn điểm hay không.'),
    );

    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('grant returns false: 500 with the pinned sentence, no notification', async () => {
    h.rewards.grant.mockResolvedValue(false);

    await expect(h.svc.cancel('a1', 'r1', { reason: 'Khách đổi ý' })).rejects.toThrow(
      new InternalServerErrorException('Không ghi được điểm hoàn cho lượt đổi quà, thao tác đã huỷ.'),
    );

    expect(h.notifier.giftCancelled).not.toHaveBeenCalled();
  });

  it('a FULFILLED row is not cancellable; a row changed after the pre-read hits count 0 and writes nothing', async () => {
    h.prisma.wasteGiftRedemption.findUnique.mockResolvedValue({ ...ready, status: 'FULFILLED' });

    await expect(h.svc.cancel('a1', 'r1', { reason: 'Khách đổi ý' })).rejects.toThrow(new ConflictException('Chỉ huỷ được lượt đổi quà đang chờ nhận.'));
    expect(h.prisma.$transaction).not.toHaveBeenCalled();

    h.prisma.wasteGiftRedemption.findUnique.mockResolvedValue(ready);
    h.tx.wasteGiftRedemption.updateMany.mockResolvedValue({ count: 0 });

    await expect(h.svc.cancel('a1', 'r1', { reason: 'Khách đổi ý' })).rejects.toThrow(new ConflictException(ALREADY));

    expect(h.rewards.grant).not.toHaveBeenCalled();
    expect(h.tx.$executeRaw).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
    expect(h.notifier.giftCancelled).not.toHaveBeenCalled();
  });

  it('a STAFF caller is refused by assertActiveAdmin and nothing is written', async () => {
    h.setRole('STAFF');

    await expect(h.svc.cancel('a1', 'r1', { reason: 'Khách đổi ý' })).rejects.toBeInstanceOf(ForbiddenException);

    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });
});

describe('WasteGiftRedemptionsService.queue', () => {
  const user = { id: 'u1', fullName: 'Nguyễn Văn An', phone: '0987654321' };

  it('STAFF sees masked name and phone, the last two code characters, no code and no userId, and the overdue flag', async () => {
    h.setRole('STAFF');
    h.prisma.wasteGiftRedemption.findMany.mockResolvedValue([{ ...ready, claimExpiresAt: new Date(Date.now() - 86_400_000), user }]);

    const [row] = await h.svc.queue('s1', {});

    expect(row!.customerName).toBe(customerView(user, false).name);
    expect(row!.customerPhone).toBe(maskPhoneOrNull('0987654321'));
    expect(row!.codeLast2).toBe('GH');
    expect('code' in row!).toBe(false);
    expect('userId' in row!).toBe(false);
    expect(row!.overdue).toBe(true);
  });

  it('ADMIN sees the full code, userId, name and phone', async () => {
    h.prisma.wasteGiftRedemption.findMany.mockResolvedValue([{ ...ready, user }]);

    const [row] = await h.svc.queue('a1', {});

    expect(row).toEqual(expect.objectContaining({ code: 'QG-ABCDEFGH', userId: 'u1', customerName: 'Nguyễn Văn An', customerPhone: '0987654321', codeLast2: 'GH' }));
  });

  it('filters: overdue uses wasteGiftOverdueWhere(now), no filter is READY, an explicit status wins', async () => {
    const now = new Date('2026-10-17T03:00:00Z');
    jest.useFakeTimers().setSystemTime(now);

    await h.svc.queue('a1', { overdue: true });
    await h.svc.queue('a1', {});
    await h.svc.queue('a1', { status: 'FULFILLED' });

    const wheres = h.prisma.wasteGiftRedemption.findMany.mock.calls.map((c) => (c[0] as { where: unknown }).where);
    expect(wheres[0]).toEqual(wasteGiftOverdueWhere(now));
    expect(wheres[1]).toEqual({ status: 'READY' });
    expect(wheres[2]).toEqual({ status: 'FULFILLED' });
    expect(h.prisma.wasteGiftRedemption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ claimExpiresAt: 'asc' }, { createdAt: 'asc' }],
        take: 200,
        include: { user: { select: { id: true, fullName: true, phone: true } } },
      }),
    );
  });
});
