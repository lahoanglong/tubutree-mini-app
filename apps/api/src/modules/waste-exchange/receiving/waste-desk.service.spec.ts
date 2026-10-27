import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { writeWasteEvent } from '../core/waste-events';
import { vnMonthKey } from '../../../common/vn-time';
import { lookupMissMeta } from '../waste-codes';
import { pointUsage, staffConfirmedToday } from './waste-quota';
import { WasteDeskService } from './waste-desk.service';

jest.mock('./waste-quota');
jest.mock('../core/waste-events');

const HOUR = 3_600_000;

const wh = (o: Record<string, unknown> = {}) => ({
  pointId: 'wh', kind: 'WAREHOUSE', name: 'Kho Tubu', status: 'ACTIVE', giftHandoverEnabled: false, monthlyQuotaPoints: null,
  actorRole: 'STAFF', myRole: 'STAFF', caller: { id: 's1', phone: null, role: 'STAFF' }, ...o,
});
const partner = (o: Record<string, unknown> = {}) => ({
  pointId: 'p1', kind: 'PARTNER', name: 'Cửa hàng An', status: 'ACTIVE', giftHandoverEnabled: true, monthlyQuotaPoints: 100_000,
  actorRole: 'POINT_STAFF', myRole: 'OWNER', caller: { id: 's1', phone: null, role: 'CUSTOMER' }, ...o,
});

const USER = { id: 'u1', fullName: 'Nguyễn Văn An', phone: '0901234567' };
const reqRow = (o: Record<string, unknown> = {}) => ({
  id: 'r1', code: 'TR-ABCDE', method: 'DROP_OFF', status: 'OPEN', pointId: 'p1', estimatedPoints: 20_000,
  confirmedByUserId: null, closedAt: null, user: USER,
  lines: [
    { itemId: 'i1', itemName: 'Pin đã dùng', unitLabel: 'viên', unitsPerPoint: 10, pointsPerGroup: 5_000, declaredQty: 4, receivedQty: null, item: { hazardous: true } },
    { itemId: 'i2', itemName: 'Lon nhôm', unitLabel: 'lon', unitsPerPoint: 1, pointsPerGroup: 1_000, declaredQty: 2, receivedQty: null, item: { hazardous: false } },
  ],
  ...o,
});
const giftRow = (o: Record<string, unknown> = {}) => ({
  id: 'g1', code: 'QG-23456789', status: 'READY', giftName: 'Miễn phí vận chuyển', claimExpiresAt: null, user: USER, ...o,
});

interface Setup {
  accessList?: Record<string, unknown>[];
  enabled?: boolean;
  request?: Record<string, unknown> | null;
  gift?: Record<string, unknown> | null;
  perks?: { id: string; perkText: string | null; perkPendingText: string | null }[];
  usage?: number;
  confirmedToday?: number;
  cap?: number;
  activeOwnerRow?: boolean;
  lockedPending?: string | null;
}

function setup(o: Setup = {}) {
  let inTx = false;
  (pointUsage as jest.Mock).mockReset().mockResolvedValue({ pointsUsed: o.usage ?? 30_000, confirmations: 3 });
  (staffConfirmedToday as jest.Mock).mockReset().mockResolvedValue(o.confirmedToday ?? 10_000);
  (writeWasteEvent as jest.Mock).mockReset().mockResolvedValue({ id: 'ev1' });
  const list = o.accessList ?? [partner(), wh()];
  const access = {
    listOperablePoints: jest.fn().mockResolvedValue(list),
    assertPointAccess: jest.fn(async (_u: string, pointId: string) => {
      const found = list.find((p) => p.pointId === pointId);
      if (!found) throw new ForbiddenException('no access');
      return found;
    }),
  };
  const config = { snapshot: jest.fn().mockResolvedValue({ enabled: o.enabled ?? true, staffDailyCapPoints: o.cap ?? 1_000_000 }) };
  const tx = {
    $queryRaw: jest.fn(async () => {
      if (!inTx) throw new Error('lock outside $transaction');
      return [{ id: 'p1', kind: 'PARTNER', name: 'Cửa hàng An', perkText: null, perkPendingText: o.lockedPending ?? null }];
    }),
    wastePointStaff: {
      findFirst: jest.fn(async () => {
        if (!inTx) throw new Error('read outside $transaction');
        return o.activeOwnerRow === false ? null : { id: 'st1' };
      }),
    },
    wastePoint: {
      update: jest.fn(async () => {
        if (!inTx) throw new Error('write outside $transaction');
        return {};
      }),
    },
  };
  const prisma = {
    wastePoint: {
      findMany: jest.fn(async () => o.perks ?? list.map((p) => ({ id: p.pointId, perkText: null, perkPendingText: null }))),
      update: tx.wastePoint.update,
    },
    wasteRequest: { findUnique: jest.fn().mockResolvedValue(o.request === undefined ? null : o.request) },
    wasteGiftRedemption: { findUnique: jest.fn().mockResolvedValue(o.gift === undefined ? null : o.gift) },
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => {
      inTx = true;
      try {
        return await cb(tx);
      } finally {
        inTx = false;
      }
    }),
  };
  const svc = new WasteDeskService(prisma as never, config as never, access as never);
  return { svc, prisma, tx, access, config };
}

const missCall = (extra: Record<string, unknown>) =>
  expect(writeWasteEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'LOOKUP_MISS', ...extra }));

describe('WasteDeskService.points', () => {
  it('maps quota, role, gift handover flag and the daily cap', async () => {
    const { svc, access } = setup({ accessList: [partner(), partner({ pointId: 'p2', giftHandoverEnabled: false, name: 'Cửa hàng B' }), wh()], usage: 30_000, confirmedToday: 10_000 });
    const out = await svc.points('s1');
    expect(access.listOperablePoints).toHaveBeenCalledWith('s1', true);
    expect(pointUsage).toHaveBeenCalledWith(expect.anything(), 'p1', vnMonthKey(new Date()));
    expect(pointUsage).not.toHaveBeenCalledWith(expect.anything(), 'wh', expect.anything());
    expect(staffConfirmedToday).toHaveBeenCalledWith(expect.anything(), 's1', expect.any(Date));
    expect(out[0]).toEqual({
      id: 'p1', kind: 'PARTNER', name: 'Cửa hàng An', giftHandoverEnabled: true, myRole: 'OWNER',
      quota: { limit: 100_000, used: 30_000, remaining: 70_000 }, perkText: null, perkPendingText: null, staffDailyCapRemaining: 990_000,
    });
    expect(out[1]!.giftHandoverEnabled).toBe(false);
    expect(out[2]).toMatchObject({ id: 'wh', kind: 'WAREHOUSE', myRole: 'STAFF', quota: null, staffDailyCapRemaining: 990_000 });
  });

  it('reports the warehouse as handing over gifts whatever its column says', async () => {
    const { svc } = setup({ accessList: [wh({ giftHandoverEnabled: false })] });
    const out = await svc.points('s1');
    expect(out[0]!.giftHandoverEnabled).toBe(true);
  });

  it('never reports a negative remaining quota or daily cap', async () => {
    const { svc } = setup({ accessList: [partner()], usage: 120_000, confirmedToday: 1_500_000 });
    const [p] = await svc.points('s1');
    expect(p!.quota).toEqual({ limit: 100_000, used: 120_000, remaining: 0 });
    expect(p!.staffDailyCapRemaining).toBe(0);
  });

  it('carries the live and pending perk text', async () => {
    const { svc } = setup({ accessList: [partner()], perks: [{ id: 'p1', perkText: 'Giảm 5%', perkPendingText: 'Giảm 10%' }] });
    const [p] = await svc.points('s1');
    expect(p).toMatchObject({ perkText: 'Giảm 5%', perkPendingText: 'Giảm 10%' });
  });

  it('with the programme off reads the warehouse-only list and does not 403', async () => {
    const { svc, access } = setup({ enabled: false, accessList: [wh()] });
    const out = await svc.points('s1');
    expect(access.listOperablePoints).toHaveBeenCalledWith('s1', false);
    expect(out.map((p) => p.id)).toEqual(['wh']);
  });
});

describe('WasteDeskService.lookup', () => {
  it.each(['abcde', 'TRABCDE', 'tr abcde'])('chấp nhận mã gõ thiếu hoặc sai dạng %j', async (typed) => {
    const { svc, prisma } = setup({ accessList: [partner()], request: reqRow() });
    await svc.lookup('s1', typed);
    expect(prisma.wasteRequest.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'TR-ABCDE' } }));
  });

  it('returns a masked REQUEST for an open drop-off at the caller point', async () => {
    const { svc, prisma } = setup({ accessList: [partner()], request: reqRow() });
    const res = await svc.lookup('s1', ' tr-abcde ');
    expect(prisma.wasteRequest.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'TR-ABCDE' } }));
    expect(res).toEqual({
      type: 'REQUEST',
      request: {
        id: 'r1', code: 'TR-ABCDE', method: 'DROP_OFF', status: 'OPEN', pointId: 'p1', customerName: 'An***', customerPhone: '090****567', estimatedPoints: 20_000,
        lines: [
          { itemId: 'i1', itemName: 'Pin đã dùng', unitLabel: 'viên', unitsPerPoint: 10, pointsPerGroup: 5_000, declaredQty: 4, receivedQty: null, hazardous: true },
          { itemId: 'i2', itemName: 'Lon nhôm', unitLabel: 'lon', unitsPerPoint: 1, pointsPerGroup: 1_000, declaredQty: 2, receivedQty: null, hazardous: false },
        ],
      },
    });
    expect(JSON.stringify(res)).not.toContain('u1');
    expect(writeWasteEvent).not.toHaveBeenCalled();
  });

  it('masks the customer for an ADMIN caller too', async () => {
    const { svc } = setup({ accessList: [wh({ actorRole: 'ADMIN', caller: { id: 's1', phone: null, role: 'ADMIN' } })], request: reqRow({ pointId: 'wh', method: 'MAIL_IN', status: 'RECEIVED' }) });
    const res = await svc.lookup('s1', 'TR-ABCDE');
    expect(res).toMatchObject({ type: 'REQUEST', request: { customerName: 'An***', customerPhone: '090****567' } });
  });

  it.each([
    ['DROP_OFF', 'IN_TRANSIT'],
    ['DROP_OFF', 'RECEIVED'],
    ['MAIL_IN', 'COMPLETED'],
    ['PICKUP', 'EXPIRED'],
  ])('refuses a %s request in status %s that the caller did not close', async (method, status) => {
    const { svc } = setup({ accessList: [partner()], request: reqRow({ method, status }) });
    await expect(svc.lookup('s1', 'TR-ABCDE')).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['OPEN', 'IN_TRANSIT', 'RECEIVED'])('shows a MAIL_IN request in status %s', async (status) => {
    const { svc } = setup({ accessList: [wh()], request: reqRow({ method: 'MAIL_IN', status, pointId: 'wh' }) });
    expect(await svc.lookup('s1', 'TR-ABCDE')).toMatchObject({ type: 'REQUEST' });
  });

  it('answers 404 and writes LOOKUP_MISS for a request at another point (single point caller)', async () => {
    const { svc } = setup({ accessList: [partner()], request: reqRow({ pointId: 'other' }) });
    await expect(svc.lookup('s1', 'TR-ABCDE')).rejects.toThrow(new NotFoundException('Không tìm thấy mã'));
    expect(writeWasteEvent).toHaveBeenCalledTimes(1);
    missCall({ pointId: 'p1', actorUserId: 's1', actorRole: 'POINT_STAFF' });
  });

  it('groups a miss of a warehouse + partner caller under the partner point', async () => {
    const { svc } = setup({ accessList: [wh(), partner({ pointId: 'p2' })], request: reqRow({ pointId: 'other' }) });
    await expect(svc.lookup('s1', 'TR-ABCDE')).rejects.toThrow(new NotFoundException('Không tìm thấy mã'));
    missCall({ pointId: 'p2', actorRole: 'STAFF', meta: expect.objectContaining({ route: 'DESK', pointIds: ['wh', 'p2'] }) });
  });

  it('groups a miss of a warehouse-only caller under the warehouse', async () => {
    const { svc } = setup({ accessList: [wh()], request: null });
    await expect(svc.lookup('s1', 'TR-ABCDE')).rejects.toBeInstanceOf(NotFoundException);
    missCall({ pointId: 'wh' });
  });

  it('shows a request the caller completed 2 hours ago and hides one completed 25 hours ago', async () => {
    const recent = reqRow({ status: 'COMPLETED', confirmedByUserId: 's1', closedAt: new Date(Date.now() - 2 * HOUR) });
    expect(await setup({ accessList: [partner()], request: recent }).svc.lookup('s1', 'TR-ABCDE')).toMatchObject({ type: 'REQUEST' });
    const old = reqRow({ status: 'COMPLETED', confirmedByUserId: 's1', closedAt: new Date(Date.now() - 25 * HOUR) });
    await expect(setup({ accessList: [partner()], request: old }).svc.lookup('s1', 'TR-ABCDE')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('shows a REJECTED request closed recently by the caller', async () => {
    const r = reqRow({ status: 'REJECTED', confirmedByUserId: 's1', closedAt: new Date(Date.now() - HOUR) });
    expect(await setup({ accessList: [partner()], request: r }).svc.lookup('s1', 'TR-ABCDE')).toMatchObject({ type: 'REQUEST' });
  });

  it('hides a recently completed request that another staff confirmed', async () => {
    const r = reqRow({ status: 'COMPLETED', confirmedByUserId: 'other-staff', closedAt: new Date(Date.now() - 2 * HOUR) });
    await expect(setup({ accessList: [partner()], request: r }).svc.lookup('s1', 'TR-ABCDE')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps the typed text out of the LOOKUP_MISS meta unless it looks like a code', async () => {
    const { svc, prisma } = setup({ accessList: [partner()] });
    await expect(svc.lookup('s1', 'hello world')).rejects.toThrow(new NotFoundException('Không tìm thấy mã'));
    expect(prisma.wasteRequest.findUnique).not.toHaveBeenCalled();
    expect(prisma.wasteGiftRedemption.findUnique).not.toHaveBeenCalled();
    expect(writeWasteEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'LOOKUP_MISS', meta: { ...lookupMissMeta('hello world'), route: 'DESK', pointIds: ['p1'] } }),
    );
    const meta = (writeWasteEvent as jest.Mock).mock.calls[0]![1].meta;
    expect(meta).toEqual({ length: 10, classes: 'L', route: 'DESK', pointIds: ['p1'] });
    expect(JSON.stringify(meta)).not.toContain('hello');
  });

  it('returns a masked GIFT for a READY gift at the warehouse', async () => {
    const { svc, prisma } = setup({ accessList: [wh()], gift: giftRow() });
    const res = await svc.lookup('s1', 'QG-23456789');
    expect(prisma.wasteGiftRedemption.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'QG-23456789' } }));
    expect(res).toEqual({
      type: 'GIFT',
      redemption: { id: 'g1', giftName: 'Miễn phí vận chuyển', customerName: 'An***', status: 'READY', claimExpiresAt: null },
    });
    expect(JSON.stringify(res)).not.toContain('u1');
    expect(JSON.stringify(res)).not.toContain('Nguyễn Văn An');
  });

  it('serialises claimExpiresAt as ISO', async () => {
    const at = new Date('2026-11-01T03:00:00.000Z');
    const { svc } = setup({ accessList: [wh()], gift: giftRow({ claimExpiresAt: at }) });
    expect(await svc.lookup('s1', 'QG-23456789')).toMatchObject({ redemption: { claimExpiresAt: '2026-11-01T03:00:00.000Z' } });
  });

  it('shows a gift to a partner point that hands gifts over and hides it from one that does not', async () => {
    expect(await setup({ accessList: [partner()], gift: giftRow() }).svc.lookup('s1', 'QG-23456789')).toMatchObject({ type: 'GIFT' });
    const { svc } = setup({ accessList: [partner({ giftHandoverEnabled: false })], gift: giftRow() });
    await expect(svc.lookup('s1', 'QG-23456789')).rejects.toBeInstanceOf(NotFoundException);
    missCall({ pointId: 'p1' });
  });

  it('hides a gift that is not READY', async () => {
    const { svc } = setup({ accessList: [wh()], gift: giftRow({ status: 'FULFILLED' }) });
    await expect(svc.lookup('s1', 'QG-23456789')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 404 for an unknown code', async () => {
    const { svc } = setup({ accessList: [wh()], gift: null });
    await expect(svc.lookup('s1', 'QG-23456789')).rejects.toThrow(new NotFoundException('Không tìm thấy mã'));
    missCall({ pointId: 'wh' });
  });

  it('403 when the caller has no active point', async () => {
    const { svc } = setup({ accessList: [] });
    await expect(svc.lookup('s1', 'TR-ABCDE')).rejects.toThrow(new ForbiddenException('Bạn chưa được gắn với điểm nhận nào đang hoạt động'));
    expect(writeWasteEvent).not.toHaveBeenCalled();
  });

  it('403 with the programme-off text when the programme is off and the list is empty', async () => {
    const { svc, access } = setup({ enabled: false, accessList: [] });
    await expect(svc.lookup('s1', 'TR-ABCDE')).rejects.toThrow(new ForbiddenException('Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.'));
    expect(access.listOperablePoints).toHaveBeenCalledWith('s1', false);
  });
});

describe('WasteDeskService.submitPerk', () => {
  it('stores the pending text for the OWNER and writes one PERK_SUBMITTED event', async () => {
    const { svc, tx, access } = setup({ accessList: [partner()] });
    const dto = await svc.submitPerk('s1', 'p1', { perkText: '  Giảm 10% hoá đơn  ' });
    expect(access.assertPointAccess).toHaveBeenCalledWith('s1', 'p1', { programmeEnabled: true });
    expect(tx.wastePoint.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { perkPendingText: 'Giảm 10% hoá đơn' } });
    expect(writeWasteEvent).toHaveBeenCalledTimes(1);
    expect(writeWasteEvent).toHaveBeenCalledWith(tx, {
      kind: 'PERK_SUBMITTED', actorUserId: 's1', actorRole: 'POINT_STAFF', pointId: 'p1',
      meta: { before: { perkPendingText: null }, after: { perkPendingText: 'Giảm 10% hoá đơn' } },
    });
    expect(dto.id).toBe('p1');
  });

  it('takes the point lock before the owner re-check and the update, and reports the locked pending text as before', async () => {
    const { svc, tx } = setup({ accessList: [partner()], lockedPending: 'Chữ cũ' });
    await svc.submitPerk('s1', 'p1', { perkText: 'Chữ mới' });
    const sql = (tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('?');
    expect(sql).toContain('FROM "waste_points"');
    expect(sql).toContain('FOR NO KEY UPDATE');
    const lock = tx.$queryRaw.mock.invocationCallOrder[0]!;
    expect(lock).toBeLessThan(tx.wastePointStaff.findFirst.mock.invocationCallOrder[0]!);
    expect(tx.wastePointStaff.findFirst.mock.invocationCallOrder[0]!).toBeLessThan(tx.wastePoint.update.mock.invocationCallOrder[0]!);
    expect(tx.wastePointStaff.findFirst).toHaveBeenCalledWith({ where: { pointId: 'p1', userId: 's1', role: 'OWNER', isActive: true }, select: { id: true } });
    expect(writeWasteEvent).toHaveBeenCalledWith(tx, expect.objectContaining({ meta: { before: { perkPendingText: 'Chữ cũ' }, after: { perkPendingText: 'Chữ mới' } } }));
  });

  it('403 and nothing written when the access check passed but the owner row is gone by the time the lock is held', async () => {
    const { svc, tx } = setup({ accessList: [partner()], activeOwnerRow: false });
    await expect(svc.submitPerk('s1', 'p1', { perkText: 'x' })).rejects.toThrow(new ForbiddenException('Chỉ chủ điểm nhận mới gửi được ưu đãi riêng'));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.wastePoint.update).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
  });

  it('403 for a STAFF member of the point', async () => {
    const { svc, tx } = setup({ accessList: [partner({ myRole: 'STAFF' })] });
    await expect(svc.submitPerk('s1', 'p1', { perkText: 'x' })).rejects.toThrow(new ForbiddenException('Chỉ chủ điểm nhận mới gửi được ưu đãi riêng'));
    expect(tx.wastePoint.update).not.toHaveBeenCalled();
  });

  it('403 at the warehouse', async () => {
    const { svc } = setup({ accessList: [wh()] });
    await expect(svc.submitPerk('s1', 'wh', { perkText: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(writeWasteEvent).not.toHaveBeenCalled();
  });

  it('400 for a blank text', async () => {
    const { svc, tx } = setup({ accessList: [partner()] });
    await expect(svc.submitPerk('s1', 'p1', { perkText: '   ' })).rejects.toThrow(new BadRequestException('Nội dung ưu đãi không được để trống'));
    expect(tx.wastePoint.update).not.toHaveBeenCalled();
    expect(writeWasteEvent).not.toHaveBeenCalled();
  });
});
