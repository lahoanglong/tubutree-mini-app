import { BadRequestException } from '@nestjs/common';
import { ACCOUNT_DELETION_BLOCKED, AccountDeletionService, type DeletionBlocker, type PartnerStoreBlockersPort } from './account-deletion.service';
import type { PrismaService } from '../../prisma/prisma.service';

function build(partnerBlockers: string[]) {
  const calls: string[] = [];
  const empty = { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) };
  const tx = {
    $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray) => {
      calls.push(`raw:${strings[0]!.trim().split(' ').slice(0, 4).join(' ')}`);
      return Promise.resolve([{ id: 'req-1' }]);
    }),
    accountDeletionRequest: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'req-1', userId: 'u1', status: 'PENDING' }),
      updateMany: jest.fn(),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER', walletBalance: 0, pointsConvertedBalance: 0, cashbackPending: 0 }), update: jest.fn() },
    order: empty,
    payout: empty,
    returnRequest: empty,
    orderCustomerRefund: empty,
    subscription: empty,
    commission: empty,
    cashbackTransaction: empty,
    dealerCreditLedger: empty,
    wasteRequest: empty,
    wasteUserFlags: empty,
  };
  const prisma = { $transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)) };
  const port: PartnerStoreBlockersPort = {
    settlementConfig: jest.fn().mockResolvedValue({}),
    lockOwnerStores: jest.fn().mockImplementation(() => {
      calls.push('lockOwnerStores');
      return Promise.resolve();
    }),
    ownerPartnerBlockers: jest.fn().mockResolvedValue(partnerBlockers),
  };
  const anonymize = jest.spyOn(AccountDeletionService.prototype as never, 'anonymize' as never).mockResolvedValue(undefined as never);
  return { svc: new AccountDeletionService(prisma as unknown as PrismaService, port), tx, port, calls, anonymize };
}

describe('AccountDeletionService — gian hàng đối tác của chủ', () => {
  afterEach(() => jest.restoreAllMocks());

  it('gian hàng đối tác còn vướng: từ chối bằng ACCOUNT_DELETION_BLOCKED, không ẩn danh', async () => {
    const { svc, anonymize } = build(['1 đơn tự giao chưa xong', '2 khoản chờ đối soát']);
    const err = await svc.process('req-1', 'admin-1').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as { code: string; blockers: { code: string; message: string }[] };
    expect(body.code).toBe(ACCOUNT_DELETION_BLOCKED);
    expect(body.blockers).toEqual([{ code: 'PARTNER_STORE_OPEN', message: 'gian hàng đối tác còn vướng: 1 đơn tự giao chưa xong; 2 khoản chờ đối soát' }]);
    expect(anonymize).not.toHaveBeenCalled();
  });

  it('còn Điểm Xanh quy đổi: câu báo chặn xoá tài khoản có dấu chấm nghìn', async () => {
    const { svc, tx } = build([]);
    (tx.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', role: 'CUSTOMER', walletBalance: 0, pointsConvertedBalance: 7000, cashbackPending: 0 });
    const err = await svc.process('req-1', 'admin-1').then(() => null, (e: unknown) => e);
    const body = (err as BadRequestException).getResponse() as { blockers: { code: string; message: string }[] };
    expect(body.blockers).toContainEqual({ code: 'CONVERTED_POINTS', message: 'còn 7.000 Điểm Xanh không hết hạn chưa dùng' });
  });

  it('không vướng mắc: ẩn danh; khoá tư vấn chủ và phiếu đi trước khoá dòng gian hàng', async () => {
    const { svc, calls, anonymize } = build([]);
    await expect(svc.process('req-1', 'admin-1')).resolves.toMatchObject({ alreadyProcessed: false });
    expect(anonymize).toHaveBeenCalledTimes(1);
    const storefrontLock = calls.findIndex((c) => c.includes('FROM "storefronts"') || c === 'raw:SELECT "id" FROM "storefronts"');
    expect(calls.indexOf('lockOwnerStores')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('lockOwnerStores')).toBeLessThan(storefrontLock);
  });

  it('xử lý xong: cắt bộ nhớ đệm phiên của chủ; bị từ chối thì không', async () => {
    const sessions = { invalidate: jest.fn() };
    const ok = build([]);
    await new AccountDeletionService(
      { $transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(ok.tx)) } as unknown as PrismaService,
      ok.port,
      sessions as never,
    ).process('req-1', 'admin-1');
    expect(sessions.invalidate).toHaveBeenCalledWith('u1');
    sessions.invalidate.mockClear();
    const blocked = build(['1 đơn tự giao chưa xong']);
    await new AccountDeletionService(
      { $transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(blocked.tx)) } as unknown as PrismaService,
      blocked.port,
      sessions as never,
    )
      .process('req-1', 'admin-1')
      .catch(() => undefined);
    expect(sessions.invalidate).not.toHaveBeenCalled();
  });

  it('không có cổng đối tác (không nối MerchantModule): bỏ qua kiểm gian hàng như trước', async () => {
    const { tx } = build(['x']);
    const prisma = { $transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)) };
    const svc = new AccountDeletionService(prisma as unknown as PrismaService);
    await expect(svc.process('req-1', 'admin-1')).resolves.toMatchObject({ alreadyProcessed: false });
  });
});

describe('waste blockers (spec 11.1, 14.4)', () => {
  afterEach(() => jest.restoreAllMocks());

  async function blockersFor(overrides: Record<string, unknown>) {
    const { svc, tx } = build([]);
    Object.assign(tx, overrides);
    const err = await svc.process('req-1', 'admin-1').then(() => null, (e: unknown) => e);
    return { blockers: err ? ((err as BadRequestException).getResponse() as { blockers: DeletionBlocker[] }).blockers : [], tx };
  }

  it('an OPEN/IN_TRANSIT/RECEIVED request blocks with WASTE_REQUEST_OPEN', async () => {
    const { blockers, tx } = await blockersFor({ wasteRequest: { groupBy: jest.fn().mockResolvedValue([{ userId: 'u1', _count: { _all: 2 } }]) } });
    expect(blockers).toContainEqual({ code: 'WASTE_REQUEST_OPEN', message: 'còn 2 yêu cầu Đổi rác chưa xong (đang chờ mang tới, đang gửi hoặc đang chờ đếm)' });
    expect(tx.wasteRequest.groupBy).toHaveBeenCalledWith({ by: ['userId'], where: { userId: { in: ['u1'] }, status: { in: ['OPEN', 'IN_TRANSIT', 'RECEIVED'] } }, _count: { _all: true } });
  });
  it.each([['blockedAt', { blockedAt: new Date(), shipLockedAt: null }], ['shipLockedAt', { blockedAt: null, shipLockedAt: new Date() }]])('%s blocks with WASTE_UNDER_REVIEW', async (_n, flags) => {
    const { blockers, tx } = await blockersFor({ wasteUserFlags: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1', ...flags }]) } });
    expect(blockers).toContainEqual({ code: 'WASTE_UNDER_REVIEW', message: 'Tài khoản đang được Tubu xem xét, liên hệ CSKH' });
    expect(tx.wasteUserFlags.findMany).toHaveBeenCalledWith({ where: { userId: { in: ['u1'] }, OR: [{ blockedAt: { not: null } }, { shipLockedAt: { not: null } }] }, select: { userId: true } });
  });
  it('no waste rows -> no waste blocker', async () => {
    const { blockers } = await blockersFor({});
    expect(blockers).toEqual([]);
  });
});
