import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StorefrontQuestService, QUESTS } from './storefront-quest.service';
import { RewardPointsService } from '../wallet/reward-points.service';

function makeDeps(over: any = {}) {
  const prisma = {
    storefront: { findFirst: jest.fn() },
    storefrontItem: { count: jest.fn().mockResolvedValue(0) },
    commission: { count: jest.fn().mockResolvedValue(0) },
    coinTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    pointsTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ pointsBalance: 0 }) },
    ...over,
  } as any;
  const coins = { grant: jest.fn().mockResolvedValue(true) } as any;
  return { prisma, coins };
}

describe('StorefrontQuestService.listQuests: lời hứa duyệt theo cờ', () => {
  const run = async (flag: boolean | undefined) => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({ id: 'sf1', isPublished: false, collections: [] });
    const config = { get: async <T>(_k: string, fb?: T) => (flag === undefined ? fb : flag) as T } as any;
    const out = await new StorefrontQuestService(prisma, coins, config).listQuests('u1');
    return out.quests.find((q: { code: string }) => q.code === 'publish')!.hint as string;
  };

  it('cờ duyệt bật: hứa Tubu duyệt; cờ tắt: không nhắc duyệt', async () => {
    expect(await run(true)).toContain('Tubu duyệt');
    expect(await run(false)).not.toMatch(/duyệt/);
    expect(await run(false)).toContain('xem được ngay');
  });
});

describe('StorefrontQuestService.listQuests', () => {
  it('ném NotFound nếu CTV chưa có gian hàng', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(null);
    const svc = new StorefrontQuestService(prisma, coins);
    await expect(svc.listQuests('u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tính done theo stats + claimed theo dòng QUEST ở sổ xu cũ HOẶC sổ điểm (PD-3)', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({
      id: 'sf1', avatarUrl: 'a', headerNote: 'n', coverUrl: 'c', isPublished: true,
      collections: [{ items: [{ note: 'x' }, { note: null }, { note: 'y' }, { note: 'z' }, { note: 'w' }] }],
    });
    prisma.commission.count.mockResolvedValue(1);
    prisma.coinTransaction.findMany.mockResolvedValue([{ reason: 'STOREFRONT_QUEST:profile_complete' }]);
    prisma.pointsTransaction.findMany.mockResolvedValue([{ reason: 'STOREFRONT_QUEST:publish' }]);
    const svc = new StorefrontQuestService(prisma, coins);
    const out = await svc.listQuests('u1');
    const byCode = Object.fromEntries(out.quests.map((q) => [q.code, q]));
    expect(byCode['profile_complete']?.done).toBe(true);
    expect(byCode['profile_complete']?.claimed).toBe(true); // nhận bằng xu trước gộp
    expect(byCode['publish']?.claimed).toBe(true); // nhận bằng điểm sau gộp
    expect(byCode['add_5_products']?.done).toBe(true); // 5 items
    expect(byCode['add_5_products']?.claimed).toBe(false);
    for (const where of [prisma.coinTransaction.findMany.mock.calls[0][0].where, prisma.pointsTransaction.findMany.mock.calls[0][0].where]) {
      expect(where).toEqual({ userId: 'u1', refType: 'QUEST' });
    }
    expect(byCode['notes_3']?.done).toBe(true); // 4 có note >= 3
    expect(byCode['publish']?.done).toBe(true);
    expect(byCode['first_order']?.done).toBe(true);
    expect(out.totalEarnedPoints).toBe(2_000 + 1_000);
    expect(out).not.toHaveProperty('totalEarnedXu');
    expect(out.quests[0]).not.toHaveProperty('rewardXu');
    expect(out.level).toBe(2);
    expect(out.levelMax).toBe(QUESTS.length);
  });

  it('done=false khi chưa đạt goal', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({
      id: 'sf1', avatarUrl: null, headerNote: null, coverUrl: null, isPublished: false,
      collections: [{ items: [{ note: null }] }],
    });
    const svc = new StorefrontQuestService(prisma, coins);
    const out = await svc.listQuests('u1');
    const byCode = Object.fromEntries(out.quests.map((q) => [q.code, q]));
    expect(byCode['profile_complete']?.done).toBe(false);
    expect(byCode['add_5_products']?.progress).toBe(1);
    expect(byCode['add_5_products']?.done).toBe(false);
  });
});

describe('StorefrontQuestService.claimQuest', () => {
  const baseSf = {
    id: 'sf1', avatarUrl: 'a', headerNote: 'n', coverUrl: 'c', isPublished: true,
    collections: [{ items: [{ note: 'x' }, { note: 'y' }, { note: 'z' }, { note: 'w' }, { note: 'v' }] }],
  };

  it('ném BadRequest nếu quest chưa đạt', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({ ...baseSf, isPublished: false });
    const svc = new StorefrontQuestService(prisma, coins);
    await expect(svc.claimQuest('u1', 'publish')).rejects.toBeInstanceOf(BadRequestException);
    expect(coins.grant).not.toHaveBeenCalled();
  });

  it('ném BadRequest nếu code không tồn tại', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(baseSf);
    const svc = new StorefrontQuestService(prisma, coins);
    await expect(svc.claimQuest('u1', 'khong-co')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cấp Điểm Xanh đúng reason + refType QUEST khi đạt, trả số dư điểm', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(baseSf);
    prisma.user.findUniqueOrThrow.mockResolvedValue({ pointsBalance: 7 });
    const svc = new StorefrontQuestService(prisma, coins);
    const out = await svc.claimQuest('u1', 'publish');
    expect(coins.grant).toHaveBeenCalledWith('u1', 1000, 'STOREFRONT_QUEST:publish', 'QUEST', 'sf1');
    expect(out).toEqual({ claimed: true, alreadyClaimed: false, code: 'publish', rewardPoints: 1000, pointsBalance: 7 });
  });

  it('đã nhận trước đó (bằng xu trước gộp hoặc bằng điểm) → báo đã nhận, không cấp thêm', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(baseSf);
    coins.grant.mockResolvedValue(false);
    const out = await new StorefrontQuestService(prisma, coins).claimQuest('u1', 'publish');
    expect(out).toMatchObject({ claimed: true, alreadyClaimed: true, rewardPoints: 1000 });
  });

  it('mức thưởng nhiệm vụ theo bảng PD-3 mục 4: 2.000/2.000/2.000/1.000/5.000 Điểm Xanh (1 xu = 1 điểm)', () => {
    expect(QUESTS.map((q) => [q.code, q.rewardPoints])).toEqual([
      ['profile_complete', 2_000],
      ['add_5_products', 2_000],
      ['notes_3', 2_000],
      ['publish', 1_000],
      ['first_order', 5_000],
    ]);
  });
});

describe('StorefrontQuestService: "Đơn hàng đầu tiên" không tính hoa hồng đã huỷ (REJECTED)', () => {
  // count mô phỏng đúng điều kiện lọc status của Prisma (`not`) trên danh sách hoa hồng trong bộ nhớ.
  function withCommissions(statuses: string[]) {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({ id: 'sf1', isPublished: false, collections: [] });
    prisma.commission.count.mockImplementation(async ({ where }: { where: { affiliateUserId: string; status?: { not: string } } }) =>
      statuses.filter((st) => where.affiliateUserId === 'u1' && (!where.status || st !== where.status.not)).length,
    );
    return { svc: new StorefrontQuestService(prisma, coins), coins };
  }
  const firstOrder = async (svc: StorefrontQuestService) => (await svc.listQuests('u1')).quests.find((q) => q.code === 'first_order')!;

  it('chỉ có hoa hồng REJECTED → chưa xong, không nhận thưởng được', async () => {
    const { svc, coins } = withCommissions(['REJECTED', 'REJECTED']);
    expect((await firstOrder(svc)).done).toBe(false);
    await expect(svc.claimQuest('u1', 'first_order')).rejects.toBeInstanceOf(BadRequestException);
    expect(coins.grant).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'LOCKED', 'APPROVED', 'PAID'])('có hoa hồng %s → xong', async (status) => {
    const { svc } = withCommissions(['REJECTED', status]);
    expect((await firstOrder(svc)).done).toBe(true);
  });
});

describe('StorefrontQuestService: "Đơn hàng đầu tiên" chỉ tính đơn khách tự đặt đã giao', () => {
  it('lọc hoa hồng theo đơn DELIVERED, không đặt hộ, không phải đơn của chính CTV', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({ id: 'sf1', isPublished: false, collections: [] });
    await new StorefrontQuestService(prisma, coins).listQuests('u1');
    expect(prisma.commission.count).toHaveBeenCalledWith({
      where: {
        affiliateUserId: 'u1',
        status: { not: 'REJECTED' },
        order: { status: 'DELIVERED', placedForCustomer: false, userId: { not: 'u1' } },
      },
    });
  });

  it('đã nhận thưởng theo luật cũ mà số đo mới chưa đạt: vẫn hiện done và tiến độ đầy', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({ id: 'sf1', isPublished: false, collections: [] });
    prisma.pointsTransaction.findMany.mockResolvedValue([{ reason: 'STOREFRONT_QUEST:first_order' }]);
    const q = (await new StorefrontQuestService(prisma, coins).listQuests('u1')).quests.find((x) => x.code === 'first_order')!;
    expect(q).toMatchObject({ claimed: true, done: true, progress: 1, goal: 1 });
  });

  it('gợi ý nói rõ khách tự đặt và nhận hàng', () => {
    expect(QUESTS.find((q) => q.code === 'first_order')!.hint).toBe(
      'Chia sẻ link, khi khách tự đặt và nhận hàng thành công bạn nhận thưởng!',
    );
  });
});

describe('StorefrontQuestService.claimQuest: song song (bấm đúp / hai thiết bị cùng lúc)', () => {
  const tick = () => new Promise<void>((r) => setImmediate(r));
  const sf = {
    id: 'sf1', avatarUrl: 'a', headerNote: 'n', coverUrl: 'c', isPublished: true,
    collections: [{ items: [{ note: 'x' }, { note: 'y' }, { note: 'z' }, { note: 'w' }, { note: 'v' }] }],
  };

  /**
   * Sổ điểm giả giữ đúng partial unique index points_transactions_quest_unique (userId, reason) WHERE refType='QUEST':
   * createManyAndReturn(skipDuplicates) = ON CONFLICT DO NOTHING (trả [] khi trùng), create thường ném P2002 như Postgres.
   * Không có rollback → code chỉ được tăng số dư SAU khi dòng sổ ghi được (đúng thứ tự của applyPointsDelta).
   */
  function makeWorld(over: { legacyCoin?: boolean } = {}) {
    const ledger: Array<{ userId: string; reason: string; refType: string | null; delta: number }> = [];
    const balances = new Map<string, number>([['u1', 0], ['u2', 0]]);
    const dup = (userId: string, row: { reason: string; refType?: string | null }) =>
      row.refType === 'QUEST' && ledger.some((l) => l.userId === userId && l.reason === row.reason && l.refType === 'QUEST');
    const client = {
      storefront: { findFirst: async () => { await tick(); return sf; } },
      commission: { count: async () => { await tick(); return 0; } },
      coinTransaction: { findFirst: async () => { await tick(); return over.legacyCoin ? { id: 'coin-1' } : null; } },
      pointsTransaction: {
        createManyAndReturn: async ({ data, skipDuplicates }: any) => {
          await tick();
          const out: Array<{ id: string }> = [];
          for (const row of data) {
            if (dup(row.userId, row)) {
              if (skipDuplicates) continue;
              throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
            }
            ledger.push({ userId: row.userId, reason: row.reason, refType: row.refType, delta: row.delta });
            out.push({ id: `pt-${ledger.length}` });
          }
          return out;
        },
        create: async ({ data }: any) => {
          await tick();
          if (dup(data.userId, data)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          ledger.push({ userId: data.userId, reason: data.reason, refType: data.refType, delta: data.delta });
          return { id: `pt-${ledger.length}` };
        },
      },
      user: {
        update: async ({ where, data }: any) => {
          await tick();
          balances.set(where.id, (balances.get(where.id) ?? 0) + (data.pointsBalance?.increment ?? 0));
          return {};
        },
        findUniqueOrThrow: async ({ where }: any) => { await tick(); return { pointsBalance: balances.get(where.id) ?? 0 }; },
      },
    };
    const prisma: any = { ...client, $transaction: async (fn: (tx: unknown) => unknown) => fn(client) };
    const config = { get: async <T>(_k: string, fb?: T) => fb as T } as any;
    const rewards = new RewardPointsService(prisma, config);
    return { svc: new StorefrontQuestService(prisma, rewards, config), ledger, balances };
  }

  it('6 lời gọi song song cùng nhiệm vụ: đúng 1 lần cấp, 5 lần còn lại alreadyClaimed, ví +1.000, 1 dòng sổ', async () => {
    const { svc, ledger, balances } = makeWorld();
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => svc.claimQuest('u1', 'publish')));
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
    const ok = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof svc.claimQuest>>>).value);
    expect(ok.filter((r) => !r.alreadyClaimed)).toHaveLength(1);
    expect(ok.filter((r) => r.alreadyClaimed)).toHaveLength(5);
    for (const r of ok) expect(r).toMatchObject({ claimed: true, code: 'publish', rewardPoints: 1_000 });
    expect(ledger).toEqual([{ userId: 'u1', reason: 'STOREFRONT_QUEST:publish', refType: 'QUEST', delta: 1_000 }]);
    expect(balances.get('u1')).toBe(1_000);
  });

  it('bấm lại tuần tự sau lượt song song: alreadyClaimed, ví không đổi', async () => {
    const { svc, balances } = makeWorld();
    await Promise.all(Array.from({ length: 3 }, () => svc.claimQuest('u1', 'publish')));
    const again = await svc.claimQuest('u1', 'publish');
    expect(again).toMatchObject({ claimed: true, alreadyClaimed: true, pointsBalance: 1_000 });
    expect(balances.get('u1')).toBe(1_000);
  });

  it('nhiệm vụ khác nhau / người khác nhau song song thì khoá không chặn nhầm: mỗi (user, nhiệm vụ) nhận đúng một lần', async () => {
    const { svc, ledger, balances } = makeWorld();
    await Promise.all([
      ...Array.from({ length: 3 }, () => svc.claimQuest('u1', 'publish')),
      ...Array.from({ length: 3 }, () => svc.claimQuest('u1', 'profile_complete')),
      ...Array.from({ length: 3 }, () => svc.claimQuest('u2', 'publish')),
    ]);
    expect(ledger).toHaveLength(3);
    expect(balances.get('u1')).toBe(1_000 + 2_000);
    expect(balances.get('u2')).toBe(1_000);
  });

  it('đã nhận bằng xu trước gộp (sổ xu cũ có dòng QUEST): song song vẫn không cấp điểm', async () => {
    const { svc, ledger, balances } = makeWorld({ legacyCoin: true });
    const results = await Promise.all(Array.from({ length: 4 }, () => svc.claimQuest('u1', 'publish')));
    for (const r of results) expect(r).toMatchObject({ claimed: true, alreadyClaimed: true });
    expect(ledger).toHaveLength(0);
    expect(balances.get('u1')).toBe(0);
  });
});
