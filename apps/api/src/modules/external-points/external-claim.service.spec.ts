import { HttpException } from '@nestjs/common';
import { ExternalClaimService } from './external-claim.service';

const NOW = new Date();
const flagOn = { 'loyalty.marketplace_claim_enabled': true };

function build(opts: { config?: Record<string, unknown>; order?: Record<string, unknown> | null; user?: Record<string, unknown> | null; appOrder?: boolean } = {}) {
  const calls: string[] = [];
  const attemptCreate = jest.fn(async () => ({}));
  const tx = {
    $executeRaw: jest.fn(async () => {
      calls.push('lock');
      return 1;
    }),
    $queryRaw: jest.fn(async () => {
      calls.push('rowlock');
      return [];
    }),
    user: { findUnique: jest.fn(async () => (opts.user === undefined ? { id: 'u1', phone: '0912345678', zaloId: 'z1', isBlocked: false, role: 'CUSTOMER' } : opts.user)) },
    externalClaimAttempt: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: attemptCreate,
      createMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => null as unknown),
      findUnique: jest.fn(async () => null as unknown),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    externalClaimEvent: { create: jest.fn(async () => ({})) },
    order: { findFirst: jest.fn(async () => (opts.appOrder ? { id: 'o1' } : null)) },
    externalOrder: {
      findFirst: jest.fn(async () => (opts.order ? { id: 'x1' } : null)),
      findUniqueOrThrow: jest.fn(async () => opts.order),
    },
    externalPointsClaim: {
      findUnique: jest.fn(async () => null as unknown),
      findUniqueOrThrow: jest.fn(async () => ({ points: 2_000, releaseAt: null })),
      findFirst: jest.fn(async () => null as unknown),
      count: jest.fn(async () => 0),
      aggregate: jest.fn(async () => ({ _sum: { points: 0 } })),
      createManyAndReturn: jest.fn(async () => [{ id: 'c1' }]),
    },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const config = { get: jest.fn(async (k: string, d: unknown) => (opts.config && k in opts.config ? opts.config[k] : d)) };
  const lookup = { lookupAndIngest: jest.fn(async () => false) };
  const notifications = { notify: jest.fn(async () => undefined) };
  const svc = new ExternalClaimService(prisma as never, config as never, lookup as never, notifications as never);
  return { svc, tx, calls, lookup, notifications, attemptCreate };
}

const order = (over: Record<string, unknown> = {}) => ({
  id: 'x1',
  pancakeOrderId: 'P1',
  source: 'MARKETPLACE',
  channel: 'shopee',
  status: 'OPEN',
  trackingCode: 'SPXVN0123456789',
  trackingCodes: ['SPXVN0123456789'],
  marketplaceOrderSn: null,
  goodsValue: 200_000,
  phoneLast3: '678',
  pancakeInsertedAt: new Date(NOW.getTime() - 864e5),
  firstSeenAt: NOW,
  deliveredAt: null,
  ...over,
});

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return ((e as HttpException).getResponse() as { code: string }).code;
  }
};

describe('ExternalClaimService.submit', () => {
  it('cờ tắt: 404 DISABLED ngay, không chạm DB', async () => {
    const { svc, tx } = build();
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('DISABLED');
    expect(tx.externalOrder.findFirst).not.toHaveBeenCalled();
  });
  it('mã sai dạng: 400 INVALID_CODE trước khi khoá', async () => {
    const { svc, calls } = build({ config: flagOn });
    expect(await codeOf(svc.submit('u1', 'abc'))).toBe('INVALID_CODE');
    expect(calls).toEqual([]);
  });
  it('khoá advisory theo khách lấy TRƯỚC mọi truy vấn luật; khoá dòng đơn trước khi đọc claim', async () => {
    const { svc, calls, tx } = build({ config: flagOn, order: order() });
    const res = await svc.submit('u1', ' spx-vn0123456789 ');
    expect(calls).toEqual(['lock', 'rowlock']);
    expect(tx.user.findUnique.mock.invocationCallOrder[0]!).toBeGreaterThan(tx.$executeRaw.mock.invocationCallOrder[0]!);
    expect(res).toMatchObject({ status: 'CLAIMED', points: 2_000, channel: 'shopee', maskedCode: 'SPX*********789', expectedCreditAt: null });
    expect(tx.externalPointsClaim.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true, data: [expect.objectContaining({ userId: 'u1', state: 'PENDING', points: 2_000, countsForTier: false, claimedCode: 'SPXVN0123456789', multiplier: 1 })] }),
    );
  });
  it('không thấy đơn: tra Pancake ngoài transaction, rồi ghi attempt UNMATCHED và trả SEARCHING', async () => {
    const { svc, lookup, tx } = build({ config: flagOn, order: null });
    const res = await svc.submit('u1', 'SPXVN0123456789');
    expect(lookup.lookupAndIngest).toHaveBeenCalledWith('SPXVN0123456789', expect.any(Date));
    expect(res.status).toBe('SEARCHING');
    expect(tx.externalClaimAttempt.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true, data: [expect.objectContaining({ result: 'UNMATCHED', userId: 'u1' })] }));
  });
  it('mã trùng đơn trong Mini App: 409 APP_ORDER, và attempt được ghi (không tra Pancake vì đã có mã app)', async () => {
    const { svc, attemptCreate } = build({ config: flagOn, order: null, appOrder: true });
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('APP_ORDER');
    expect(attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: 'REJECTED_APP_ORDER' }) });
  });
  it('khách không có SĐT: 403 NOT_ELIGIBLE_USER và không ghi attempt', async () => {
    const { svc, attemptCreate } = build({ config: flagOn, order: order(), user: { id: 'u1', phone: null, zaloId: 'guest_x', isBlocked: false } });
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('NOT_ELIGIBLE_USER');
    expect(attemptCreate).not.toHaveBeenCalled();
  });
  it('đơn thiếu tiền hàng: vào REVIEW, không báo PENDING cho khách', async () => {
    const { svc, notifications } = build({ config: flagOn, order: order({ goodsValue: null }) });
    const res = await svc.submit('u1', 'SPXVN0123456789');
    expect(res).toMatchObject({ status: 'REVIEW', points: null });
    expect(notifications.notify).not.toHaveBeenCalled();
  });
  it('thành công: gửi EXTERNAL_POINTS_PENDING với dedupeKey theo claim', async () => {
    const { svc, notifications } = build({ config: flagOn, order: order() });
    await svc.submit('u1', 'SPXVN0123456789');
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'EXTERNAL_POINTS_PENDING', { points: '2.000', code: 'SPX*********789' }, { dedupeKey: 'ext-pending:c1' });
  });
  it('mã đã có claim (createMany trả rỗng): 409 ALREADY_CLAIMED và ghi attempt', async () => {
    const { svc, tx, attemptCreate } = build({ config: flagOn, order: order() });
    tx.externalPointsClaim.createManyAndReturn.mockResolvedValue([]);
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('ALREADY_CLAIMED');
    expect(attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: 'REJECTED_ALREADY_CLAIMED' }) });
  });
  it('nhân viên tự gửi mã: vào REVIEW, không báo PENDING', async () => {
    const { svc, notifications } = build({ config: flagOn, order: order(), user: { id: 'u1', phone: '0912345678', zaloId: 'z1', isBlocked: false, role: 'STAFF' } });
    expect(await svc.submit('u1', 'SPXVN0123456789')).toMatchObject({ status: 'REVIEW' });
    expect(notifications.notify).not.toHaveBeenCalled();
  });
  it('ghi nhật ký CLAIM_CREATED cùng transaction với claim', async () => {
    const { svc, tx } = build({ config: flagOn, order: order() });
    await svc.submit('u1', 'SPXVN0123456789');
    expect(tx.externalClaimEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ claimId: 'c1', action: 'CLAIM_CREATED', actorId: 'u1', toState: 'PENDING', userIdAfter: 'u1' }) });
  });
  it('C5: đơn khác cùng mã đã có claim còn hiệu lực: 409 ALREADY_CLAIMED, không tạo claim', async () => {
    const { svc, tx } = build({ config: flagOn, order: order() });
    tx.externalPointsClaim.findFirst.mockResolvedValue({ id: 'other' });
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('ALREADY_CLAIMED');
    expect(tx.externalPointsClaim.createManyAndReturn).not.toHaveBeenCalled();
    expect(tx.externalPointsClaim.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ state: { not: 'VOIDED' }, externalOrderId: { not: 'x1' } }) }),
    );
  });
  it('C2: gửi lại mã của chính mình trả trạng thái hiện có, không ghi attempt, không tạo claim', async () => {
    const { svc, tx, attemptCreate } = build({ config: flagOn, order: order() });
    tx.externalPointsClaim.findUnique.mockResolvedValue({ id: 'c7', state: 'PENDING', claimedCode: 'SPXVN0123456789', decidedById: null, userId: 'u1' });
    const res = await svc.submit('u1', 'SPXVN0123456789');
    expect(res).toMatchObject({ status: 'CLAIMED', claimId: 'c7', points: 2_000 });
    expect(attemptCreate).not.toHaveBeenCalled();
    expect(tx.externalPointsClaim.createManyAndReturn).not.toHaveBeenCalled();
  });
  it('C2: claim của người khác vẫn là ALREADY_CLAIMED', async () => {
    const { svc, tx } = build({ config: flagOn, order: order() });
    tx.externalPointsClaim.findUnique.mockResolvedValue({ id: 'c7', state: 'PENDING', claimedCode: 'X', decidedById: null, userId: 'u2' });
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('ALREADY_CLAIMED');
  });
  it('C2: mã đang chờ ghép là của chính khách: SEARCHING, không ghi NOT_FOUND (không tính khoá 24h)', async () => {
    const { svc, tx, attemptCreate } = build({ config: flagOn, order: null });
    tx.externalClaimAttempt.createMany.mockResolvedValue({ count: 0 });
    tx.externalClaimAttempt.findFirst.mockResolvedValue({ userId: 'u1' });
    expect((await svc.submit('u1', 'SPXVN0123456789')).status).toBe('SEARCHING');
    expect(attemptCreate).not.toHaveBeenCalled();
  });
  it('C2: mã đang chờ của người khác: vẫn ghi NOT_FOUND', async () => {
    const { svc, tx, attemptCreate } = build({ config: flagOn, order: null });
    tx.externalClaimAttempt.createMany.mockResolvedValue({ count: 0 });
    tx.externalClaimAttempt.findFirst.mockResolvedValue({ userId: 'u2' });
    await svc.submit('u1', 'SPXVN0123456789');
    expect(attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: 'NOT_FOUND' }) });
  });
});

describe('ExternalClaimService.rematchOne', () => {
  const rematch = (svc: ExternalClaimService) => (svc as unknown as { rematchOne: (id: string, cfg: unknown, now: Date) => Promise<string> }).rematchOne('a1', { ...cfgOn }, NOW);
  const cfgOn = { enabled: true, earnPct: 1, dailyAttempts: 10, dailyMax: 3, monthlyPointsCap: 200_000, maxAgeDays: 60, reviewAboveVnd: 2_000_000, pendingDays: 14, externalSince: null };
  it('C3: gặp ALREADY_CLAIMED với claim của chính khách: đóng lần thử, KHÔNG báo "chưa tìm thấy"', async () => {
    const { svc, tx, notifications } = build({ config: flagOn, order: order() });
    tx.externalClaimAttempt.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', code: 'SPXVN0123456789', result: 'UNMATCHED', externalOrderId: null, resolvedAt: null });
    tx.externalOrder.findFirst.mockResolvedValue({ id: 'x1' });
    tx.externalPointsClaim.findUnique.mockResolvedValue({ id: 'c7', state: 'VOIDED', claimedCode: 'X', decidedById: 'adm', userId: 'u1' });
    expect(await rematch(svc)).toBe('RESOLVED');
    expect(notifications.notify).not.toHaveBeenCalled();
  });
  it('claim của người khác: vẫn báo khách chưa tìm thấy', async () => {
    const { svc, tx, notifications } = build({ config: flagOn, order: order() });
    tx.externalClaimAttempt.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', code: 'SPXVN0123456789', result: 'UNMATCHED', externalOrderId: null, resolvedAt: null });
    tx.externalOrder.findFirst.mockResolvedValue({ id: 'x1' });
    tx.externalPointsClaim.findUnique.mockResolvedValue({ id: 'c7', state: 'PENDING', claimedCode: 'X', decidedById: null, userId: 'u2' });
    expect(await rematch(svc)).toBe('RESOLVED');
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'EXTERNAL_POINTS_CLAIM_NOT_FOUND', expect.anything(), expect.anything());
  });
});
