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

describe('AccountDeletionService.anonymize — chat CSKH', () => {
  afterEach(() => jest.restoreAllMocks());

  it('xoá tin, lần chuyển và hội thoại của người đó, tin và lần chuyển đi trước hội thoại', async () => {
    const order: string[] = [];
    const del = (name: string) => jest.fn().mockImplementation(() => { order.push(name); return Promise.resolve({ count: 1 }); });
    const noop = jest.fn().mockResolvedValue({ count: 0 });
    const tx: any = {
      user: { update: jest.fn() },
      referralTouch: { updateMany: noop },
      address: { updateMany: noop },
      order: { updateMany: noop },
      refreshToken: { updateMany: noop },
      dealerApplication: { updateMany: noop },
      storefront: { updateMany: noop },
      $executeRaw: jest.fn().mockResolvedValue(0),
      supportConversation: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', code: 'K7Q2' }), delete: del('conversation') },
      supportRetiredCode: { upsert: jest.fn().mockImplementation(() => { order.push('retired'); return Promise.resolve({}); }) },
      supportMessage: { deleteMany: del('messages') },
      supportForward: { deleteMany: del('forwards') },
    };
    const svc = new AccountDeletionService({} as unknown as PrismaService);
    await (svc as any).anonymize(tx, 'u1', 'req-1', new Date());
    expect(tx.supportMessage.deleteMany).toHaveBeenCalledWith({ where: { conversationId: 'c1' } });
    expect(tx.supportForward.deleteMany).toHaveBeenCalledWith({ where: { conversationId: 'c1' } });
    expect(tx.supportConversation.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(order.indexOf('conversation')).toBe(3);
    expect(tx.supportRetiredCode.upsert).toHaveBeenCalledWith({ where: { code: 'K7Q2' }, create: { code: 'K7Q2' }, update: {} });
  });

  it('mã hội thoại bị xoá được giữ chỗ trong cùng giao dịch, trước khi xoá hội thoại', async () => {
    const order: string[] = [];
    const noop = jest.fn().mockResolvedValue({ count: 0 });
    const tx: any = {
      user: { update: jest.fn() }, referralTouch: { updateMany: noop }, address: { updateMany: noop }, order: { updateMany: noop },
      refreshToken: { updateMany: noop }, dealerApplication: { updateMany: noop }, storefront: { updateMany: noop },
      $executeRaw: jest.fn().mockResolvedValue(0),
      supportConversation: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', code: 'K7Q2' }), delete: jest.fn().mockImplementation(() => { order.push('conversation'); return Promise.resolve({}); }) },
      supportRetiredCode: { upsert: jest.fn().mockImplementation(() => { order.push('retired'); return Promise.resolve({}); }) },
      supportMessage: { deleteMany: jest.fn() }, supportForward: { deleteMany: jest.fn() },
    };
    await (new AccountDeletionService({} as unknown as PrismaService) as any).anonymize(tx, 'u1', 'req-1', new Date());
    expect(order).toEqual(['retired', 'conversation']);
  });

  it('khách chưa từng chat: không có gì để xoá, không lỗi', async () => {
    const noop = jest.fn().mockResolvedValue({ count: 0 });
    const tx: any = {
      user: { update: jest.fn() }, referralTouch: { updateMany: noop }, address: { updateMany: noop }, order: { updateMany: noop },
      refreshToken: { updateMany: noop }, dealerApplication: { updateMany: noop }, storefront: { updateMany: noop },
      $executeRaw: jest.fn().mockResolvedValue(0),
      supportConversation: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn() },
      supportRetiredCode: { upsert: jest.fn() },
      supportMessage: { deleteMany: jest.fn() }, supportForward: { deleteMany: jest.fn() },
    };
    const svc = new AccountDeletionService({} as unknown as PrismaService);
    await expect((svc as any).anonymize(tx, 'u1', 'req-1', new Date())).resolves.toBeUndefined();
    expect(tx.supportConversation.delete).not.toHaveBeenCalled();
  });
});

describe('AccountDeletionService — Ví còn tiền: khách đã đồng ý bỏ số dư', () => {
  afterEach(() => jest.restoreAllMocks());

  function withWallet(balance: number, forfeit: number | null) {
    const ctx = build([]);
    const { tx } = ctx;
    (tx.accountDeletionRequest.findUniqueOrThrow as jest.Mock).mockResolvedValue({
      id: 'req-1',
      userId: 'u1',
      status: 'PENDING',
      walletForfeitAmount: forfeit,
      walletForfeitConsentAt: forfeit === null ? null : new Date('2026-10-25T01:00:00Z'),
    });
    (tx.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', role: 'CUSTOMER', walletBalance: balance, pointsConvertedBalance: 0, cashbackPending: 0 });
    (tx.$queryRaw as jest.Mock).mockResolvedValue([{ id: 'req-1', walletBalance: balance }]);
    const extra = tx as unknown as Record<string, unknown>;
    extra.walletTransaction = { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'wt1' }) };
    extra.userAdminEvent = { create: jest.fn() };
    (tx.user.update as jest.Mock).mockResolvedValue({ walletBalance: 0 });
    return { ...ctx, extra };
  }
  const blockersOf = async (p: Promise<unknown>) => {
    const err = await p.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    return ((err as BadRequestException).getResponse() as { blockers: DeletionBlocker[] }).blockers;
  };

  it('chưa có đồng ý (yêu cầu cũ) → chặn, nhắc khách gửi lại và đồng ý, không trừ Ví', async () => {
    const { svc, anonymize, extra } = withWallet(20_000, null);
    const blockers = await blockersOf(svc.process('req-1', 'admin-1'));
    expect(blockers).toEqual([{ code: 'WALLET_BALANCE', message: expect.stringContaining('chưa đồng ý bỏ số dư') }]);
    expect((extra.walletTransaction as { create: jest.Mock }).create).not.toHaveBeenCalled();
    expect(anonymize).not.toHaveBeenCalled();
  });

  it('số dư đã đổi so với số khách đồng ý → chặn, nêu cả hai số', async () => {
    const { svc, anonymize } = withWallet(30_000, 20_000);
    const blockers = await blockersOf(svc.process('req-1', 'admin-1'));
    expect(blockers[0]?.message).toBe('Ví Tubu đã đổi từ 20.000đ (số khách đồng ý bỏ) thành 30.000đ, khách cần xác nhận lại khi gửi yêu cầu xoá');
    expect(anonymize).not.toHaveBeenCalled();
  });

  it('đúng số khách đồng ý → trừ Ví về 0 bằng một dòng ADJUST có lý do, ghi sổ việc admin, rồi ẩn danh', async () => {
    const { svc, anonymize, extra } = withWallet(20_000, 20_000);
    await svc.process('req-1', 'admin-1');
    const create = (extra.walletTransaction as { create: jest.Mock }).create;
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].data).toMatchObject({
      userId: 'u1',
      delta: -20_000,
      type: 'ADJUST',
      refType: 'ACCOUNT_DELETION',
      refId: 'req-1',
      reason: expect.stringContaining('khách đã đồng ý bỏ số dư Ví 20.000đ'),
    });
    expect((extra.userAdminEvent as { create: jest.Mock }).create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', kind: 'WALLET_FORFEIT', fromValue: '20000', toValue: '0', actorId: 'admin-1' }),
    });
    expect(anonymize).toHaveBeenCalled();
  });

  it('Ví bằng 0 → không ghi dòng sổ Ví', async () => {
    const { svc, extra } = withWallet(0, null);
    await svc.process('req-1', 'admin-1');
    expect((extra.walletTransaction as { create: jest.Mock }).create).not.toHaveBeenCalled();
  });

  it('Ví âm vẫn chặn như cũ dù có đồng ý', async () => {
    const { svc } = withWallet(-5_000, 20_000);
    const blockers = await blockersOf(svc.process('req-1', 'admin-1'));
    expect(blockers[0]?.message).toContain('đang âm 5.000đ');
  });

  it('hoa hồng đã duyệt chưa chuyển → câu nhắc chuyển hoa hồng vào Ví trước', async () => {
    const { svc, tx } = withWallet(0, null);
    // `empty` dùng chung cho mọi bảng nên thay riêng bảng hoa hồng, không sửa mock chung.
    (tx as unknown as { commission: unknown }).commission = { groupBy: jest.fn().mockResolvedValue([{ affiliateUserId: 'u1', _count: { _all: 2 } }]) };
    const blockers = await blockersOf(svc.process('req-1', 'admin-1'));
    expect(blockers).toEqual([{ code: 'COMMISSION_UNPAID', message: expect.stringContaining('chưa chuyển vào Ví Tubu, khách cần chuyển hoa hồng vào Ví trước') }]);
  });
});

describe('AccountDeletionService — đơn đã giao còn trong hạn đổi/trả', () => {
  afterEach(() => jest.restoreAllMocks());

  const day = 864e5;
  function withDelivered(orders: { userId: string; deliveredAt: Date | null; updatedAt: Date }[], windowDays?: number) {
    const ctx = build([]);
    (ctx.tx as unknown as { order: unknown }).order = {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue(orders),
    };
    const config = { get: jest.fn().mockResolvedValue(windowDays ?? 7) };
    const svc = new AccountDeletionService(
      { $transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(ctx.tx)) } as unknown as PrismaService,
      undefined,
      undefined,
      config as never,
    );
    return { ...ctx, svc, config };
  }

  it('còn đơn DELIVERED trong hạn → chặn ORDER_RETURN_WINDOW, câu nêu ngày xoá được = hết hạn MUỘN nhất; đọc đúng returns.window_days', async () => {
    const delivered = new Date(Date.now() - 2 * day);
    const later = new Date(Date.now() - 1 * day);
    const { svc, config, anonymize } = withDelivered(
      [
        { userId: 'u1', deliveredAt: later, updatedAt: later },
        { userId: 'u1', deliveredAt: delivered, updatedAt: delivered },
      ],
      7,
    );
    const err = await svc.process('req-1', 'admin-1').then(() => null, (e: unknown) => e);
    const blockers = ((err as BadRequestException).getResponse() as { blockers: DeletionBlocker[] }).blockers;
    const expiry = new Date(later.getTime() + 7 * day + 7 * 3600 * 1000);
    const label = `${String(expiry.getUTCDate()).padStart(2, '0')}/${String(expiry.getUTCMonth() + 1).padStart(2, '0')}/${expiry.getUTCFullYear()}`;
    expect(blockers).toEqual([
      { code: 'ORDER_RETURN_WINDOW', message: `Bạn còn đơn trong hạn đổi trả. Bạn xoá được tài khoản từ ngày ${label}.` },
    ]);
    expect(config.get).toHaveBeenCalledWith('returns.window_days', 7);
    expect(anonymize).not.toHaveBeenCalled();
  });

  it('truy vấn đơn lọc theo mốc now − window_days (đơn quá hạn không bị tính), kể cả đơn cũ chưa có deliveredAt', async () => {
    const { svc, tx } = withDelivered([], 3);
    const before = Date.now();
    await svc.process('req-1', 'admin-1');
    const where = ((tx.order as unknown as { findMany: jest.Mock }).findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where as {
      status: string;
      OR: [{ deliveredAt: { gt: Date } }, { deliveredAt: null; updatedAt: { gt: Date } }];
    };
    expect(where.status).toBe('DELIVERED');
    const cutoff = where.OR[0].deliveredAt.gt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 3 * day - 1000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 3 * day + 1000);
    expect(where.OR[1].updatedAt.gt.getTime()).toBe(cutoff);
  });

  it('không còn đơn nào trong hạn → xử lý được', async () => {
    const { svc, anonymize } = withDelivered([]);
    await svc.process('req-1', 'admin-1');
    expect(anonymize).toHaveBeenCalled();
  });

  it('list(): mỗi khách lấy đồng ý của yêu cầu PENDING MỚI NHẤT, bất kể thứ tự dòng', async () => {
    const old = { id: 'r-old', userId: 'u1', status: 'PENDING', createdAt: new Date('2026-10-01'), walletForfeitAmount: 10_000 };
    const fresh = { id: 'r-new', userId: 'u1', status: 'PENDING', createdAt: new Date('2026-10-20'), walletForfeitAmount: 20_000 };
    for (const rows of [[old, fresh], [fresh, old]]) {
      const prisma = {
        accountDeletionRequest: { findMany: jest.fn().mockResolvedValue(rows) },
        user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', role: 'CUSTOMER', walletBalance: 20_000, pointsConvertedBalance: 0, cashbackPending: 0 }]) },
        ...Object.fromEntries(['order', 'payout', 'returnRequest', 'orderCustomerRefund', 'subscription', 'commission', 'cashbackTransaction', 'dealerCreditLedger', 'wasteRequest', 'wasteUserFlags'].map((k) => [k, { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) }])),
      };
      const out = await new AccountDeletionService(prisma as unknown as PrismaService).list('PENDING');
      expect(out.every((r) => r.blockers.length === 0)).toBe(true);
    }
  });
});
