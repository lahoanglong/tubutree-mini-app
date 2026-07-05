import { BadRequestException } from '@nestjs/common';
import { GameEconomyService } from './game-economy.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const DAY = 24 * 3600 * 1000;
function cfg(over: Record<string, unknown> = {}): SystemConfigService {
  return { get: async <T>(k: string, fb?: T): Promise<T> => (k in over ? (over[k] as T) : (fb as T)) } as unknown as SystemConfigService;
}
function prisma(profile: Record<string, unknown> | null, over: Record<string, unknown> = {}) {
  const base = {
    gameProfile: {
      findUnique: jest.fn().mockResolvedValue(profile),
      create: jest.fn().mockResolvedValue(profile),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { ...base, ...over } as unknown as PrismaService;
}
function prof(extra: Record<string, unknown> = {}) {
  return { userId: 'u1', totalSeeds: 100, streakDays: 1, longestStreak: 5, streakFreezes: 0,
    lastCheckInAt: new Date(Date.now() - DAY), lastDewAt: null, ecoImpact: {},
    brokenStreakDays: 0, brokenStreakAt: null, lastStreakRepairAt: null, ...extra };
}

describe('GameEconomyService.checkIn', () => {
  it('chuỗi liên tiếp +1 và thưởng 💧, KHÔNG cộng điểm Xanh', async () => {
    const p = prisma(prof());
    const svc = new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 10 }));
    const r = await svc.checkIn('u1');
    expect(r.streakDays).toBe(2);
    expect(r.seedsEarned).toBe(10);
    expect(r.pointsEarned).toBe(0);
    // không gọi bảng điểm
    expect((p as unknown as Record<string, unknown>).pointsTransaction).toBeUndefined();
  });

  it('chặn điểm danh 2 lần/ngày', async () => {
    const svc = new GameEconomyService(prisma(prof({ lastCheckInAt: new Date() })), cfg());
    await expect(svc.checkIn('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lỡ 1 ngày + có vé giữ lửa → tiêu 1 vé, streak vẫn +1', async () => {
    const p = prisma(prof({ streakDays: 4, streakFreezes: 1, lastCheckInAt: new Date(Date.now() - 2 * DAY) }));
    const svc = new GameEconomyService(p, cfg());
    const r = await svc.checkIn('u1');
    expect(r.streakDays).toBe(5);
    expect(r.streakFrozeUsed).toBe(true);
    const upd = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(upd.streakFreezes).toBe(0);
  });

  it('lỡ 1 ngày + hết vé → reset streak = 1', async () => {
    const p = prisma(prof({ streakDays: 4, streakFreezes: 0, lastCheckInAt: new Date(Date.now() - 2 * DAY) }));
    const r = await new GameEconomyService(p, cfg()).checkIn('u1');
    expect(r.streakDays).toBe(1);
    expect(r.streakFrozeUsed).toBe(false);
  });

  it('lỡ NHIỀU ngày + có vé → KHÔNG dùng vé, reset = 1', async () => {
    const p = prisma(prof({ streakDays: 4, streakFreezes: 1, lastCheckInAt: new Date(Date.now() - 5 * DAY) }));
    const r = await new GameEconomyService(p, cfg()).checkIn('u1');
    expect(r.streakDays).toBe(1);
    expect(r.streakFrozeUsed).toBe(false);
  });
});

describe('GameEconomyService.checkIn — ghi nhận chuỗi đã mất (streak repair)', () => {
  it('reset streak (streakDays>1 trước đó) → ghi brokenStreakDays + brokenStreakAt', async () => {
    const p = prisma(prof({ streakDays: 5, streakFreezes: 0, lastCheckInAt: new Date(Date.now() - 5 * DAY) }));
    await new GameEconomyService(p, cfg()).checkIn('u1');
    const upd = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(upd.brokenStreakDays).toBe(5);
    expect(upd.brokenStreakAt).toBeInstanceOf(Date);
  });

  it('reset khi streakDays trước đó = 1 (chưa từng có chuỗi thật) → KHÔNG ghi broken streak', async () => {
    const p = prisma(prof({ streakDays: 1, streakFreezes: 0, lastCheckInAt: new Date(Date.now() - 5 * DAY) }));
    await new GameEconomyService(p, cfg()).checkIn('u1');
    const upd = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(upd.brokenStreakDays).toBe(0);
    expect(upd.brokenStreakAt).toBeNull();
  });

  it('chuỗi tiếp tục (gapDays=1) → xoá broken streak cũ nếu có', async () => {
    const p = prisma(prof({
      streakDays: 3, streakFreezes: 0, lastCheckInAt: new Date(Date.now() - DAY),
      brokenStreakDays: 7, brokenStreakAt: new Date(),
    }));
    await new GameEconomyService(p, cfg()).checkIn('u1');
    const upd = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(upd.brokenStreakDays).toBe(0);
    expect(upd.brokenStreakAt).toBeNull();
  });

  it('lỡ 1 ngày + có vé giữ lửa (cứu chuỗi) → xoá broken streak cũ nếu có', async () => {
    const p = prisma(prof({
      streakDays: 3, streakFreezes: 1, lastCheckInAt: new Date(Date.now() - 2 * DAY),
      brokenStreakDays: 7, brokenStreakAt: new Date(),
    }));
    await new GameEconomyService(p, cfg()).checkIn('u1');
    const upd = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(upd.brokenStreakDays).toBe(0);
    expect(upd.brokenStreakAt).toBeNull();
  });
});

describe('GameEconomyService.repairStreak', () => {
  it('không có chuỗi đã mất → BadRequest', async () => {
    const p = prisma(prof({ brokenStreakDays: 0, brokenStreakAt: null }));
    await expect(new GameEconomyService(p, cfg()).repairStreak('u1'))
      .rejects.toMatchObject({ message: 'Không có chuỗi nào để hồi sinh.' });
  });

  it('quá cửa sổ hồi sinh (48h) → BadRequest', async () => {
    const p = prisma(prof({
      brokenStreakDays: 5, brokenStreakAt: new Date(Date.now() - 49 * 3600 * 1000),
    }));
    await expect(new GameEconomyService(p, cfg({ 'game.streak_repair_window_hours': 48 })).repairStreak('u1'))
      .rejects.toMatchObject({ message: 'Đã quá hạn hồi sinh chuỗi 🔥' });
  });

  it('còn trong cooldown 30 ngày kể từ lần hồi sinh trước → BadRequest', async () => {
    const p = prisma(prof({
      brokenStreakDays: 5, brokenStreakAt: new Date(Date.now() - DAY),
      lastStreakRepairAt: new Date(Date.now() - 10 * DAY),
    }));
    await expect(new GameEconomyService(p, cfg({ 'game.streak_repair_cooldown_days': 30 })).repairStreak('u1'))
      .rejects.toMatchObject({ message: 'Bạn đã hồi sinh chuỗi gần đây, hãy thử lại sau 🌿' });
  });

  it('không đủ 💧 (updateMany count=0) → BadRequest kèm giá tiền', async () => {
    const p = prisma(prof({ brokenStreakDays: 5, brokenStreakAt: new Date(Date.now() - DAY), totalSeeds: 10 }));
    (p.gameProfile.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(new GameEconomyService(p, cfg({ 'game.streak_repair_cost': 150 })).repairStreak('u1'))
      .rejects.toMatchObject({ message: 'Cần 150 💧 để hồi sinh chuỗi.' });
  });

  it('thành công → hồi sinh streakDays = brokenStreakDays+1, trừ 💧, xoá broken, set lastStreakRepairAt', async () => {
    const brokenAt = new Date(Date.now() - DAY);
    const p = prisma(prof({ brokenStreakDays: 5, brokenStreakAt: brokenAt, totalSeeds: 200, longestStreak: 5 }));
    (p.gameProfile.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (p.gameProfile.findUnique as jest.Mock)
      .mockResolvedValueOnce(prof({ brokenStreakDays: 5, brokenStreakAt: brokenAt, totalSeeds: 200, longestStreak: 5 })) // ensure()
      .mockResolvedValueOnce({ ...prof(), streakDays: 6, totalSeeds: 50, brokenStreakDays: 0, brokenStreakAt: null }); // post-update
    const r = await new GameEconomyService(p, cfg({ 'game.streak_repair_cost': 150 })).repairStreak('u1');
    expect(r).toEqual({ repaired: true, streakDays: 6, totalSeeds: 50 });
    const call = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toMatchObject({ userId: 'u1', totalSeeds: { gte: 150 }, brokenStreakAt: { not: null } });
    expect(call.data).toMatchObject({
      totalSeeds: { decrement: 150 },
      streakDays: 6,
      longestStreak: 6,
      brokenStreakDays: 0,
      brokenStreakAt: null,
    });
    expect(call.data.lastStreakRepairAt).toBeInstanceOf(Date);
  });
});

describe('GameEconomyService.collectDew', () => {
  it('lần đầu trong ngày → +💧 và set lastDewAt', async () => {
    const p = prisma(prof({ lastDewAt: null }));
    const r = await new GameEconomyService(p, cfg({ 'game.dew_seeds': 15 })).collectDew('u1');
    expect(r.seedsEarned).toBe(15);
  });
  it('lần 2 trong ngày → BadRequest', async () => {
    const p = prisma(prof({ lastDewAt: new Date() }));
    await expect(new GameEconomyService(p, cfg()).collectDew('u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GameEconomyService.buyStreakFreeze', () => {
  it('đủ 💧 → trừ atomic, +1 vé', async () => {
    const profile = prof({ totalSeeds: 200 });
    const p = prisma(profile);
    (p.gameProfile.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    // second findUnique (after updateMany) returns updated profile
    (p.gameProfile.findUnique as jest.Mock)
      .mockResolvedValueOnce(profile)   // ensure()
      .mockResolvedValueOnce({ ...profile, streakFreezes: 1, totalSeeds: 120 }); // post-update
    const r = await new GameEconomyService(p, cfg({ 'game.streak_freeze_cost': 80 })).buyStreakFreeze('u1');
    expect(r.streakFreezes).toBeGreaterThanOrEqual(1);
  });
  it('không đủ 💧 → BadRequest', async () => {
    const p = prisma(prof({ totalSeeds: 10 }));
    (p.gameProfile.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(new GameEconomyService(p, cfg({ 'game.streak_freeze_cost': 80 })).buyStreakFreeze('u1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
