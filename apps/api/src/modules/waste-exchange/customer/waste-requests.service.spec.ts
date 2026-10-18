import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { WasteRequestsService } from './waste-requests.service';
import * as mapper from './waste-request.mapper';
import { WASTE_REQUEST_FULL_INCLUDE, WASTE_REQUEST_SUMMARY_INCLUDE } from './waste-request.mapper';
import { computeWastePublicFlags } from '../core/waste-public-config';

jest.mock('../core/waste-public-config', () => ({ computeWastePublicFlags: jest.fn().mockResolvedValue({ enabled: true, dropoff: true, mailin: true, pickup: true }) }));

const make = (found: unknown) => {
  const findFirst = jest.fn().mockResolvedValue(found);
  const findMany = jest.fn().mockResolvedValue([]);
  const access = { availablePointIds: jest.fn().mockResolvedValue(new Set(['wh'])) };
  const prisma = { wasteRequest: { findFirst, findMany } } as unknown as PrismaService;
  return { svc: new WasteRequestsService(prisma, access as never, {} as never, {} as never, {} as never), findFirst, findMany, access };
};

describe('WasteRequestsService reads (ownership, spec 15.1)', () => {
  it('detail looks up by id AND userId; another user\'s id is the same 404 as a missing id', async () => {
    const { svc, findFirst } = make(null);
    await expect(svc.detail('uB', 'rA')).rejects.toThrow(new NotFoundException('Không tìm thấy yêu cầu'));
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'rA', userId: 'uB' }, include: WASTE_REQUEST_FULL_INCLUDE });
  });
  it('byOrder looks up by orderId AND userId', async () => {
    const { svc, findFirst } = make(null);
    await expect(svc.byOrder('uB', 'oA')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith({ where: { orderId: 'oA', userId: 'uB' }, include: WASTE_REQUEST_FULL_INCLUDE });
  });
  it('list: own rows, newest first, at most 100', async () => {
    const { svc, findMany } = make(null);
    await expect(svc.list('u1')).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, include: WASTE_REQUEST_SUMMARY_INCLUDE, orderBy: { createdAt: 'desc' }, take: 100 });
  });
  it('detail passes pointAvailable = availablePointIds([row.pointId]).has(row.pointId) to the mapper', async () => {
    const row = { id: 'r1', pointId: 'p9' };
    const { svc, access } = make(row);
    const spy = jest.spyOn(mapper, 'toRequestDetail').mockReturnValue({ id: 'r1' } as never);
    await expect(svc.detail('u1', 'r1')).resolves.toEqual({ id: 'r1' });
    expect(access.availablePointIds).toHaveBeenCalledWith(expect.anything(), ['p9']);
    expect(spy).toHaveBeenCalledWith(row, false);
    spy.mockRestore();
  });
});

const SNAP = { enabled: true, laneDropoff: true, laneMailin: true, lanePickup: false, mailinMinPoints: 15_000, pickupMinPoints: 10_000, customerMonthlyCapPoints: 60_000, maxOpenRequests: 3, requestHoldDays: 7 };
type CreatePrior = { id: string; method?: string; pointId?: string; lines?: { itemId: string; declaredQty: number }[] } | null;
function makeCreate(o: { prior: CreatePrior; hold?: unknown; failWith?: unknown[]; reread?: CreatePrior; codeTaken?: number; snap?: Partial<typeof SNAP> }) {
  const order: string[] = [];
  const fails = [...(o.failWith ?? [])];
  let taken = o.codeTaken ?? 0;
  const tx = {
    $executeRaw: jest.fn(async (..._sql: unknown[]) => { order.push('lock'); return 1; }),
    wasteRequest: {
      findUnique: jest.fn(async (args: { where: { code?: string; userId_idempotencyKey?: unknown } }) => {
        if (args.where.code === undefined) { order.push('replay'); return o.prior; }
        if (!order.includes('codeCheck')) order.push('codeCheck');
        if (taken > 0) { taken -= 1; return { id: 'taken' }; }
        return null;
      }),
      create: jest.fn(async (_args: { data: Record<string, unknown> }) => { order.push('create'); return { id: 'r1' }; }),
    },
    wasteEvent: { create: jest.fn(async (_args: { data: Record<string, unknown> }) => { order.push('event'); return { id: 'e1' }; }) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      const f = fails.shift();
      if (f !== undefined) throw f;
      return fn(tx);
    }),
    wasteRequest: { findUnique: jest.fn().mockResolvedValue(o.reread ?? null) },
  };
  const hold = { validateAndHold: jest.fn(async (_tx: unknown, _input: unknown, _cfg: unknown) => { order.push('hold'); return o.hold; }) };
  const config = { snapshot: jest.fn().mockResolvedValue({ ...SNAP, ...o.snap }) };
  const svc = new WasteRequestsService(prisma as never, {} as never, hold as never, config as never, {} as never);
  const loadDetail = jest.spyOn(svc, 'loadDetail').mockImplementation(async (...args: unknown[]) => ({ id: args[2] }) as never);
  return { svc, tx, prisma, hold, loadDetail, order };
}

describe('WasteRequestsService.create (spec 11.2, 15.2)', () => {
  const HOLD = { pointId: 'p1', capDayKey: '2026-10-17', capMonthKey: '2026-10', expiresAt: new Date('2026-10-24T03:00:00Z'), lines: [{ itemId: 'carton', itemCode: 'CARTON', itemName: 'Thùng carton', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1_000, dropsPerUnit: 2, gramsPerUnit: 300, declaredQty: 5, hazardous: false }], estimatedPoints: 5_000, estimatedDrops: 10 };
  const body = { method: 'DROP_OFF' as const, pointId: 'p1', lines: [{ itemId: 'carton', declaredQty: 5 }], consent: true as const };
  beforeEach(() => jest.mocked(computeWastePublicFlags).mockClear());
  it('takes the customer lock first, then the replay read, then validateAndHold; writes one OPEN request and one CUSTOMER event', async () => {
    const { svc, tx, hold, order } = makeCreate({ prior: null, hold: HOLD });
    await svc.create('u1', 'key-00000001', body);
    expect(order).toEqual(['lock', 'replay', 'hold', 'codeCheck', 'create', 'event']);
    expect(tx.wasteRequest.create.mock.calls[0]![0].data).toMatchObject({ userId: 'u1', method: 'DROP_OFF', status: 'OPEN', pointId: 'p1', estimatedPoints: 5_000, estimatedDrops: 10, capDayKey: '2026-10-17', capMonthKey: '2026-10', expiresAt: HOLD.expiresAt, idempotencyKey: 'key-00000001', consentVersion: '2026-10-17.1' });
    expect(tx.wasteRequest.create.mock.calls[0]![0].data.code).toMatch(/^TR-[2-9A-HJKMNP-TV-Z]{5}$/);
    expect(tx.wasteEvent.create.mock.calls[0]![0].data).toMatchObject({ kind: 'REQUEST_CREATED', actorUserId: 'u1', actorRole: 'CUSTOMER', pointId: 'p1', meta: { before: null, after: { method: 'DROP_OFF', pointId: 'p1', estimatedPoints: 5_000, lines: body.lines } } });
    expect(hold.validateAndHold.mock.calls[0]![1]).toMatchObject({ path: 'CREATE', userId: 'u1', method: 'DROP_OFF', pointId: 'p1' });
  });
  it('same key + same content returns the stored request without any check (even at max open)', async () => {
    const { svc, tx, hold, loadDetail } = makeCreate({ prior: { id: 'r0', method: 'DROP_OFF', pointId: 'p1', lines: [{ itemId: 'carton', declaredQty: 5 }] } });
    await svc.create('u1', 'key-00000001', body);
    expect(hold.validateAndHold).not.toHaveBeenCalled();
    expect(tx.wasteRequest.create).not.toHaveBeenCalled();
    expect(tx.wasteEvent.create).not.toHaveBeenCalled();
    expect(loadDetail).toHaveBeenCalledWith(expect.anything(), 'u1', 'r0');
  });
  it.each<[string, Record<string, unknown>, Record<string, unknown>, boolean]>([
    ['MAIL_IN ignores pointId', { method: 'MAIL_IN', pointId: 'wh' }, { method: 'MAIL_IN', pointId: 'anything', packagingConsent: true, postagePaidConsent: true }, true],
    ['PICKUP ignores pointId', { method: 'PICKUP', pointId: 'wh' }, { method: 'PICKUP', pointId: undefined }, true],
    ['DROP_OFF compares pointId', { method: 'DROP_OFF', pointId: 'p1' }, { method: 'DROP_OFF', pointId: 'p2' }, false],
    ['different qty', { method: 'DROP_OFF', pointId: 'p1', lines: [{ itemId: 'carton', declaredQty: 6 }] }, {}, false],
    ['different method', { method: 'MAIL_IN', pointId: 'wh' }, {}, false],
    ['line order does not matter', { method: 'DROP_OFF', pointId: 'p1', lines: [{ itemId: 'film', declaredQty: 1 }, { itemId: 'carton', declaredQty: 5 }] }, { lines: [{ itemId: 'carton', declaredQty: 5 }, { itemId: 'film', declaredQty: 1 }] }, true],
  ])('replay rule: %s', async (_n, prior, over, same) => {
    const { svc } = makeCreate({ prior: { id: 'r0', lines: body.lines, ...prior } });
    const call = svc.create('u1', 'key-00000001', { ...body, ...over } as never);
    if (same) {
      await expect(call).resolves.toBeDefined();
    } else {
      await expect(call).rejects.toThrow(new ConflictException('Mã chống gửi lặp này đã dùng cho một yêu cầu khác'));
      await expect(call).rejects.toBeInstanceOf(ConflictException);
    }
  });
  it('MAIL_IN without both commitments -> 400 after the replay check, nothing held', async () => {
    const { svc, hold } = makeCreate({ prior: null });
    const call = svc.create('u1', 'key-00000001', { ...body, method: 'MAIL_IN', packagingConsent: true });
    await expect(call).rejects.toThrow(new BadRequestException('Bạn cần đồng ý quy tắc đóng gói và cam kết đã trả đủ cước để gửi về kho'));
    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    expect(hold.validateAndHold).not.toHaveBeenCalled();
  });
  it('MAIL_IN passes pointId null to validateAndHold', async () => {
    const { svc, hold } = makeCreate({ prior: null, hold: { ...HOLD, pointId: 'wh' } });
    await svc.create('u1', 'key-00000001', { ...body, method: 'MAIL_IN', pointId: 'p9', packagingConsent: true, postagePaidConsent: true });
    expect(hold.validateAndHold.mock.calls[0]![1]).toMatchObject({ method: 'MAIL_IN', pointId: null });
  });
  it('PICKUP while Gomdon is off passes lanePickup false to validateAndHold (spec 11.5)', async () => {
    const { svc, hold } = makeCreate({ prior: null, hold: { ...HOLD, pointId: 'wh' }, snap: { lanePickup: true } });
    jest.mocked(computeWastePublicFlags).mockResolvedValueOnce({ enabled: true, dropoff: true, mailin: true, pickup: false });
    await svc.create('u1', 'key-00000001', { method: 'PICKUP', lines: [{ itemId: 'carton', declaredQty: 10 }], consent: true });
    expect(hold.validateAndHold.mock.calls[0]![2]).toMatchObject({ lanePickup: false });
  });
  it('DROP_OFF never reads the public flags', async () => {
    const { svc } = makeCreate({ prior: null, hold: HOLD });
    await svc.create('u1', 'key-00000001', body);
    expect(computeWastePublicFlags).not.toHaveBeenCalled();
  });
  it.each([
    ['a plain error carrying code and meta', Object.assign(new Error('dup'), { code: 'P2002', meta: { target: ['userId', 'idempotencyKey'] } })],
    ['a Prisma known request error', new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test', meta: { target: ['userId', 'idempotencyKey'] } })],
  ])('a P2002 on (userId, idempotencyKey) escaping the tx (%s) is re-read outside and replayed', async (_n, dup) => {
    const { svc, loadDetail, prisma } = makeCreate({ prior: null, hold: HOLD, failWith: [dup], reread: { id: 'r7', method: 'DROP_OFF', pointId: 'p1', lines: body.lines } });
    await svc.create('u1', 'key-00000001', body);
    expect(loadDetail).toHaveBeenCalledWith(prisma, 'u1', 'r7');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('a P2002 on code re-runs the whole transaction once; a second one is rethrown (registry 4.3)', async () => {
    const dupCode = () => Object.assign(new Error('dup'), { code: 'P2002', meta: { target: ['code'] } });
    const once = makeCreate({ prior: null, hold: HOLD, failWith: [dupCode()] });
    await once.svc.create('u1', 'key-00000001', body);
    expect(once.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(once.loadDetail).toHaveBeenCalledWith(once.prisma, 'u1', 'r1');
    const twice = makeCreate({ prior: null, hold: HOLD, failWith: [dupCode(), dupCode()] });
    await expect(twice.svc.create('u1', 'key-00000001', body)).rejects.toMatchObject({ code: 'P2002' });
    expect(twice.prisma.$transaction).toHaveBeenCalledTimes(2);
  });
  it('a TR code taken at the pre-insert check is regenerated (max 5 tries)', async () => {
    const { svc, tx } = makeCreate({ prior: null, hold: HOLD, codeTaken: 2 });
    await svc.create('u1', 'key-00000001', body);
    expect(tx.wasteRequest.findUnique.mock.calls.filter((c) => c[0].where.code !== undefined).length).toBe(3);
  });
  it('five taken TR codes -> 409 Vui lòng thử lại, nothing created', async () => {
    const { svc, tx } = makeCreate({ prior: null, hold: HOLD, codeTaken: 5 });
    const call = svc.create('u1', 'key-00000001', body);
    await expect(call).rejects.toThrow(new ConflictException('Vui lòng thử lại'));
    await expect(call).rejects.toBeInstanceOf(ConflictException);
    expect(tx.wasteRequest.create).not.toHaveBeenCalled();
  });
});
