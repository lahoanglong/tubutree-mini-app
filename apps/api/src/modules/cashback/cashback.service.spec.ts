import { Prisma } from '@prisma/client';
import { CashbackService } from './cashback.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { CoinsService } from '../wallet/coins.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { CashbackProviderRegistry } from './providers/cashback-provider.registry';

const registry = {
  get: jest.fn(),
  all: jest.fn().mockReturnValue([]),
} as unknown as CashbackProviderRegistry;

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T, // dùng default 0.7
} as unknown as SystemConfigService;

// Stub CoinsService — assert có gọi thưởng xu giới thiệu khi cashback CONFIRMED.
const coins = { grantReferralCoins: jest.fn().mockResolvedValue(undefined) } as unknown as CoinsService;
// Stub NotificationsService — assert có bắn CASHBACK_PAID khi tiền về Ví.
const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
beforeEach(() => {
  (coins.grantReferralCoins as jest.Mock).mockClear();
  (notifications.notify as jest.Mock).mockClear();
});

const event = (over: Partial<Record<string, unknown>> = {}) => ({
  clickRef: 'click-1',
  merchantOrderId: 'AT-ORDER-1',
  orderAmount: 500000,
  commission: 50000,
  status: 'CONFIRMED' as const,
  raw: {},
  ...over,
});

describe('CashbackService.createClick', () => {
  const provider = { buildDeeplink: jest.fn().mockReturnValue('https://dl/deep?utm_content=xyz') };
  const reg = { get: jest.fn().mockReturnValue(provider) } as unknown as CashbackProviderRegistry;
  beforeEach(() => {
    provider.buildDeeplink.mockClear();
    (reg.get as jest.Mock).mockClear().mockReturnValue(provider);
  });

  it('merchant hợp lệ → resolve provider qua registry, tạo click, trả deeplink', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      cashbackMerchant: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', provider: 'accesstrade', isActive: true, deeplinkTemplate: 'https://dl/deep?utm_content={{clickId}}' }) },
      cashbackClick: { findFirst: jest.fn().mockResolvedValue(null), create },
    } as unknown as PrismaService;
    const r = await new CashbackService(prisma, config, coins, notifications, reg).createClick('u1', 'm1');
    expect(reg.get).toHaveBeenCalledWith('accesstrade');
    expect(provider.buildDeeplink).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
    expect(r).toEqual({ deeplink: 'https://dl/deep?utm_content=xyz' });
  });

  it('merchant không tồn tại/không active → BadRequestException', async () => {
    const prisma = {
      cashbackMerchant: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    await expect(
      new CashbackService(prisma, config, coins, notifications, reg).createClick('u1', 'mX'),
    ).rejects.toThrow('Sàn không khả dụng.');
  });

  it('click gần đây trong rate-limit → tái dùng utmTraceId, KHÔNG tạo click mới', async () => {
    const create = jest.fn();
    const prisma = {
      cashbackMerchant: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', provider: 'accesstrade', isActive: true, deeplinkTemplate: 'tpl' }) },
      cashbackClick: { findFirst: jest.fn().mockResolvedValue({ utmTraceId: 'old-trace' }), create },
    } as unknown as PrismaService;
    await new CashbackService(prisma, config, coins, notifications, reg).createClick('u1', 'm1');
    expect(provider.buildDeeplink).toHaveBeenCalledWith('tpl', 'old-trace', undefined);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('CashbackService.ingest', () => {
  it('postback không khớp click → ok:false, không tạo giao dịch', async () => {
    const create = jest.fn();
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue(null) },
      cashbackTransaction: { findFirst: jest.fn(), create },
    } as unknown as PrismaService;
    const r = await new CashbackService(prisma, config, coins, notifications, registry).ingest(event(), 'accesstrade');
    expect(r).toEqual({ ok: false });
    expect(create).not.toHaveBeenCalled();
  });

  it('approved mới → userReward = 70% commission, cộng cashbackPending', async () => {
    const create = jest.fn().mockResolvedValue({});
    const userUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue(null), create },
      user: { update: userUpdate },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(event(), 'accesstrade');
    const data = create.mock.calls[0][0].data;
    expect(data.userReward).toBe(35000); // floor(50000 * 0.7)
    expect(data.status).toBe('CONFIRMED');
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { increment: 35000 } } }),
    );
  });

  it('pending → tạo giao dịch nhưng KHÔNG cộng cashbackPending', async () => {
    const create = jest.fn().mockResolvedValue({});
    const userUpdate = jest.fn();
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue(null), create },
      user: { update: userUpdate },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ status: 'PENDING' }), 'accesstrade');
    expect(create.mock.calls[0][0].data.status).toBe('PENDING');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  // ── transition existing (idempotent + chuyển trạng thái ATOMIC) ──
  // Nhánh existing giờ dùng $transaction callback + cashbackTransaction.updateMany (optimistic CAS
  // theo status) → moveCount mô phỏng thắng/thua race.
  function updateBranchPrisma(existing: Record<string, unknown>, moveCount = 1) {
    const updateMany = jest.fn().mockResolvedValue({ count: moveCount });
    const userUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn(), updateMany },
      user: { update: userUpdate },
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma));
    return { prisma, updateMany, userUpdate };
  }

  it('duplicate APPROVED (đã CONFIRMED) → update, KHÔNG cộng pending lần nữa', async () => {
    const { prisma, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'CONFIRMED', confirmedAt: new Date(), userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('PENDING → APPROVED → CỘNG cashbackPending (fix bug mất cashback)', async () => {
    const { prisma, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { increment: 35000 } } }),
    );
  });

  it('PENDING → CONFIRMED với commission sửa lại → cập nhật userReward mới, cộng đúng số mới (không dùng số cũ đã lưu)', async () => {
    const { prisma, updateMany, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u1', userReward: 35000, orderAmount: 500000, commission: 50000,
    });
    // Postback CONFIRMED sau gửi commission cuối cùng thấp hơn tạm tính ban đầu (50000 → 40000).
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(
      event({ status: 'CONFIRMED', commission: 40000 }),
      'accesstrade',
    );
    const data = updateMany.mock.calls[0][0].data;
    expect(data.commission).toBe(40000);
    expect(data.userReward).toBe(28000); // floor(40000 * 0.7), KHÔNG phải 35000 cũ
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { increment: 28000 } } }),
    );
  });

  it('CONFIRMED → REJECTED → TRỪ cashbackPending', async () => {
    const { prisma, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'CONFIRMED', confirmedAt: new Date(), userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ status: 'REJECTED' }), 'accesstrade');
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { decrement: 35000 } } }),
    );
  });

  it('đã PAID → postback không đụng số dư (đã về Ví)', async () => {
    const { prisma, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'PAID', confirmedAt: new Date(), userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ status: 'REJECTED' }), 'accesstrade');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('race chuyển trạng thái: updateMany count=0 (racer khác đã chuyển) → KHÔNG cộng pending lần 2, KHÔNG thưởng xu', async () => {
    const { prisma, userUpdate } = updateBranchPrisma(
      { id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u9', userReward: 35000 },
      0, // CAS thua: status đã bị racer khác đổi
    );
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(coins.grantReferralCoins).not.toHaveBeenCalled();
  });

  it('REJECTED → CONFIRMED → confirmedAt RESET (đồng hồ hold chạy lại), cộng pending', async () => {
    const oldConfirmedAt = new Date(Date.now() - 60 * 24 * 3600 * 1000); // 60 ngày trước
    const { prisma, updateMany, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'REJECTED', confirmedAt: oldConfirmedAt, userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
    const data = updateMany.mock.calls[0][0].data;
    expect(data.confirmedAt).toBeInstanceOf(Date);
    // KHÔNG giữ confirmedAt cũ (nếu giữ → settle ngay, né hết 30 ngày hold).
    expect(data.confirmedAt.getTime()).toBeGreaterThan(oldConfirmedAt.getTime());
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { increment: 35000 } } }),
    );
  });

  it('race tạo mới: create ăn P2002 (kẻ thắng đã tạo trước) → đọc lại & áp dụng update, KHÔNG mất credit CONFIRMED', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const userUpdate = jest.fn().mockResolvedValue({});
    const create = jest
      .fn()
      .mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }));
    const winner = { id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u1', userReward: 35000 };
    const findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst, create, updateMany },
      user: { update: userUpdate },
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn().mockImplementation((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (t: unknown) => unknown)(prisma),
    );
    const r = await new CashbackService(prisma, config, coins, notifications, registry).ingest(
      event({ status: 'CONFIRMED' }),
      'accesstrade',
    );
    expect(r).toEqual({ ok: true });
    // Không bỏ qua sự kiện thua race: vẫn cộng cashbackPending + thưởng xu giới thiệu như update bình thường.
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { increment: 35000 } } }),
    );
    expect(coins.grantReferralCoins).toHaveBeenCalledWith('u1');
  });

  it('grantReferralCoins lỗi → postback VẪN ok (side-effect không làm vỡ webhook)', async () => {
    (coins.grantReferralCoins as jest.Mock).mockRejectedValueOnce(new Error('db hiccup'));
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const r = await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
    expect(r).toEqual({ ok: true });
  });

  // ── guard âm + thưởng xu giới thiệu khi CONFIRMED lần đầu ──
  it('commission âm (phòng thủ ở ingest) → ok:false, không tạo giao dịch', async () => {
    const findUnique = jest.fn();
    const prisma = { cashbackClick: { findUnique } } as unknown as PrismaService;
    const r = await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ commission: -1 }), 'accesstrade');
    expect(r).toEqual({ ok: false });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('tạo mới CONFIRMED → thưởng xu giới thiệu cho người mua (referee)', async () => {
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
    expect(coins.grantReferralCoins).toHaveBeenCalledWith('u1');
  });

  it('PENDING → CONFIRMED → thưởng xu giới thiệu (chuyển sang confirmed)', async () => {
    const { prisma } = updateBranchPrisma({
      id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u9', userReward: 35000,
    });
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
    expect(coins.grantReferralCoins).toHaveBeenCalledWith('u9');
  });

  it('tạo mới PENDING → CHƯA thưởng xu (chưa confirmed)', async () => {
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ status: 'PENDING' }), 'accesstrade');
    expect(coins.grantReferralCoins).not.toHaveBeenCalled();
  });

  it('duplicate CONFIRMED (không chuyển trạng thái) → KHÔNG thưởng lại', async () => {
    const { prisma } = updateBranchPrisma({
      id: 'tx1', status: 'CONFIRMED', confirmedAt: new Date(), userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, coins, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
    expect(coins.grantReferralCoins).not.toHaveBeenCalled();
  });
});

describe('CashbackService.settleConfirmed', () => {
  function settlePrisma(due: Record<string, unknown>[], markCount = 1) {
    const updateMany = jest.fn().mockResolvedValue({ count: markCount });
    const userUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      cashbackTransaction: { findMany: jest.fn().mockResolvedValue(due), updateMany },
      user: { update: userUpdate },
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma));
    return { prisma, updateMany, userUpdate };
  }

  it('CONFIRMED quá hold → set PAID atomic + chuyển pending→Ví + bắn CASHBACK_PAID', async () => {
    const { prisma, updateMany, userUpdate } = settlePrisma([{ id: 'tx1', userId: 'u1', userReward: 35000 }]);
    await new CashbackService(prisma, config, coins, notifications, registry).settleConfirmed();
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'tx1', status: 'CONFIRMED' });
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { decrement: 35000 }, walletBalance: { increment: 35000 } } }),
    );
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'CASHBACK_PAID', { amount: '35.000' });
  });

  it('multi-instance race: updateMany count=0 → KHÔNG cộng ví lần nữa, KHÔNG thông báo', async () => {
    const { prisma, userUpdate } = settlePrisma([{ id: 'tx1', userId: 'u1', userReward: 35000 }], 0);
    await new CashbackService(prisma, config, coins, notifications, registry).settleConfirmed();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('CashbackService.reconcile', () => {
  const provider = (key: string, enabled: boolean, events: unknown[] = []) => ({
    key,
    buildDeeplink: () => '',
    verifyWebhook: () => true,
    parseWebhook: () => null,
    isReconcileEnabled: () => enabled,
    fetchTransactions: jest.fn().mockResolvedValue(events),
  });

  it('provider disabled → KHÔNG fetch, KHÔNG ingest', async () => {
    const p = provider('accesstrade', false);
    const reg = { all: () => [p], get: jest.fn() } as unknown as CashbackProviderRegistry;
    const prisma = {} as unknown as PrismaService;
    const svc = new CashbackService(prisma, config, coins, notifications, reg);
    const ingest = jest.spyOn(svc, 'ingest').mockResolvedValue({ ok: true });
    await svc.reconcile();
    expect(p.fetchTransactions).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it('provider enabled → feed từng event qua ingest với đúng providerKey', async () => {
    const ev = event();
    const p = provider('accesstrade', true, [ev]);
    const reg = { all: () => [p], get: jest.fn() } as unknown as CashbackProviderRegistry;
    const prisma = {} as unknown as PrismaService;
    const svc = new CashbackService(prisma, config, coins, notifications, reg);
    const ingest = jest.spyOn(svc, 'ingest').mockResolvedValue({ ok: true });
    await svc.reconcile();
    expect(p.fetchTransactions).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith(ev, 'accesstrade');
  });

  it('fetchTransactions lỗi → nuốt lỗi, không throw (cron không vỡ)', async () => {
    const p = provider('accesstrade', true);
    (p.fetchTransactions as jest.Mock).mockRejectedValue(new Error('AT 500'));
    const reg = { all: () => [p], get: jest.fn() } as unknown as CashbackProviderRegistry;
    const svc = new CashbackService({} as unknown as PrismaService, config, coins, notifications, reg);
    await expect(svc.reconcile()).resolves.toBeUndefined();
  });
});
