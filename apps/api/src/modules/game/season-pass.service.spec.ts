import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SeasonPassService } from './season-pass.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { RewardPointsService } from '../wallet/reward-points.service';

// PD-3: phần thưởng premium là Điểm Xanh (migration đổi {type:'XU',amount:n} → {type:'POINTS',amount:ceil(n/1000)}).
const TIERS = [
  { xp: 30, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'POINTS', amount: 5 } },
  { xp: 70, free: { type: 'SEEDS', amount: 30 }, premium: { type: 'POINTS', amount: 8 } },
  { xp: 120, free: { type: 'SEEDS', amount: 40 }, premium: { type: 'XU', amount: 12000 } },
];

/** Config mock: override theo key, fallback nếu không có. */
function makeConfig(overrides: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(k: string, fb?: T): Promise<T> => (k in overrides ? (overrides[k] as T) : (fb as T)),
  } as unknown as SystemConfigService;
}

/** Prisma stub — chỉ bảng SeasonPassService dùng. $transaction chạy callback thật với chính db (đã merge override). */
function makePrisma(over: Record<string, unknown> = {}) {
  const db: Record<string, unknown> = {
    season: { findFirst: jest.fn().mockResolvedValue({ id: 's1', name: 'Mùa Hè Xanh' }) },
    userSeasonPass: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    subscription: { findMany: jest.fn().mockResolvedValue([]) },
    order: { count: jest.fn().mockResolvedValue(0) },
    gameProfile: {
      findUnique: jest.fn().mockResolvedValue({ userId: 'u1', totalSeeds: 10 }),
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({ totalSeeds: 10 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    coinTransaction: { create: jest.fn().mockResolvedValue({}) },
    user: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ zaloId: 'zalo-u1', phone: null }) },
    ...over,
  };
  db.$transaction = jest
    .fn()
    .mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(db) : Promise.all(arg as unknown[]),
    );
  return db as unknown as PrismaService;
}

const EXPIRES = new Date('2027-10-15T00:00:00Z');

function svcWith(
  prisma: PrismaService,
  cfg = makeConfig({ 'seasonpass.tiers': TIERS }),
  rewards: { grant: jest.Mock; expiresAt: jest.Mock } = { grant: jest.fn().mockResolvedValue(true), expiresAt: jest.fn().mockResolvedValue(EXPIRES) },
) {
  return { svc: new SeasonPassService(prisma, cfg, rewards as unknown as RewardPointsService), prisma, rewards };
}

describe('SeasonPassService.addXp', () => {
  it('mùa đang diễn ra → upsert tăng xp', async () => {
    const p = makePrisma();
    const { svc } = svcWith(p);
    await svc.addXp('u1', 10);
    const call = (p.userSeasonPass.upsert as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ userId_seasonId: { userId: 'u1', seasonId: 's1' } });
    expect(call.create).toMatchObject({ userId: 'u1', seasonId: 's1', xp: 10 });
    expect(call.update).toEqual({ xp: { increment: 10 } });
  });

  it('không có mùa → no-op (không upsert)', async () => {
    const p = makePrisma({ season: { findFirst: jest.fn().mockResolvedValue(null) } });
    const { svc } = svcWith(p);
    await svc.addXp('u1', 10);
    expect(p.userSeasonPass.upsert).not.toHaveBeenCalled();
  });

  it('amount <= 0 → no-op', async () => {
    const p = makePrisma();
    const { svc } = svcWith(p);
    await svc.addXp('u1', 0);
    expect(p.userSeasonPass.upsert).not.toHaveBeenCalled();
  });

  it('không ném lỗi khi Prisma lỗi (side-effect an toàn)', async () => {
    const p = makePrisma({
      season: { findFirst: jest.fn().mockResolvedValue({ id: 's1', name: 'M' }) },
      userSeasonPass: { upsert: jest.fn().mockRejectedValue(new Error('db down')) },
    });
    const { svc } = svcWith(p);
    await expect(svc.addXp('u1', 10)).resolves.toBeUndefined();
  });
});

describe('SeasonPassService.getState', () => {
  it('không có mùa → { active: false }', async () => {
    const p = makePrisma({ season: { findFirst: jest.fn().mockResolvedValue(null) } });
    const { svc } = svcWith(p);
    expect(await svc.getState('u1')).toEqual({ active: false });
  });

  it('mùa đang diễn ra → cờ unlocked/claimed + premiumEligible', async () => {
    const p = makePrisma({
      userSeasonPass: {
        findUnique: jest.fn().mockResolvedValue({ xp: 80, claimedFree: [0], claimedPremium: [] }),
      },
      subscription: { findMany: jest.fn().mockResolvedValue([{ id: 'sub1' }]) },
      order: { count: jest.fn().mockResolvedValue(1) },
    });
    const { svc } = svcWith(p);
    const st = await svc.getState('u1');
    if (!st.active) throw new Error('expected active season');
    expect(st.seasonTitle).toBe('Mùa Hè Xanh');
    expect(st.xp).toBe(80);
    expect(st.premiumEligible).toBe(true);
    // tier0 (30) & tier1 (70) unlocked, tier2 (120) chưa
    expect(st.tiers.map((t) => t.unlocked)).toEqual([true, true, false]);
    const [t0] = st.tiers;
    if (!t0) throw new Error('expected tier 0');
    expect(t0.claimedFree).toBe(true);
    expect(t0.claimedPremium).toBe(false);
    expect(t0.free).toEqual({ type: 'SEEDS', amount: 20 });
    expect(t0.premium).toEqual({ type: 'POINTS', amount: 5 });
    expect(t0.xpRequired).toBe(30);
  });

  it('không có gói đăng ký → premiumEligible=false, mọi cờ claimed=false khi chưa có pass', async () => {
    const p = makePrisma();
    const { svc } = svcWith(p);
    const st = await svc.getState('u1');
    if (!st.active) throw new Error('expected active season');
    expect(st.premiumEligible).toBe(false);
    expect(st.xp).toBe(0);
    expect(st.tiers.every((t) => !t.unlocked && !t.claimedFree && !t.claimedPremium)).toBe(true);
  });

  it('khách vãng lai: pointsBlocked=GUEST để client không hứa Điểm Xanh; tiến độ và bậc giữ nguyên', async () => {
    const p = makePrisma({
      userSeasonPass: { findUnique: jest.fn().mockResolvedValue({ xp: 80, claimedFree: [], claimedPremium: [] }) },
      user: { findUnique: jest.fn().mockResolvedValue({ zaloId: 'guest_h_abc', phone: null }) },
    });
    const st = await svcWith(p).svc.getState('u1');
    if (!st.active) throw new Error('expected active season');
    expect(st).toMatchObject({ pointsBlocked: 'GUEST', xp: 80 });
    expect(st.tiers.map((t) => t.unlocked)).toEqual([true, true, false]);
  });

  it('user thật (Zalo thật hoặc guest đã có SĐT) không có cờ pointsBlocked', async () => {
    for (const owner of [{ zaloId: 'zalo-u1', phone: null }, { zaloId: 'guest_h_abc', phone: '0901234567' }]) {
      const p = makePrisma({ user: { findUnique: jest.fn().mockResolvedValue(owner) } });
      const st = await svcWith(p).svc.getState('u1');
      expect(st).not.toHaveProperty('pointsBlocked');
    }
  });
});

describe('SeasonPassService.claim', () => {
  it('không có mùa → BadRequest', async () => {
    const p = makePrisma({ season: { findFirst: jest.fn().mockResolvedValue(null) } });
    const { svc } = svcWith(p);
    await expect(svc.claim('u1', 0, 'free')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bậc ngoài phạm vi → BadRequest', async () => {
    const { svc } = svcWith(makePrisma());
    await expect(svc.claim('u1', 9, 'free')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('chưa đủ XP → BadRequest "Chưa đủ XP."', async () => {
    const p = makePrisma({
      userSeasonPass: { findUnique: jest.fn().mockResolvedValue({ xp: 10, claimedFree: [], claimedPremium: [] }) },
    });
    const { svc } = svcWith(p);
    await expect(svc.claim('u1', 0, 'free')).rejects.toMatchObject({ message: 'Chưa đủ XP.' });
  });

  it('đã nhận rồi → BadRequest "Đã nhận rồi."', async () => {
    const p = makePrisma({
      userSeasonPass: { findUnique: jest.fn().mockResolvedValue({ xp: 100, claimedFree: [0], claimedPremium: [] }) },
    });
    const { svc } = svcWith(p);
    await expect(svc.claim('u1', 0, 'free')).rejects.toMatchObject({ message: 'Đã nhận rồi.' });
  });

  it('premium khi chưa đủ điều kiện → BadRequest', async () => {
    const p = makePrisma({
      userSeasonPass: { findUnique: jest.fn().mockResolvedValue({ xp: 100, claimedFree: [], claimedPremium: [] }) },
      subscription: { findMany: jest.fn().mockResolvedValue([{ id: 'sub1' }]) },
      order: { count: jest.fn().mockResolvedValue(0) },
    });
    const { svc } = svcWith(p);
    await expect(svc.claim('u1', 0, 'premium')).rejects.toMatchObject({
      message: 'Cần có gói định kỳ đã giao ít nhất một đơn để mở phần thưởng Cao cấp.',
    });
  });

  it('thành công FREE (SEEDS) → cộng 💧 ATOMIC có cap + đánh dấu claimedFree (guard atomic)', async () => {
    const p = makePrisma({
      userSeasonPass: {
        findUnique: jest.fn().mockResolvedValue({ xp: 100, claimedFree: [], claimedPremium: [] }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      gameProfile: {
        // Mô phỏng increment atomic thật trong DB: 490 + 20 = 510 (vượt cap 500).
        upsert: jest.fn().mockResolvedValue({ totalSeeds: 510 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    });
    const { svc } = svcWith(p, makeConfig({ 'seasonpass.tiers': TIERS, 'game.tank_capacity': 500 }));
    const r = await svc.claim('u1', 0, 'free');
    expect(r).toEqual({ claimed: true, reward: { type: 'SEEDS', amount: 20 } });
    // Cộng ATOMIC qua upsert increment (không phải absolute value đọc-ngoài-tx).
    const upsertArg = (p.gameProfile.upsert as jest.Mock).mock.calls[0][0];
    expect(upsertArg.update).toEqual({ totalSeeds: { increment: 20 } });
    expect(upsertArg.create.ecoImpact).toEqual(expect.objectContaining({ progress: 0, target: 60, treesPlanted: 0 }));
    // Vượt cap → clamp guarded (totalSeeds > cap), không set tuyệt đối không điều kiện.
    // Chỉ cắt phần vừa cộng, giữ phần đã vượt sẵn từ nước theo đơn.
    const [, cap, added, uid, capAgain] = (p.$executeRaw as jest.Mock).mock.calls[0];
    expect([cap, added, uid, capAgain]).toEqual([500, 20, 'u1', 500]);
    // Guard double-claim atomic: updateMany với filter "chưa có tier" (NOT has), rồi push.
    const guardArg = (p.userSeasonPass.updateMany as jest.Mock).mock.calls[0][0];
    expect(guardArg.where).toEqual({ userId: 'u1', seasonId: 's1', NOT: { claimedFree: { has: 0 } } });
    expect(guardArg.data).toEqual({ claimedFree: { push: 0 } });
  });

  function premiumReady() {
    return makePrisma({
      userSeasonPass: {
        findUnique: jest.fn().mockResolvedValue({ xp: 300, claimedFree: [], claimedPremium: [] }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      subscription: { findMany: jest.fn().mockResolvedValue([{ id: 'sub1' }]) },
      order: { count: jest.fn().mockResolvedValue(1) },
    });
  }

  it('thành công PREMIUM (POINTS) → cấp Điểm Xanh qua RewardPointsService.grant TRÊN tx (atomic) + đánh dấu claimedPremium, không đụng xu', async () => {
    const p = premiumReady();
    const { svc, rewards } = svcWith(p, makeConfig({ 'seasonpass.tiers': TIERS }));
    const r = await svc.claim('u1', 0, 'premium');
    expect(r).toEqual({ claimed: true, reward: { type: 'POINTS', amount: 5 } });
    // Cấp TRÊN tx của claim (không mở transaction riêng) để rollback cùng việc đánh dấu đã nhận.
    expect(rewards.grant).toHaveBeenCalledWith('u1', 5, 'SEASONPASS:s1:0:premium', 'SEASONPASS', 's1', p, EXPIRES);
    const pAny = p as unknown as { coinTransaction: { create: jest.Mock }; user: { update: jest.Mock } };
    expect(pAny.coinTransaction.create).not.toHaveBeenCalled();
    expect(pAny.user.update).not.toHaveBeenCalled();
    expect((p.userSeasonPass.updateMany as jest.Mock).mock.calls[0][0].data).toEqual({ claimedPremium: { push: 0 } });
  });

  describe('khách vãng lai (không phải user thật)', () => {
    const guest = { zaloId: 'guest_h_abc', phone: null };

    it('bậc thưởng Điểm Xanh → 403, KHÔNG đánh dấu đã nhận, KHÔNG cấp điểm (nhận được sau khi đăng nhập Zalo)', async () => {
      const p = premiumReady();
      (p.user.findUnique as jest.Mock).mockResolvedValue(guest);
      const { svc, rewards } = svcWith(p, makeConfig({ 'seasonpass.tiers': TIERS }));
      await expect(svc.claim('u1', 0, 'premium')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.claim('u1', 0, 'premium')).rejects.toThrow('Đăng nhập Zalo để nhận Điểm Xanh');
      expect(rewards.grant).not.toHaveBeenCalled();
      expect(p.userSeasonPass.updateMany).not.toHaveBeenCalled();
    });

    it('bậc thưởng giọt nước vẫn nhận bình thường', async () => {
      const p = makePrisma({
        userSeasonPass: {
          findUnique: jest.fn().mockResolvedValue({ xp: 100, claimedFree: [], claimedPremium: [] }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        user: { findUnique: jest.fn().mockResolvedValue(guest) },
      });
      const { svc } = svcWith(p, makeConfig({ 'seasonpass.tiers': TIERS }));
      await expect(svc.claim('u1', 0, 'free')).resolves.toEqual({ claimed: true, reward: { type: 'SEEDS', amount: 20 } });
    });

    it('khách đã có SĐT là user thật: nhận Điểm Xanh như thường', async () => {
      const p = premiumReady();
      (p.user.findUnique as jest.Mock).mockResolvedValue({ zaloId: 'guest_h_abc', phone: '0901234567' });
      const { svc, rewards } = svcWith(p, makeConfig({ 'seasonpass.tiers': TIERS }));
      await expect(svc.claim('u1', 0, 'premium')).resolves.toMatchObject({ claimed: true });
      expect(rewards.grant).toHaveBeenCalledTimes(1);
    });
  });

  it('bậc còn cấu hình XU (đơn vị xu, chưa quy đổi) → từ chối, KHÔNG cấp, KHÔNG đánh dấu đã nhận', async () => {
    const p = premiumReady();
    const { svc, rewards } = svcWith(p, makeConfig({ 'seasonpass.tiers': TIERS }));
    await expect(svc.claim('u1', 2, 'premium')).rejects.toBeInstanceOf(BadRequestException);
    expect(rewards.grant).not.toHaveBeenCalled();
    expect(p.userSeasonPass.updateMany).not.toHaveBeenCalled();
    expect((p as unknown as { coinTransaction: { create: jest.Mock } }).coinTransaction.create).not.toHaveBeenCalled();
  });

  it('loại phần thưởng lạ → từ chối, không đánh dấu đã nhận', async () => {
    const p = premiumReady();
    const tiers = [{ xp: 1, free: { type: 'CASH', amount: 1 }, premium: { type: 'POINTS', amount: 1 } }];
    const { svc, rewards } = svcWith(p, makeConfig({ 'seasonpass.tiers': tiers }));
    await expect(svc.claim('u1', 0, 'free')).rejects.toBeInstanceOf(BadRequestException);
    expect(rewards.grant).not.toHaveBeenCalled();
    expect(p.userSeasonPass.updateMany).not.toHaveBeenCalled();
  });

  it('grant ném (vd số điểm vượt trần 2.000) → claim ném, lỗi lan ra khỏi tx để rollback đánh dấu', async () => {
    const p = premiumReady();
    const rewards = { grant: jest.fn().mockRejectedValue(new Error('Thưởng Điểm Xanh không hợp lệ')), expiresAt: jest.fn().mockResolvedValue(EXPIRES) };
    const tiers = [{ xp: 1, free: { type: 'SEEDS', amount: 1 }, premium: { type: 'POINTS', amount: 5000 } }];
    const { svc } = svcWith(p, makeConfig({ 'seasonpass.tiers': tiers }), rewards);
    await expect(svc.claim('u1', 0, 'premium')).rejects.toThrow('Thưởng Điểm Xanh không hợp lệ');
  });

  it('double-claim race: guard updateMany count=0 (bậc vừa bị claim bởi request song song) → BadRequest, không cấp thưởng', async () => {
    const p = makePrisma({
      userSeasonPass: {
        findUnique: jest.fn().mockResolvedValue({ xp: 100, claimedFree: [], claimedPremium: [] }), // pre-check ngoài tx
        // Guard atomic trong tx: request song song đã push tier trước → count=0 (race-safe,
        // thay cho re-read-rồi-check cũ vốn vẫn có thể bị 2 request cùng vượt qua).
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const { svc } = svcWith(p);
    await expect(svc.claim('u1', 0, 'free')).rejects.toMatchObject({ message: 'Đã nhận rồi.' });
    expect(p.gameProfile.update).not.toHaveBeenCalled();
    expect(p.gameProfile.upsert).not.toHaveBeenCalled();
  });
});

describe('SeasonPassService.claim: song song (bấm đúp / hai thiết bị cùng lúc)', () => {
  const tick = () => new Promise<void>((r) => setImmediate(r));
  const PARALLEL_TIERS = [
    { xp: 10, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'POINTS', amount: 5 } },
    { xp: 20, free: { type: 'SEEDS', amount: 30 }, premium: { type: 'POINTS', amount: 8 } },
  ];

  /**
   * Dòng user_season_passes giả. updateMany áp đúng `where` (userId, seasonId, NOT {mảng has tier}) rồi push
   * KHÔNG có await giữa kiểm và ghi — tương đương Postgres khoá dòng và đánh giá lại WHERE sau khi tx trước commit.
   * Mọi phép đọc khác cho nhường lượt (tick) để các lời gọi chen nhau như request thật.
   */
  function makeWorld() {
    const pass = { userId: 'u1', seasonId: 's1', xp: 100, claimedFree: [] as number[], claimedPremium: [] as number[] };
    const profile = { totalSeeds: 0, upserts: 0 };
    const db: any = {
      season: { findFirst: async () => { await tick(); return { id: 's1', name: 'Mùa Hè Xanh' }; } },
      user: { findUnique: async () => { await tick(); return { zaloId: 'zalo-u1', phone: null }; } },
      subscription: { findMany: async () => { await tick(); return [{ id: 'sub1' }]; } },
      order: { count: async () => { await tick(); return 1; } },
      userSeasonPass: {
        findUnique: async () => { await tick(); return { ...pass, claimedFree: [...pass.claimedFree], claimedPremium: [...pass.claimedPremium] }; },
        updateMany: async ({ where, data }: any) => {
          await tick();
          const field = 'claimedFree' in data ? 'claimedFree' : 'claimedPremium';
          if (where.userId !== pass.userId || where.seasonId !== pass.seasonId) return { count: 0 };
          if (where.NOT && (pass[field] as number[]).includes(where.NOT[field].has)) return { count: 0 };
          (pass[field] as number[]).push(data[field].push);
          return { count: 1 };
        },
      },
      gameProfile: {
        upsert: async ({ update }: any) => {
          await tick();
          profile.upserts += 1;
          profile.totalSeeds += update.totalSeeds.increment;
          return { totalSeeds: profile.totalSeeds };
        },
      },
      $executeRaw: async () => 1,
    };
    db.$transaction = async (fn: (t: unknown) => unknown) => fn(db);
    const grants: Array<{ points: number; reason: string }> = [];
    const rewards = {
      grant: jest.fn(async (_u: string, points: number, reason: string) => { grants.push({ points, reason }); return true; }),
      expiresAt: jest.fn().mockResolvedValue(EXPIRES),
    };
    const svc = new SeasonPassService(db as PrismaService, makeConfig({ 'seasonpass.tiers': PARALLEL_TIERS, 'game.tank_capacity': 500 }), rewards as unknown as RewardPointsService);
    return { svc, pass, profile, grants };
  }

  const settle = (ps: Promise<unknown>[]) => Promise.allSettled(ps);
  const wins = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === 'fulfilled');
  const losses = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

  it('FREE (SEEDS) 6 lời gọi song song cùng bậc: đúng 1 lần cộng nước, 5 lần "Đã nhận rồi."', async () => {
    const { svc, pass, profile } = makeWorld();
    const rs = await settle(Array.from({ length: 6 }, () => svc.claim('u1', 0, 'free')));
    expect(wins(rs)).toHaveLength(1);
    const lost = losses(rs);
    expect(lost).toHaveLength(5);
    for (const l of lost) {
      expect(l.reason).toBeInstanceOf(BadRequestException);
      expect(l.reason.message).toBe('Đã nhận rồi.');
    }
    expect(pass.claimedFree).toEqual([0]);
    expect(profile.upserts).toBe(1);
    expect(profile.totalSeeds).toBe(20);
  });

  it('PREMIUM (POINTS) 5 lời gọi song song cùng bậc: Điểm Xanh cấp đúng 1 lần', async () => {
    const { svc, pass, grants } = makeWorld();
    const rs = await settle(Array.from({ length: 5 }, () => svc.claim('u1', 0, 'premium')));
    expect(wins(rs)).toHaveLength(1);
    expect(losses(rs)).toHaveLength(4);
    expect(pass.claimedPremium).toEqual([0]);
    expect(grants).toEqual([{ points: 5, reason: 'SEASONPASS:s1:0:premium' }]);
  });

  it('bậc khác nhau / nhánh khác nhau song song không chặn nhầm nhau: mỗi (bậc, nhánh) nhận đúng một lần', async () => {
    const { svc, pass, profile, grants } = makeWorld();
    const calls: Array<[number, 'free' | 'premium']> = [[0, 'free'], [0, 'free'], [1, 'free'], [1, 'free'], [0, 'premium'], [0, 'premium'], [1, 'premium'], [1, 'premium']];
    const rs = await settle(calls.map(([t, k]) => svc.claim('u1', t, k)));
    expect(wins(rs)).toHaveLength(4);
    expect(losses(rs)).toHaveLength(4);
    expect([...pass.claimedFree].sort()).toEqual([0, 1]);
    expect([...pass.claimedPremium].sort()).toEqual([0, 1]);
    expect(profile.totalSeeds).toBe(20 + 30);
    expect(grants.map((g) => g.reason).sort()).toEqual(['SEASONPASS:s1:0:premium', 'SEASONPASS:s1:1:premium']);
  });

  it('bấm lại tuần tự sau lượt song song: vẫn "Đã nhận rồi.", không cộng thêm', async () => {
    const { svc, profile } = makeWorld();
    await settle(Array.from({ length: 3 }, () => svc.claim('u1', 1, 'free')));
    await expect(svc.claim('u1', 1, 'free')).rejects.toMatchObject({ message: 'Đã nhận rồi.' });
    expect(profile.totalSeeds).toBe(30);
  });
});
