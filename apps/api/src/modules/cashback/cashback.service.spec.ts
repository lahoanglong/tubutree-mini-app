import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CashbackService } from './cashback.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { CashbackProviderRegistry } from './providers/cashback-provider.registry';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';

// Sổ cái thật chạy trên Postgres ở test/integration-race/wallet-ledger*.race-spec.ts.
jest.mock('../wallet/wallet-ledger.service', () => ({
  applyWalletDelta: jest.fn().mockResolvedValue({ applied: true, balanceAfter: 0, entryId: 'wtx' }),
}));
const ledger = applyWalletDelta as jest.MockedFunction<typeof applyWalletDelta>;

const registry = {
  get: jest.fn(),
  all: jest.fn().mockReturnValue([]),
} as unknown as CashbackProviderRegistry;

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T, // dùng default 0.7
} as unknown as SystemConfigService;

// Stub NotificationsService — assert có bắn CASHBACK_PAID khi tiền về Ví.
const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
beforeEach(() => {
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
      user: { findUnique: jest.fn().mockResolvedValue({ phone: '0912345678', zaloId: 'z1' }) },
      cashbackMerchant: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', provider: 'accesstrade', isActive: true, deeplinkTemplate: 'https://dl/deep?utm_content={{clickId}}' }) },
      cashbackClick: { findFirst: jest.fn().mockResolvedValue(null), create },
    } as unknown as PrismaService;
    const r = await new CashbackService(prisma, config, notifications, reg).createClick('u1', 'm1');
    expect(reg.get).toHaveBeenCalledWith('accesstrade');
    expect(provider.buildDeeplink).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
    expect(r).toEqual({ deeplink: 'https://dl/deep?utm_content=xyz' });
  });

  it('merchant không tồn tại/không active → BadRequestException', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ phone: '0912345678', zaloId: 'z1' }) },
      cashbackMerchant: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    await expect(
      new CashbackService(prisma, config, notifications, reg).createClick('u1', 'mX'),
    ).rejects.toThrow('Sàn không khả dụng.');
  });

  it('click gần đây trong rate-limit → tái dùng utmTraceId, KHÔNG tạo click mới', async () => {
    const create = jest.fn();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ phone: '0912345678', zaloId: 'z1' }) },
      cashbackMerchant: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', provider: 'accesstrade', isActive: true, deeplinkTemplate: 'tpl' }) },
      cashbackClick: { findFirst: jest.fn().mockResolvedValue({ utmTraceId: 'old-trace' }), create },
    } as unknown as PrismaService;
    await new CashbackService(prisma, config, notifications, reg).createClick('u1', 'm1');
    expect(provider.buildDeeplink).toHaveBeenCalledWith('tpl', 'old-trace', undefined);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('CashbackService.createClick — SEC-V2 (productUrl, user thật)', () => {
  const provider = { buildDeeplink: jest.fn().mockReturnValue('https://dl/deep?utm_content=xyz') };
  const reg = { get: jest.fn().mockReturnValue(provider) } as unknown as CashbackProviderRegistry;
  const real = { phone: '0912345678', zaloId: 'z1' };
  function setup(user: unknown, slug = 'shopee') {
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      cashbackMerchant: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', slug, provider: 'accesstrade', isActive: true, deeplinkTemplate: 'tpl' }) },
      cashbackClick: { findFirst: jest.fn().mockResolvedValue(null), create },
    } as unknown as PrismaService;
    return { svc: new CashbackService(prisma, config, notifications, reg), create };
  }

  it('khách vãng lai (guest_) → BadRequest, không tạo click', async () => {
    const { svc, create } = setup({ phone: null, zaloId: 'guest_dev1' });
    await expect(svc.createClick('u1', 'm1')).rejects.toThrow('Đăng nhập Zalo');
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['shopee', 'https://shopee.vn/product/1/2'],
    ['shopee', 'https://s.shopee.vn/abc'],
    ['lazada', 'https://www.lazada.vn/products/x-i1.html'],
    ['tiktokshop', 'https://shop.tiktok.com/view/product/1'],
  ])('%s: productUrl %s khớp sàn → tạo click', async (slug, url) => {
    const { svc, create } = setup(real, slug);
    await svc.createClick('u1', 'm1', url);
    expect(create).toHaveBeenCalled();
  });

  it.each([
    ['shopee', 'https://evil.example/phish'],
    ['shopee', 'https://shopee.vn.evil.example/x'],
    ['shopee', 'https://evilshopee.vn/x'],
    ['shopee', 'https://lazada.vn/x'],
    ['shopee', 'https://user:pw@shopee.vn/x'],
    ['shopee', 'http://shopee.vn/x'],
    ['shopee', 'javascript:alert(1)'],
    ['shopee', 'not a url'],
    ['moi-chua-map', 'https://shopee.vn/x'],
  ])('%s: productUrl %s không khớp sàn → BadRequest, không tạo click', async (slug, url) => {
    const { svc, create } = setup(real, slug);
    await expect(svc.createClick('u1', 'm1', url)).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('không gửi productUrl → vẫn tạo click bình thường (mọi sàn)', async () => {
    const { svc, create } = setup(real, 'moi-chua-map');
    await svc.createClick('u1', 'm1');
    expect(create).toHaveBeenCalled();
  });
});

describe('CashbackService.ingest', () => {
  it('postback không khớp click → ok:false, không tạo giao dịch', async () => {
    const create = jest.fn();
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue(null) },
      cashbackTransaction: { findFirst: jest.fn(), create },
    } as unknown as PrismaService;
    const r = await new CashbackService(prisma, config, notifications, registry).ingest(event(), 'accesstrade');
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
    await new CashbackService(prisma, config, notifications, registry).ingest(event(), 'accesstrade');
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
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'PENDING' }), 'accesstrade');
    expect(create.mock.calls[0][0].data.status).toBe('PENDING');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  // ── transition existing (idempotent + chuyển trạng thái ATOMIC) ──
  // Nhánh existing giờ dùng $transaction callback + cashbackTransaction.updateMany (optimistic CAS
  // theo status) → moveCount mô phỏng thắng/thua race.
  function updateBranchPrisma(existing: Record<string, unknown>, moveCount = 1, fresh: Record<string, unknown> | null = existing) {
    const updateMany = jest.fn().mockResolvedValue({ count: moveCount });
    const userUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue(existing), findUnique: jest.fn().mockResolvedValue(fresh), create: jest.fn(), updateMany },
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
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('PENDING → APPROVED → CỘNG cashbackPending (fix bug mất cashback)', async () => {
    const { prisma, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { increment: 35000 } } }),
    );
  });

  it('PENDING → CONFIRMED với commission sửa lại → cập nhật userReward mới, cộng đúng số mới (không dùng số cũ đã lưu)', async () => {
    const { prisma, updateMany, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u1', userReward: 35000, orderAmount: 500000, commission: 50000,
    });
    // Postback CONFIRMED sau gửi commission cuối cùng thấp hơn tạm tính ban đầu (50000 → 40000).
    await new CashbackService(prisma, config, notifications, registry).ingest(
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
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'REJECTED' }), 'accesstrade');
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { decrement: 35000 } } }),
    );
  });

  it('đã PAID → postback không đụng số dư (đã về Ví)', async () => {
    const { prisma, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'PAID', confirmedAt: new Date(), userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'REJECTED' }), 'accesstrade');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('L2-01: CONFIRMED rồi postback PENDING muộn → không đổi, không đụng updateMany/pending', async () => {
    const { prisma, updateMany, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'CONFIRMED', confirmedAt: new Date(), userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'PENDING' }), 'accesstrade');
    expect(updateMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('m1: trạng thái lạ trên dòng đã có (CONFIRMED) → không đụng gì', async () => {
    const { prisma, updateMany, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'CONFIRMED', confirmedAt: new Date(), userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'PENDING', unknownStatus: 'hold' }), 'accesstrade');
    expect(updateMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('m1: trạng thái lạ lần đầu (chưa có dòng) → tạo dòng PENDING, không cộng cashbackPending', async () => {
    const create = jest.fn().mockResolvedValue({});
    const userUpdate = jest.fn();
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue(null), create },
      user: { update: userUpdate },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const r = await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'PENDING', unknownStatus: 'hold' }), 'accesstrade');
    expect(r).toEqual({ ok: true });
    expect(create.mock.calls[0][0].data.status).toBe('PENDING');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('L2-01: REJECTED rồi postback PENDING muộn → không đổi', async () => {
    const { prisma, updateMany } = updateBranchPrisma({
      id: 'tx1', status: 'REJECTED', confirmedAt: null, userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'PENDING' }), 'accesstrade');
    expect(updateMany).not.toHaveBeenCalled();
  });

  describe('L2-02 / L2-08: sàn báo khác quyết định tay hoặc đòi lại khoản đã trả', () => {
    function conflictPrisma(existing: Record<string, unknown>, claimCount = 1) {
      const base = updateBranchPrisma(existing);
      base.updateMany.mockImplementation(async (arg: { where: Record<string, unknown> }) =>
        'conflictNotifiedAt' in arg.where ? { count: claimCount } : { count: 1 },
      );
      (base.prisma as unknown as { user: Record<string, unknown> }).user.findMany = jest.fn().mockResolvedValue([{ id: 'adm1' }]);
      return base;
    }
    const rejectedByAdmin = {
      id: 'tx1', status: 'REJECTED', confirmedAt: null, userId: 'u1', userReward: 35000, adminReviewedAt: new Date(), merchantOrderId: 'AT-1', provider: 'accesstrade',
    };
    const statusWrites = (updateMany: jest.Mock) => updateMany.mock.calls.filter(([a]) => !('conflictNotifiedAt' in a.where));

    it('Kế toán đã REJECTED, postback CONFIRMED → vẫn REJECTED, pending không đổi, báo ADMIN đúng một lần', async () => {
      const { prisma, updateMany, userUpdate } = conflictPrisma(rejectedByAdmin);
      const svc = new CashbackService(prisma, config, notifications, registry);
      await svc.ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
      expect(statusWrites(updateMany)).toHaveLength(0);
      expect(userUpdate).not.toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith('adm1', 'OPS_HEALTH_ALERT', expect.objectContaining({ summary: expect.stringContaining('Giữ quyết định của Kế toán') }));
    });

    it('m3: sàn lật REJECTED → CONFIRMED trên dòng chưa có quyết định tay → cộng pending như cũ và báo ADMIN', async () => {
      const { prisma, userUpdate } = conflictPrisma({ id: 'tx1', status: 'REJECTED', confirmedAt: null, userId: 'u1', userReward: 35000, adminReviewedAt: null, merchantOrderId: 'AT-1', provider: 'accesstrade' });
      await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
      expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { cashbackPending: { increment: 35000 } } }));
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith('adm1', 'OPS_HEALTH_ALERT', expect.objectContaining({ summary: expect.stringContaining('duyệt lại khoản đã "Từ chối"') }));
    });

    it('m3: tin REVIVED in số MỚI cộng vào pending (sàn gửi hoa hồng 60k → 42k), không in số cũ trên dòng', async () => {
      const { prisma } = conflictPrisma({ id: 'tx1', status: 'REJECTED', confirmedAt: null, userId: 'u1', userReward: 35000, adminReviewedAt: null, merchantOrderId: 'AT-1', provider: 'accesstrade' });
      await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'CONFIRMED', commission: 60000 }), 'accesstrade');
      expect(notifications.notify).toHaveBeenCalledWith('adm1', 'OPS_HEALTH_ALERT', expect.objectContaining({ summary: expect.stringContaining('42.000đ') }));
      expect(notifications.notify).not.toHaveBeenCalledWith('adm1', 'OPS_HEALTH_ALERT', expect.objectContaining({ summary: expect.stringContaining('35.000đ') }));
    });

    it('nit: status đổi giữa lúc phát hiện và lúc claim (settle chen vào) → claim thua, không gửi tin', async () => {
      const { prisma, updateMany } = conflictPrisma({ id: 'tx1', status: 'REJECTED', confirmedAt: null, userId: 'u1', userReward: 35000, adminReviewedAt: null, merchantOrderId: 'AT-1', provider: 'accesstrade' }, 0);
      await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
      const claim = updateMany.mock.calls.find(([a]) => 'conflictNotifiedAt' in a.where)![0];
      expect(claim.where).toEqual({ id: 'tx1', conflictNotifiedAt: null, status: 'CONFIRMED' });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('nit: PAID_REJECTED claim kèm status PAID', async () => {
      const { prisma, updateMany } = conflictPrisma({ id: 'tx1', status: 'PAID', confirmedAt: new Date(), userId: 'u1', userReward: 35000, merchantOrderId: 'AT-1', provider: 'accesstrade' });
      await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'REJECTED' }), 'accesstrade');
      expect(updateMany.mock.calls.find(([a]) => 'conflictNotifiedAt' in a.where)![0].where).toMatchObject({ status: 'PAID' });
    });

    it('sàn đưa CONFIRMED → REJECTED xoá dấu đã báo (để REVIVED lần hai báo lại được)', async () => {
      const { prisma, updateMany } = updateBranchPrisma({ id: 'tx1', status: 'CONFIRMED', confirmedAt: new Date(), userId: 'u1', userReward: 35000, adminReviewedAt: null });
      await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'REJECTED' }), 'accesstrade');
      expect(updateMany.mock.calls[0][0].data).toMatchObject({ status: 'REJECTED', conflictNotifiedAt: null });
    });

    it('PENDING → CONFIRMED bình thường không báo', async () => {
      const { prisma } = conflictPrisma({ id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u1', userReward: 35000, adminReviewedAt: null });
      await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('m4: thua CAS 3 lần liên tiếp → log error kèm mã đơn + trạng thái, ingest trả {ok:false, retry:true}', async () => {
      const row = { id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u1', userReward: 35000, adminReviewedAt: null, merchantOrderId: 'AT-9', provider: 'accesstrade' };
      const { prisma, updateMany, userUpdate } = updateBranchPrisma(row, 0);
      const svc = new CashbackService(prisma, config, notifications, registry);
      const err = jest.spyOn((svc as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
      const r = await svc.ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
      expect(updateMany).toHaveBeenCalledTimes(3);
      expect(userUpdate).not.toHaveBeenCalled();
      expect(r).toEqual({ ok: false, retry: true });
      expect(err).toHaveBeenCalledWith(expect.stringMatching(/AT-9.*CONFIRMED/));
    });

    it('lần báo thứ hai cho cùng dòng (đã đánh dấu) → không báo lại', async () => {
      const { prisma } = conflictPrisma(rejectedByAdmin, 0);
      await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('sàn chỉ báo PENDING cho dòng Kế toán đã chốt → không báo', async () => {
      const { prisma } = conflictPrisma(rejectedByAdmin);
      await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'PENDING' }), 'accesstrade');
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('sàn báo đúng như quyết định của Kế toán → không báo', async () => {
      const { prisma, userUpdate } = conflictPrisma(rejectedByAdmin);
      await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'REJECTED' }), 'accesstrade');
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('CAS của sự kiện sàn đòi dòng chưa có dấu duyệt tay (thua nếu Kế toán duyệt chen vào)', async () => {
      const { prisma, updateMany } = updateBranchPrisma({ id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u1', userReward: 35000, adminReviewedAt: null });
      await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
      expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'tx1', status: 'PENDING', userReward: 35000, adminReviewedAt: null });
    });

    it('duyệt tay ghi dấu adminReviewedAt + người duyệt', async () => {
      const { prisma, updateMany } = updateBranchPrisma({ id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u1', userReward: 35000, orderAmount: 1, commission: 1, merchantOrderId: 'AT-1', provider: 'accesstrade' });
      (prisma.cashbackTransaction as unknown as { findUnique: jest.Mock }).findUnique.mockResolvedValue({ id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u1', userReward: 35000, orderAmount: 1, commission: 1, merchantOrderId: 'AT-1', provider: 'accesstrade' });
      await new CashbackService(prisma, config, notifications, registry).adminReview('kt1', 'tx1', 'REJECTED');
      const data = updateMany.mock.calls[0][0].data;
      expect(data.adminReviewedAt).toBeInstanceOf(Date);
      expect(data.adminReviewedBy).toBe('kt1');
      // Quyết định tay mới làm mất hiệu lực dấu "đã báo lệch" cũ, để lần lệch sau (vd sàn đòi lại sau PAID) được báo lại.
      expect(data.conflictNotifiedAt).toBeNull();
      expect(data.conflictPayload).toBe(Prisma.DbNull);
      expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'tx1', status: 'PENDING', userReward: 35000 });
    });

    it('L2-08: đã PAID mà sàn báo REJECTED → không đổi tiền, lưu payload, báo ADMIN', async () => {
      const { prisma, updateMany, userUpdate } = conflictPrisma({ id: 'tx1', status: 'PAID', confirmedAt: new Date(), userId: 'u1', userReward: 35000, merchantOrderId: 'AT-1', provider: 'accesstrade' });
      await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'REJECTED', raw: { status: 'rejected' } }), 'accesstrade');
      expect(statusWrites(updateMany)).toHaveLength(0);
      expect(userUpdate).not.toHaveBeenCalled();
      const claim = updateMany.mock.calls.find(([a]) => 'conflictNotifiedAt' in a.where)![0];
      expect(claim.data.conflictPayload).toEqual({ status: 'rejected' });
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith('adm1', 'OPS_HEALTH_ALERT', expect.objectContaining({ summary: expect.stringContaining('đã trả về Ví') }));
    });

    it('đã PAID, sàn báo CONFIRMED lặp lại → im lặng như cũ', async () => {
      const { prisma } = conflictPrisma({ id: 'tx1', status: 'PAID', confirmedAt: new Date(), userId: 'u1', userReward: 35000 });
      await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  it('race chuyển trạng thái: updateMany count=0 (racer khác đã chuyển) → KHÔNG cộng pending lần 2', async () => {
    const { prisma, userUpdate } = updateBranchPrisma(
      { id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u9', userReward: 35000 },
      0, // CAS thua: status đã bị racer khác đổi
    );
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('L2-09: CAS khớp cả userReward đọc lúc quyết định', async () => {
    const { prisma, updateMany } = updateBranchPrisma({
      id: 'tx1', status: 'CONFIRMED', confirmedAt: new Date(), userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'REJECTED' }), 'accesstrade');
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'tx1', status: 'CONFIRMED', userReward: 35000, adminReviewedAt: null });
  });

  it('L2-09: thua CAS vì userReward đã đổi → đọc lại trong tx, trừ pending theo số MỚI trên dòng', async () => {
    const stale = { id: 'tx1', status: 'CONFIRMED', confirmedAt: new Date(), userId: 'u1', userReward: 35000 };
    const fresh = { ...stale, userReward: 28000 };
    const { prisma, updateMany, userUpdate } = updateBranchPrisma(stale, 1, fresh);
    updateMany.mockResolvedValueOnce({ count: 0 });
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'REJECTED' }), 'accesstrade');
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0].where).toEqual({ id: 'tx1', status: 'CONFIRMED', userReward: 28000, adminReviewedAt: null });
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { cashbackPending: { decrement: 28000 } } }));
  });

  it('L2-09: thua CAS vì dòng đã sang trạng thái khác → quyết định lại theo trạng thái mới (đã CONFIRMED thì PENDING muộn bị bỏ)', async () => {
    const stale = { id: 'tx1', status: 'PENDING', confirmedAt: null, userId: 'u1', userReward: 35000 };
    const fresh = { ...stale, status: 'CONFIRMED', confirmedAt: new Date() };
    const { prisma, updateMany, userUpdate } = updateBranchPrisma(stale, 0, fresh);
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'PENDING' }), 'accesstrade');
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('REJECTED → CONFIRMED → confirmedAt RESET (đồng hồ hold chạy lại), cộng pending', async () => {
    const oldConfirmedAt = new Date(Date.now() - 60 * 24 * 3600 * 1000); // 60 ngày trước
    const { prisma, updateMany, userUpdate } = updateBranchPrisma({
      id: 'tx1', status: 'REJECTED', confirmedAt: oldConfirmedAt, userId: 'u1', userReward: 35000,
    });
    await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
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
    const r = await new CashbackService(prisma, config, notifications, registry).ingest(
      event({ status: 'CONFIRMED' }),
      'accesstrade',
    );
    expect(r).toEqual({ ok: true });
    // Không bỏ qua sự kiện thua race: vẫn cộng cashbackPending như update bình thường.
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cashbackPending: { increment: 35000 } } }),
    );
  });

  // ── guard âm ──
  it('commission âm (phòng thủ ở ingest) → ok:false, không tạo giao dịch', async () => {
    const findUnique = jest.fn();
    const prisma = { cashbackClick: { findUnique } } as unknown as PrismaService;
    const r = await new CashbackService(prisma, config, notifications, registry).ingest(event({ commission: -1 }), 'accesstrade');
    expect(r).toEqual({ ok: false });
    expect(findUnique).not.toHaveBeenCalled();
  });

  // Q-05: thưởng giới thiệu chỉ còn theo đơn thứ 2 trong app (CoinsService.grantReferralOrderReward);
  // cashback sàn ngoài CONFIRMED không còn cấp xu giới thiệu cho ai.
  it('cashback CONFIRMED → chỉ cộng cashbackPending, không ghi xu (không có CoinsService)', async () => {
    const userUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      cashbackClick: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }) },
      cashbackTransaction: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      user: { update: userUpdate },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const r = await new CashbackService(prisma, config, notifications, registry).ingest(event({ status: 'CONFIRMED' }), 'accesstrade');
    expect(r).toEqual({ ok: true });
    expect((prisma as unknown as { coinTransaction?: unknown }).coinTransaction).toBeUndefined();
  });
});

describe('CashbackService.settleConfirmed', () => {
  function settlePrisma(due: Record<string, unknown>[], markCount = 1, lockedReward?: number) {
    const updateMany = jest.fn().mockResolvedValue({ count: markCount });
    const userUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      cashbackTransaction: {
        findMany: jest.fn().mockResolvedValue(due),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ userReward: lockedReward ?? due[0]?.userReward }),
        updateMany,
      },
      user: { update: userUpdate },
      $queryRaw: jest.fn().mockResolvedValue([{ metadata: null }]),
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma));
    return { prisma, updateMany, userUpdate, queryRaw: (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw };
  }

  it('tài khoản đã ẩn danh → không cộng Ví, không báo CASHBACK_PAID, vẫn chốt PAID', async () => {
    const { prisma, updateMany, queryRaw } = settlePrisma([{ id: 'tx1', userId: 'u1', userReward: 35000 }]);
    queryRaw.mockResolvedValue([{ metadata: { anonymizedAt: '2026-10-20T03:00:00.000Z' } }]);
    ledger.mockClear();
    await new CashbackService(prisma, config, notifications, registry).settleConfirmed();
    expect(updateMany).toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalledWith('u1', 'CASHBACK_PAID', expect.anything());
  });

  it('CONFIRMED quá hold → set PAID atomic + chuyển pending→Ví + bắn CASHBACK_PAID', async () => {
    const { prisma, updateMany, userUpdate } = settlePrisma([{ id: 'tx1', userId: 'u1', userReward: 35000 }]);
    await new CashbackService(prisma, config, notifications, registry).settleConfirmed();
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'tx1', status: 'CONFIRMED', confirmedAt: { lte: expect.any(Date) } });
    // Sang PAID là chặng mới của dòng: xoá dấu đã báo lệch để L2-08 báo được.
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ status: 'PAID', conflictNotifiedAt: null });
    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { cashbackPending: { decrement: 35000 } } }));
    expect(ledger).toHaveBeenCalledWith(prisma, {
      userId: 'u1',
      delta: 35000,
      type: 'CASHBACK',
      refType: 'CASHBACK',
      refId: 'tx1',
      reason: expect.any(String),
    });
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'CASHBACK_PAID', { amount: '35.000' });
  });

  it('RC-04: giao dịch bị REJECT rồi CONFIRMED lại với số mới giữa lúc cron lặp → trừ pending và cộng Ví theo số trên dòng đã khoá', async () => {
    const { prisma, userUpdate } = settlePrisma([{ id: 'tx1', userId: 'u1', userReward: 70000 }], 1, 30000);
    ledger.mockClear();
    (notifications.notify as jest.Mock).mockClear();
    await new CashbackService(prisma, config, notifications, registry).settleConfirmed();
    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { cashbackPending: { decrement: 30000 } } }));
    expect(ledger).toHaveBeenCalledWith(prisma, expect.objectContaining({ delta: 30000 }));
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'CASHBACK_PAID', { amount: '30.000' });
  });

  it('RC-04: mốc giữ chỉ tính tới hạn lúc chốt — CAS mang confirmedAt ≤ mốc đã dùng để chọn dòng', async () => {
    const { prisma, updateMany } = settlePrisma([{ id: 'tx1', userId: 'u1', userReward: 35000 }]);
    await new CashbackService(prisma, config, notifications, registry).settleConfirmed();
    const picked = (prisma.cashbackTransaction.findMany as jest.Mock).mock.calls[0][0].where.confirmedAt.lte as Date;
    expect(updateMany.mock.calls[0][0].where.confirmedAt.lte).toEqual(picked);
  });

  it('userReward = 0 → vẫn chốt PAID nhưng KHÔNG cộng ví và KHÔNG bắn "Hoàn tiền 0đ" (D5-07)', async () => {
    const { prisma, updateMany } = settlePrisma([{ id: 'tx0', userId: 'u1', userReward: 0 }]);
    ledger.mockClear();
    (notifications.notify as jest.Mock).mockClear();
    await new CashbackService(prisma, config, notifications, registry).settleConfirmed();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(ledger).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('multi-instance race: updateMany count=0 → KHÔNG cộng ví lần nữa, KHÔNG thông báo', async () => {
    const { prisma, userUpdate } = settlePrisma([{ id: 'tx1', userId: 'u1', userReward: 35000 }], 0);
    ledger.mockClear();
    await new CashbackService(prisma, config, notifications, registry).settleConfirmed();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
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
    const svc = new CashbackService(prisma, config, notifications, reg);
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
    const svc = new CashbackService(prisma, config, notifications, reg);
    const ingest = jest.spyOn(svc, 'ingest').mockResolvedValue({ ok: true });
    await svc.reconcile();
    expect(p.fetchTransactions).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith(ev, 'accesstrade');
  });

  it('fetchTransactions lỗi → nuốt lỗi, không throw (cron không vỡ)', async () => {
    const p = provider('accesstrade', true);
    (p.fetchTransactions as jest.Mock).mockRejectedValue(new Error('AT 500'));
    const reg = { all: () => [p], get: jest.fn() } as unknown as CashbackProviderRegistry;
    const svc = new CashbackService({} as unknown as PrismaService, config, notifications, reg);
    await expect(svc.reconcile()).resolves.toBeUndefined();
  });
});

/**
 * Trước đây không có đường quản trị nào cho cashback: trạng thái chỉ đổi qua postback, mà cron
 * reconcile tự tắt khi chưa có API key. Một postback rớt mạng là giao dịch nằm PENDING vĩnh
 * viễn — khách thấy "Chờ duyệt" vô thời hạn và không ai xử lý được ngoài chạy SQL.
 */
describe('CashbackService.adminListTransactions — che SĐT cho người không phải ADMIN', () => {
  const row = { id: 'c1', userId: 'u1', provider: 'p', merchantOrderId: 'M1', orderAmount: 1, commission: 1, userReward: 1, status: 'PENDING', confirmedAt: null, paidAt: null, clickId: null };
  const svcWith = () =>
    new CashbackService(
      {
        cashbackTransaction: { findMany: jest.fn().mockResolvedValue([row]) },
        user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', fullName: 'A', phone: '0912345678' }]) },
        cashbackClick: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService,
      config,
      notifications,
      registry,
    );

  it('select có adminReviewedAt và conflictNotifiedAt để Kế toán thấy dòng đang lệch', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = new CashbackService({ cashbackTransaction: { findMany } } as unknown as PrismaService, config, notifications, registry);
    await svc.adminListTransactions();
    expect(findMany.mock.calls[0][0].select).toMatchObject({ adminReviewedAt: true, conflictNotifiedAt: true });
  });

  it('Kế toán thấy 3 số cuối, ADMIN thấy đủ', async () => {
    expect((await svcWith().adminListTransactions(undefined, 100, { maskPhones: true }))[0]!.user).toEqual({ id: 'u1', fullName: 'A', phone: '*******678' });
    expect((await svcWith().adminListTransactions())[0]!.user).toEqual({ id: 'u1', fullName: 'A', phone: '0912345678' });
  });
});

describe('CashbackService.adminReview', () => {
  function mk(existing: Record<string, unknown> | null) {
    const userUpdate = jest.fn().mockResolvedValue({});
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      cashbackTransaction: {
        findUnique: jest.fn().mockResolvedValue(existing),
        updateMany: txUpdateMany,
      },
      user: { update: userUpdate },
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) =>
        cb({ cashbackTransaction: { updateMany: txUpdateMany }, user: { update: userUpdate } }),
      ),
    } as unknown as PrismaService;
    return {
      svc: new CashbackService(prisma, config, notifications, registry),
      userUpdate,
      txUpdateMany,
    };
  }

  const pending = {
    id: 'c1',
    userId: 'u1',
    status: 'PENDING',
    confirmedAt: null,
    userReward: 35000,
    orderAmount: 1000000,
    commission: 50000,
    merchantOrderId: 'SPX1',
    provider: 'accesstrade',
  };

  it('duyệt giao dịch treo → chuyển CONFIRMED và cộng đúng cashbackPending đã ghi', async () => {
    const { svc, userUpdate, txUpdateMany } = mk(pending);

    await svc.adminReview('admin1', 'c1', 'CONFIRMED', 'khách gửi ảnh đơn');

    expect(txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', status: 'PENDING', userReward: 35000 } }),
    );
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { cashbackPending: { increment: 35000 } },
    });
  });

  it('Kế toán duyệt (byStaff): duyệt được giao dịch của khách; giao dịch của chính mình bị chặn, không ghi gì', async () => {
    const ok = mk(pending);
    await ok.svc.adminReview('kt1', 'c1', 'CONFIRMED', undefined, { byStaff: true });
    expect(ok.txUpdateMany).toHaveBeenCalled();
    const own = mk({ ...pending, userId: 'kt1' });
    await expect(own.svc.adminReview('kt1', 'c1', 'CONFIRMED', undefined, { byStaff: true })).rejects.toBeInstanceOf(ForbiddenException);
    expect(own.txUpdateMany).not.toHaveBeenCalled();
    const admin = mk({ ...pending, userId: 'admin1' });
    await expect(admin.svc.adminReview('admin1', 'c1', 'CONFIRMED')).resolves.toBeDefined();
  });

  it('KHÔNG định giá lại: giữ nguyên số tiền đã ghi khi duyệt', async () => {
    const { svc, txUpdateMany } = mk(pending);

    await svc.adminReview('admin1', 'c1', 'CONFIRMED');

    const data = txUpdateMany.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.orderAmount).toBe(1000000);
    expect(data.commission).toBe(50000);
    expect(data.userReward).toBe(35000);
  });

  it('từ chối giao dịch ĐÃ confirmed → trừ lại cashbackPending', async () => {
    const { svc, userUpdate } = mk({ ...pending, status: 'CONFIRMED', confirmedAt: new Date() });

    await svc.adminReview('admin1', 'c1', 'REJECTED', 'sàn báo huỷ đơn');

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { cashbackPending: { decrement: 35000 } },
    });
  });

  it('L2-07: CAS thua (tab khác vừa xử lý) → 409 với câu tải lại, không cộng pending', async () => {
    const { svc, userUpdate, txUpdateMany } = mk(pending);
    txUpdateMany.mockResolvedValue({ count: 0 });
    await expect(svc.adminReview('admin1', 'c1', 'CONFIRMED')).rejects.toMatchObject({
      status: 409,
      message: 'Khoản này vừa được người khác xử lý — tải lại.',
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('giao dịch ĐÃ trả về Ví (PAID) → từ chối đổi trạng thái (không claw-back được)', async () => {
    const { svc, userUpdate } = mk({ ...pending, status: 'PAID' });

    await expect(svc.adminReview('admin1', 'c1', 'REJECTED')).rejects.toBeInstanceOf(BadRequestException);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('đặt lại đúng trạng thái đang có → từ chối (tránh bấm nhầm 2 lần)', async () => {
    const { svc } = mk(pending);
    await expect(svc.adminReview('admin1', 'c1', 'PENDING' as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('không tìm thấy giao dịch → NotFound', async () => {
    const { svc } = mk(null);
    await expect(svc.adminReview('admin1', 'cX', 'CONFIRMED')).rejects.toBeInstanceOf(NotFoundException);
  });
});
