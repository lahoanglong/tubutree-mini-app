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
    user: { findUnique: jest.fn(async () => (opts.user === undefined ? { id: 'u1', phone: '0912345678', zaloId: 'z1', isBlocked: false } : opts.user)) },
    externalClaimAttempt: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: attemptCreate,
      createMany: jest.fn(async () => ({ count: 1 })),
    },
    order: { findFirst: jest.fn(async () => (opts.appOrder ? { id: 'o1' } : null)) },
    externalOrder: {
      findFirst: jest.fn(async () => (opts.order ? { id: 'x1' } : null)),
      findUniqueOrThrow: jest.fn(async () => opts.order),
    },
    externalPointsClaim: {
      findUnique: jest.fn(async () => null),
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
});
