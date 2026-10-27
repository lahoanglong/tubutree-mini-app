import { BadRequestException } from '@nestjs/common';
import { GameEconomyService } from './game-economy.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { SeasonPassService } from './season-pass.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

const DAY = 24 * 3600 * 1000;
/**
 * Mock analytics dùng chung cho các test không assert riêng — checkIn KHÔNG có transaction bao
 * quanh nên chỉ dùng recordBestEffort (Task 9). Wiring THẬT (không @Optional() no-op câm lặng)
 * ở mọi construction để lộ lỗi ngay nếu sau này thêm event mà quên gọi/gọi sai chữ ký.
 */
const analytics = {
  record: jest.fn().mockResolvedValue(undefined),
  recordBestEffort: jest.fn().mockResolvedValue(undefined),
} as unknown as AnalyticsEventsService;
function cfg(over: Record<string, unknown> = {}): SystemConfigService {
  return { get: async <T>(k: string, fb?: T): Promise<T> => (k in over ? (over[k] as T) : (fb as T)) } as unknown as SystemConfigService;
}
/** Stub SeasonPassService — addXp là side-effect, luôn trả promise resolved. */
function sp(): SeasonPassService {
  return { addXp: jest.fn().mockResolvedValue(undefined) } as unknown as SeasonPassService;
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
    // lần đọc đầu (ensure) trả bình 100, lần đọc sau khi ghi trả bình đã cộng
    (p.gameProfile.findUnique as jest.Mock).mockResolvedValueOnce(prof()).mockResolvedValue({ totalSeeds: 110 });
    const svc = new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 10 }), sp(), analytics);
    const r = await svc.checkIn('u1');
    expect(r.streakDays).toBe(2);
    expect(r.seedsEarned).toBe(10);
    expect(r.pointsEarned).toBe(0);
    // không gọi bảng điểm
    expect((p as unknown as Record<string, unknown>).pointsTransaction).toBeUndefined();
  });

  it('chặn điểm danh 2 lần/ngày', async () => {
    const svc = new GameEconomyService(prisma(prof({ lastCheckInAt: new Date() })), cfg(), sp(), analytics);
    await expect(svc.checkIn('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lỡ 1 ngày + có vé giữ lửa → tiêu 1 vé, streak vẫn +1', async () => {
    const p = prisma(prof({ streakDays: 4, streakFreezes: 1, lastCheckInAt: new Date(Date.now() - 2 * DAY) }));
    const svc = new GameEconomyService(p, cfg(), sp(), analytics);
    const r = await svc.checkIn('u1');
    expect(r.streakDays).toBe(5);
    expect(r.streakFrozeUsed).toBe(true);
    const upd = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(upd.streakFreezes).toBe(0);
    expect(upd.lastStreakFreezeAt).toBeInstanceOf(Date);
  });

  it('lỡ 1 ngày + hết vé → reset streak = 1', async () => {
    const p = prisma(prof({ streakDays: 4, streakFreezes: 0, lastCheckInAt: new Date(Date.now() - 2 * DAY) }));
    const r = await new GameEconomyService(p, cfg(), sp(), analytics).checkIn('u1');
    expect(r.streakDays).toBe(1);
    expect(r.streakFrozeUsed).toBe(false);
  });

  it('ghi có điều kiện khớp lần đọc (streakDays/streakFreezes/brokenStreakAt) — thao tác song song không bị ghi đè', async () => {
    const brokenAt = new Date(Date.now() - 3_600_000);
    const p = prisma(prof({ streakDays: 4, streakFreezes: 2, brokenStreakDays: 3, brokenStreakAt: brokenAt }));
    await new GameEconomyService(p, cfg(), sp(), analytics).checkIn('u1');
    const where = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'u1', streakDays: 4, streakFreezes: 2, brokenStreakAt: brokenAt });
  });

  it('ghi hụt vì hồ sơ vừa đổi → đọc lại, tính lại từ hồ sơ mới rồi ghi', async () => {
    const p = prisma(prof({ streakDays: 1 }));
    (p.gameProfile.findUnique as jest.Mock)
      .mockResolvedValueOnce(prof({ streakDays: 1 }))
      .mockResolvedValueOnce(prof({ streakDays: 11 }))
      .mockResolvedValue({ totalSeeds: 130 });
    (p.gameProfile.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });
    const r = await new GameEconomyService(p, cfg(), sp(), analytics).checkIn('u1');
    expect(r.streakDays).toBe(12);
    const calls = (p.gameProfile.updateMany as jest.Mock).mock.calls;
    expect(calls[0]![0].data.streakDays).toBe(2);
    expect(calls[1]![0].where).toMatchObject({ streakDays: 11 });
  });

  it('lỡ NHIỀU ngày + có vé → KHÔNG dùng vé, reset = 1', async () => {
    const p = prisma(prof({ streakDays: 4, streakFreezes: 1, lastCheckInAt: new Date(Date.now() - 5 * DAY) }));
    const r = await new GameEconomyService(p, cfg(), sp(), analytics).checkIn('u1');
    expect(r.streakDays).toBe(1);
    expect(r.streakFrozeUsed).toBe(false);
  });
});

describe('GameEconomyService.checkIn — Task 9 analytics (engagement_action)', () => {
  it('điểm danh thành công → recordBestEffort đúng eventName/action/streakDays (KHÔNG có tx, checkIn không transaction)', async () => {
    const p = prisma(prof({ streakDays: 4, lastCheckInAt: new Date(Date.now() - DAY) }));
    const spy = {
      record: jest.fn().mockResolvedValue(undefined),
      recordBestEffort: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new GameEconomyService(p, cfg(), sp(), spy as unknown as AnalyticsEventsService);
    await svc.checkIn('u1');
    expect(spy.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(spy.recordBestEffort).toHaveBeenCalledWith({
      eventName: 'engagement_action',
      userId: 'u1',
      platform: 'miniapp',
      props: { action: 'garden_checkin', streakDays: 5 },
    });
    // checkIn không có $transaction bao quanh — record(tx,...) không áp dụng ở site này.
    expect(spy.record).not.toHaveBeenCalled();
  });

  it('điểm danh thất bại (đã điểm danh hôm nay) → KHÔNG phát sự kiện', async () => {
    const p = prisma(prof({ lastCheckInAt: new Date() }));
    const spy = {
      record: jest.fn().mockResolvedValue(undefined),
      recordBestEffort: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new GameEconomyService(p, cfg(), sp(), spy as unknown as AnalyticsEventsService);
    await expect(svc.checkIn('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(spy.recordBestEffort).not.toHaveBeenCalled();
  });
});

describe('GameEconomyService.checkIn — hook Season Pass', () => {
  it('điểm danh thành công → gọi seasonPass.addXp với xp cấu hình', async () => {
    const p = prisma(prof());
    const pass = sp();
    await new GameEconomyService(p, cfg({ 'seasonpass.checkin_xp': 25 }), pass, analytics).checkIn('u1');
    expect(pass.addXp as unknown as jest.Mock).toHaveBeenCalledWith('u1', 25);
  });

  it('mặc định 10 XP khi chưa cấu hình', async () => {
    const p = prisma(prof());
    const pass = sp();
    await new GameEconomyService(p, cfg(), pass, analytics).checkIn('u1');
    expect(pass.addXp as unknown as jest.Mock).toHaveBeenCalledWith('u1', 10);
  });

  it('điểm danh thất bại (đã điểm danh hôm nay) → KHÔNG gọi addXp', async () => {
    const p = prisma(prof({ lastCheckInAt: new Date() }));
    const pass = sp();
    await expect(new GameEconomyService(p, cfg(), pass, analytics).checkIn('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(pass.addXp as unknown as jest.Mock).not.toHaveBeenCalled();
  });
});

describe('GameEconomyService.checkIn — ghi nhận chuỗi đã mất (streak repair)', () => {
  it('reset streak (streakDays>1 trước đó) → ghi brokenStreakDays + brokenStreakAt', async () => {
    const p = prisma(prof({ streakDays: 5, streakFreezes: 0, lastCheckInAt: new Date(Date.now() - 5 * DAY) }));
    await new GameEconomyService(p, cfg(), sp(), analytics).checkIn('u1');
    const upd = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(upd.brokenStreakDays).toBe(5);
    expect(upd.brokenStreakAt).toBeInstanceOf(Date);
  });

  it('reset khi streakDays trước đó = 1 (chưa từng có chuỗi thật) → KHÔNG ghi broken streak', async () => {
    const p = prisma(prof({ streakDays: 1, streakFreezes: 0, lastCheckInAt: new Date(Date.now() - 5 * DAY) }));
    await new GameEconomyService(p, cfg(), sp(), analytics).checkIn('u1');
    const upd = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(upd.brokenStreakDays).toBe(0);
    expect(upd.brokenStreakAt).toBeNull();
  });

  it('chuỗi tiếp tục (gapDays=1) → xoá broken streak cũ nếu có', async () => {
    const p = prisma(prof({
      streakDays: 3, streakFreezes: 0, lastCheckInAt: new Date(Date.now() - DAY),
      brokenStreakDays: 7, brokenStreakAt: new Date(),
    }));
    await new GameEconomyService(p, cfg(), sp(), analytics).checkIn('u1');
    const upd = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(upd.brokenStreakDays).toBe(0);
    expect(upd.brokenStreakAt).toBeNull();
  });

  it('lỡ 1 ngày + có vé giữ lửa (cứu chuỗi) → xoá broken streak cũ nếu có', async () => {
    const p = prisma(prof({
      streakDays: 3, streakFreezes: 1, lastCheckInAt: new Date(Date.now() - 2 * DAY),
      brokenStreakDays: 7, brokenStreakAt: new Date(),
    }));
    await new GameEconomyService(p, cfg(), sp(), analytics).checkIn('u1');
    const upd = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(upd.brokenStreakDays).toBe(0);
    expect(upd.brokenStreakAt).toBeNull();
  });
});

describe('GameEconomyService.repairStreak', () => {
  it('không có chuỗi đã mất → BadRequest', async () => {
    const p = prisma(prof({ brokenStreakDays: 0, brokenStreakAt: null }));
    await expect(new GameEconomyService(p, cfg(), sp(), analytics).repairStreak('u1'))
      .rejects.toMatchObject({ message: 'Không có chuỗi nào để hồi sinh.' });
  });

  it('quá cửa sổ hồi sinh (48h) → BadRequest', async () => {
    const p = prisma(prof({
      brokenStreakDays: 5, brokenStreakAt: new Date(Date.now() - 49 * 3600 * 1000),
    }));
    await expect(new GameEconomyService(p, cfg({ 'game.streak_repair_window_hours': 48 }), sp(), analytics).repairStreak('u1'))
      .rejects.toMatchObject({ message: 'Đã quá hạn hồi sinh chuỗi 🔥' });
  });

  it('còn trong cooldown 30 ngày kể từ lần hồi sinh trước → BadRequest', async () => {
    const p = prisma(prof({
      brokenStreakDays: 5, brokenStreakAt: new Date(Date.now() - DAY),
      lastStreakRepairAt: new Date(Date.now() - 10 * DAY),
    }));
    await expect(new GameEconomyService(p, cfg({ 'game.streak_repair_cooldown_days': 30 }), sp(), analytics).repairStreak('u1'))
      .rejects.toMatchObject({ message: 'Bạn đã hồi sinh chuỗi gần đây, hãy thử lại sau 🌿' });
  });

  it('không đủ 💧 (updateMany count=0) → BadRequest kèm giá tiền', async () => {
    const p = prisma(prof({ brokenStreakDays: 5, brokenStreakAt: new Date(Date.now() - DAY), totalSeeds: 10 }));
    (p.gameProfile.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(new GameEconomyService(p, cfg({ 'game.streak_repair_cost': 150 }), sp(), analytics).repairStreak('u1'))
      .rejects.toMatchObject({ message: 'Cần 150 💧 để hồi sinh chuỗi.' });
  });

  it('thành công → hồi sinh streakDays = brokenStreakDays+1, trừ 💧, xoá broken, set lastStreakRepairAt', async () => {
    const brokenAt = new Date(Date.now() - DAY);
    const p = prisma(prof({ brokenStreakDays: 5, brokenStreakAt: brokenAt, totalSeeds: 200, longestStreak: 5 }));
    (p.gameProfile.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (p.gameProfile.findUnique as jest.Mock)
      .mockResolvedValueOnce(prof({ brokenStreakDays: 5, brokenStreakAt: brokenAt, totalSeeds: 200, longestStreak: 5 })) // ensure()
      .mockResolvedValueOnce({ ...prof(), streakDays: 6, totalSeeds: 50, brokenStreakDays: 0, brokenStreakAt: null }); // post-update
    const r = await new GameEconomyService(p, cfg({ 'game.streak_repair_cost': 150 }), sp(), analytics).repairStreak('u1');
    expect(r).toEqual({ repaired: true, streakDays: 6, totalSeeds: 50 });
    const call = (p.gameProfile.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toMatchObject({ userId: 'u1', totalSeeds: { gte: 150 }, streakDays: 1, brokenStreakDays: 5, brokenStreakAt: brokenAt });
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
    (p.gameProfile.findUnique as jest.Mock).mockResolvedValueOnce(prof({ lastDewAt: null })).mockResolvedValue({ totalSeeds: 115 });
    const r = await new GameEconomyService(p, cfg({ 'game.dew_seeds': 15 }), sp(), analytics).collectDew('u1');
    expect(r.seedsEarned).toBe(15);
    expect(r.totalSeeds).toBe(115);
  });
  it('lần 2 trong ngày → BadRequest', async () => {
    const p = prisma(prof({ lastDewAt: new Date() }));
    await expect(new GameEconomyService(p, cfg(), sp(), analytics).collectDew('u1')).rejects.toBeInstanceOf(BadRequestException);
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
    const r = await new GameEconomyService(p, cfg({ 'game.streak_freeze_cost': 80 }), sp(), analytics).buyStreakFreeze('u1');
    expect(r.streakFreezes).toBeGreaterThanOrEqual(1);
  });
  it('không đủ 💧 → BadRequest', async () => {
    const p = prisma(prof({ totalSeeds: 10 }));
    (p.gameProfile.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(new GameEconomyService(p, cfg({ 'game.streak_freeze_cost': 80 }), sp(), analytics).buyStreakFreeze('u1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * DB giả có ngữ nghĩa thật của các điều kiện ghi mà checkIn dựa vào (lastCheckInAt null hoặc trước hôm nay, streakDays,
 * streakFreezes, brokenStreakAt, totalSeeds > cap) và của increment, để kiểm nhịp người mới mà không cần Postgres.
 * Race thật chạy ở race suite (game-first-checkin.race.spec.ts).
 */
function fakeDb(initial: Record<string, unknown>) {
  const state: Record<string, unknown> = { ...initial };
  const gameProfile = {
    findUnique: jest.fn(async () => ({ ...state })),
    create: jest.fn(async () => ({ ...state })),
    updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const last = state.lastCheckInAt as Date | null;
      const or = where.OR as { lastCheckInAt: null | { lt: Date } }[] | undefined;
      if (or && !or.some((c) => (c.lastCheckInAt === null ? last === null : last !== null && last < c.lastCheckInAt!.lt))) {
        return { count: 0 };
      }
      for (const k of ['streakDays', 'streakFreezes'] as const) if (k in where && where[k] !== state[k]) return { count: 0 };
      const gt = (where.totalSeeds as { gt?: number } | undefined)?.gt;
      if (gt !== undefined) {
        if ((state.totalSeeds as number) <= gt) return { count: 0 };
        state.totalSeeds = data.totalSeeds;
        return { count: 1 };
      }
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && 'increment' in (v as object)) state[k] = (state[k] as number) + (v as { increment: number }).increment;
        else state[k] = v;
      }
      return { count: 1 };
    }),
  };
  return { prisma: { gameProfile } as unknown as PrismaService, state };
}

describe('GameEconomyService.checkIn — nhịp người mới', () => {
  const never = (over: Record<string, unknown> = {}) =>
    prof({ lastCheckInAt: null, streakDays: 0, longestStreak: 0, totalSeeds: 0, ...over });

  it('lần điểm danh đầu: 15 + quà lần đầu 50 = 65 giọt, có ghi chú', async () => {
    const { prisma: p, state } = fakeDb(never());
    const r = await new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 15, 'game.first_checkin_bonus': 50 }), sp(), analytics).checkIn('u1');
    expect(r.seedsEarned).toBe(65);
    expect(r.totalSeeds).toBe(65);
    expect(r.bonusNote).toContain('+50');
    expect(state.totalSeeds).toBe(65);
  });

  it('quà lần đầu theo mặc định mã là 50 khi thiếu khoá', async () => {
    const { prisma: p } = fakeDb(never());
    const r = await new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 15 }), sp(), analytics).checkIn('u1');
    expect(r.seedsEarned).toBe(65);
  });

  it('lần sau (đã từng điểm danh, hôm qua) KHÔNG có quà lần đầu', async () => {
    const { prisma: p } = fakeDb(prof({ totalSeeds: 0 }));
    const r = await new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 15 }), sp(), analytics).checkIn('u1');
    expect(r.seedsEarned).toBe(15);
    expect(r.bonusNote).toBe('');
  });

  it('quà lần đầu = 0 trong config → không cộng, không ghi chú', async () => {
    const { prisma: p } = fakeDb(never());
    const r = await new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 15, 'game.first_checkin_bonus': 0 }), sp(), analytics).checkIn('u1');
    expect(r.seedsEarned).toBe(15);
    expect(r.bonusNote).toBe('');
  });

  it('hai request điểm danh lần đầu cùng lúc → đúng một lần thắng, quà cộng một lần', async () => {
    const { prisma: p, state } = fakeDb(never());
    const svc = new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 15, 'game.first_checkin_bonus': 50 }), sp(), analytics);
    const results = await Promise.allSettled([svc.checkIn('u1'), svc.checkIn('u1')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(BadRequestException);
    expect(state.totalSeeds).toBe(65);
  });

  it.each([
    [7, true],
    [8, true],
    [6, false],
    [2, false],
  ])('vắng %i ngày → quà quay lại có = %s (ngưỡng 7)', async (gap, expectBonus) => {
    const { prisma: p } = fakeDb(prof({ totalSeeds: 0, streakDays: 3, lastCheckInAt: new Date(Date.now() - gap * DAY) }));
    const r = await new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 15 }), sp(), analytics).checkIn('u1');
    expect(r.seedsEarned).toBe(expectBonus ? 75 : 15);
    expect(r.bonusNote.includes('quay lại')).toBe(expectBonus);
    expect(r.streakDays).toBe(1); // vắng nhiều ngày vẫn reset chuỗi, quà không phụ thuộc chuỗi
  });

  it('quà quay lại theo config (gap 10, 100 giọt): vắng 9 ngày không có, vắng 10 ngày có', async () => {
    const conf = { 'game.daily_login_seeds': 15, 'game.comeback_gap_days': 10, 'game.comeback_seeds': 100 };
    const a = fakeDb(prof({ totalSeeds: 0, lastCheckInAt: new Date(Date.now() - 9 * DAY) }));
    expect((await new GameEconomyService(a.prisma, cfg(conf), sp(), analytics).checkIn('u1')).seedsEarned).toBe(15);
    const b = fakeDb(prof({ totalSeeds: 0, lastCheckInAt: new Date(Date.now() - 10 * DAY) }));
    expect((await new GameEconomyService(b.prisma, cfg(conf), sp(), analytics).checkIn('u1')).seedsEarned).toBe(115);
  });

  it('ngày thứ 7 của chuỗi lấy thưởng từ game.streak_7_bonus ({ seeds: 30 }), không phải số cứng', async () => {
    const { prisma: p } = fakeDb(prof({ totalSeeds: 0, streakDays: 6 }));
    const r = await new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 15, 'game.streak_7_bonus': { seeds: 30 } }), sp(), analytics).checkIn('u1');
    expect(r.streakDays).toBe(7);
    expect(r.seedsEarned).toBe(45);
    expect(r.bonusNote).toContain('+30');
  });

  it('seedsEarned là số thật vào bình: bình 1000 đang 990, +15 → trả 10 chứ không phải 15', async () => {
    const { prisma: p, state } = fakeDb(prof({ totalSeeds: 990 }));
    const r = await new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 15, 'game.tank_capacity': 1000 }), sp(), analytics).checkIn('u1');
    expect(state.totalSeeds).toBe(1000);
    expect(r.totalSeeds).toBe(1000);
    expect(r.seedsEarned).toBe(10);
  });

  it('bình đầy đúng ngày mốc chuỗi 3: không trả ghi chú thưởng, 0 giọt', async () => {
    const { prisma: p } = fakeDb(prof({ totalSeeds: 1000, streakDays: 2 }));
    const r = await new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 15, 'game.tank_capacity': 1000 }), sp(), analytics).checkIn('u1');
    expect(r.streakDays).toBe(3);
    expect(r.seedsEarned).toBe(0);
    expect(r.bonusNote).toBe('');
  });

  it('bình cắt một phần thưởng mốc: không khoe cả thưởng', async () => {
    const { prisma: p } = fakeDb(prof({ totalSeeds: 990, streakDays: 2 }));
    const r = await new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 15, 'game.tank_capacity': 1000 }), sp(), analytics).checkIn('u1');
    expect(r.seedsEarned).toBe(10);
    expect(r.bonusNote).toBe('');
  });

  it('bình còn chỗ cho cả thưởng mốc: vẫn có ghi chú', async () => {
    const { prisma: p } = fakeDb(prof({ totalSeeds: 0, streakDays: 2 }));
    const r = await new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 15, 'game.tank_capacity': 1000 }), sp(), analytics).checkIn('u1');
    expect(r.seedsEarned).toBe(20);
    expect(r.bonusNote).toContain('chuỗi 3 ngày');
  });

  it('bình đã đầy → seedsEarned = 0, không âm', async () => {
    const { prisma: p } = fakeDb(prof({ totalSeeds: 1000 }));
    const r = await new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 15, 'game.tank_capacity': 1000 }), sp(), analytics).checkIn('u1');
    expect(r.seedsEarned).toBe(0);
  });
});

describe('GameEconomyService.collectDew — số nước thật', () => {
  it('bình 500 đang 495, sương 15 → trả 5', async () => {
    const { prisma: p, state } = fakeDb(prof({ totalSeeds: 495, lastDewAt: null }));
    // fakeDb.updateMany xử lý lastDewAt như điểm danh: thêm điều kiện riêng cho dew
    (p.gameProfile.updateMany as jest.Mock).mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const gt = (where.totalSeeds as { gt?: number } | undefined)?.gt;
      if (gt !== undefined) {
        if ((state.totalSeeds as number) <= gt) return { count: 0 };
        state.totalSeeds = data.totalSeeds;
        return { count: 1 };
      }
      state.totalSeeds = (state.totalSeeds as number) + (data.totalSeeds as { increment: number }).increment;
      return { count: 1 };
    });
    const r = await new GameEconomyService(p, cfg({ 'game.dew_seeds': 15, 'game.tank_capacity': 500 }), sp(), analytics).collectDew('u1');
    expect(r.totalSeeds).toBe(500);
    expect(r.seedsEarned).toBe(5);
  });
});
