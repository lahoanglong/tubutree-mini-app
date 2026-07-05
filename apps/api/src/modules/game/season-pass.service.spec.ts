import { BadRequestException } from '@nestjs/common';
import { SeasonPassService } from './season-pass.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const TIERS = [
  { xp: 30, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'XU', amount: 5000 } },
  { xp: 70, free: { type: 'SEEDS', amount: 30 }, premium: { type: 'XU', amount: 8000 } },
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
    },
    subscription: { count: jest.fn().mockResolvedValue(0) },
    gameProfile: {
      findUnique: jest.fn().mockResolvedValue({ userId: 'u1', totalSeeds: 10 }),
      update: jest.fn().mockResolvedValue({}),
    },
    coinTransaction: { create: jest.fn().mockResolvedValue({}) },
    user: { update: jest.fn().mockResolvedValue({}) },
    ...over,
  };
  db.$transaction = jest
    .fn()
    .mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(db) : Promise.all(arg as unknown[]),
    );
  return db as unknown as PrismaService;
}

function svcWith(prisma: PrismaService, cfg = makeConfig({ 'seasonpass.tiers': TIERS })) {
  return { svc: new SeasonPassService(prisma, cfg), prisma };
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
      subscription: { count: jest.fn().mockResolvedValue(1) },
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
    expect(t0.premium).toEqual({ type: 'XU', amount: 5000 });
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
      subscription: { count: jest.fn().mockResolvedValue(0) },
    });
    const { svc } = svcWith(p);
    await expect(svc.claim('u1', 0, 'premium')).rejects.toMatchObject({
      message: 'Cần đăng ký định kỳ để mở Premium.',
    });
  });

  it('thành công FREE (SEEDS) → cộng 💧 có cap + đánh dấu claimedFree', async () => {
    const p = makePrisma({
      userSeasonPass: {
        findUnique: jest.fn().mockResolvedValue({ xp: 100, claimedFree: [], claimedPremium: [] }),
        update: jest.fn().mockResolvedValue({}),
      },
      gameProfile: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'u1', totalSeeds: 490 }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const { svc } = svcWith(p, makeConfig({ 'seasonpass.tiers': TIERS, 'game.tank_capacity': 500 }));
    const r = await svc.claim('u1', 0, 'free');
    expect(r).toEqual({ claimed: true, reward: { type: 'SEEDS', amount: 20 } });
    // 490 + 20 = 510 → cap 500
    expect((p.gameProfile.update as jest.Mock).mock.calls[0][0].data).toEqual({ totalSeeds: 500 });
    const upd = (p.userSeasonPass.update as jest.Mock).mock.calls[0][0];
    expect(upd.data).toEqual({ claimedFree: { push: 0 } });
  });

  it('thành công PREMIUM (XU) → ghi CoinTransaction + cộng coinsBalance TRÊN tx (atomic) + đánh dấu claimedPremium', async () => {
    const p = makePrisma({
      userSeasonPass: {
        findUnique: jest.fn().mockResolvedValue({ xp: 300, claimedFree: [], claimedPremium: [] }),
        update: jest.fn().mockResolvedValue({}),
      },
      subscription: { count: jest.fn().mockResolvedValue(1) },
    });
    const { svc } = svcWith(p, makeConfig({ 'seasonpass.tiers': TIERS }));
    const r = await svc.claim('u1', 0, 'premium');
    expect(r).toEqual({ claimed: true, reward: { type: 'XU', amount: 5000 } });
    // Ghi xu TRỰC TIẾP trên tx (không qua coins.grantCoins mở transaction riêng ở root client).
    const pAny = p as unknown as {
      coinTransaction: { create: jest.Mock };
      user: { update: jest.Mock };
    };
    expect(pAny.coinTransaction.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        delta: 5000,
        reason: 'SEASONPASS:s1:0:premium',
        refType: 'SEASONPASS',
        refId: 's1',
      },
    });
    expect(pAny.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { coinsBalance: { increment: 5000 } },
    });
    expect((p.userSeasonPass.update as jest.Mock).mock.calls[0][0].data).toEqual({ claimedPremium: { push: 0 } });
  });

  it('double-claim race: re-read trong tx đã có bậc → BadRequest, không cấp thưởng', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ xp: 100, claimedFree: [], claimedPremium: [] }) // pre-check ngoài tx
      .mockResolvedValueOnce({ xp: 100, claimedFree: [0], claimedPremium: [] }); // re-read trong tx
    const p = makePrisma({
      userSeasonPass: { findUnique, update: jest.fn().mockResolvedValue({}) },
    });
    const { svc } = svcWith(p);
    await expect(svc.claim('u1', 0, 'free')).rejects.toMatchObject({ message: 'Đã nhận rồi.' });
    expect(p.userSeasonPass.update).not.toHaveBeenCalled();
    expect(p.gameProfile.update).not.toHaveBeenCalled();
  });
});
