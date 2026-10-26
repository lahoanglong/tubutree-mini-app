import { BadRequestException } from '@nestjs/common';
import { DailyCheckInService } from './daily-check-in.service';

const POINTS_RESULT = { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: 'ok' };
const WATER_RESULT = { seedsEarned: 15, pointsEarned: 0, streakDays: 1, totalSeeds: 15, streakFrozeUsed: false, bonusNote: '' };

function build(opts: { pointsDone?: boolean; waterDone?: boolean; gameEnabled?: boolean } = {}) {
  const state = { pointsDone: !!opts.pointsDone, waterDone: !!opts.waterDone };
  const loyalty = {
    getDailyCheckInStatus: jest.fn(async () => ({ checkedInToday: state.pointsDone, streakDays: 0, currentCycleDay: 1, todayPoints: 1000, rewards: [] })),
    dailyCheckIn: jest.fn(async () => {
      state.pointsDone = true;
      return POINTS_RESULT;
    }),
  };
  const economy = {
    checkIn: jest.fn(async () => {
      state.waterDone = true;
      return WATER_RESULT;
    }),
  };
  const prisma = {
    gameProfile: { findUnique: jest.fn(async () => (state.waterDone ? { lastCheckInAt: new Date() } : { lastCheckInAt: new Date(Date.now() - 3 * 864e5) })) },
  };
  const config = { get: jest.fn(async (key: string, def: unknown) => (key === 'game.enabled' && opts.gameEnabled === false ? false : def)) };
  const svc = new DailyCheckInService(prisma as never, config as never, loyalty as never, economy as never);
  return { svc, loyalty, economy, state };
}

describe('DailyCheckInService.run', () => {
  it('chưa điểm danh gì: gọi cả hai và trả kết quả từng phần', async () => {
    const { svc, loyalty, economy } = build();
    const r = await svc.run('u1');
    expect(r).toEqual({ points: POINTS_RESULT, water: WATER_RESULT, alreadyDone: false, pending: [] });
    expect(loyalty.dailyCheckIn).toHaveBeenCalledTimes(1);
    expect(economy.checkIn).toHaveBeenCalledTimes(1);
  });

  it('đã xong Điểm Xanh: chỉ gọi giọt nước', async () => {
    const { svc, loyalty, economy } = build({ pointsDone: true });
    const r = await svc.run('u1');
    expect(r.points).toBeNull();
    expect(r.water).toEqual(WATER_RESULT);
    expect(r.alreadyDone).toBe(false);
    expect(loyalty.dailyCheckIn).not.toHaveBeenCalled();
    expect(economy.checkIn).toHaveBeenCalledTimes(1);
  });

  it('đã xong giọt nước: chỉ gọi Điểm Xanh', async () => {
    const { svc, loyalty, economy } = build({ waterDone: true });
    const r = await svc.run('u1');
    expect(r.points).toEqual(POINTS_RESULT);
    expect(r.water).toBeNull();
    expect(loyalty.dailyCheckIn).toHaveBeenCalledTimes(1);
    expect(economy.checkIn).not.toHaveBeenCalled();
  });

  it('đã xong cả hai: alreadyDone, không lỗi, không gọi bên nào', async () => {
    const { svc, loyalty, economy } = build({ pointsDone: true, waterDone: true });
    const r = await svc.run('u1');
    expect(r).toEqual({ points: null, water: null, alreadyDone: true, pending: [] });
    expect(loyalty.dailyCheckIn).not.toHaveBeenCalled();
    expect(economy.checkIn).not.toHaveBeenCalled();
  });

  it('thua race ở một phần (400 nhưng đọc lại thấy đã xong hôm nay): coi là xong, không lỗi', async () => {
    const { svc, loyalty, state } = build();
    loyalty.dailyCheckIn.mockImplementationOnce(async () => {
      state.pointsDone = true;
      throw new BadRequestException('đã điểm danh');
    });
    const r = await svc.run('u1');
    expect(r.points).toBeNull();
    expect(r.water).toEqual(WATER_RESULT);
    expect(r.pending).toEqual([]);
  });

  it('game tắt (game.enabled=false): chỉ cộng Điểm Xanh, không đụng giọt nước', async () => {
    const { svc, economy } = build({ gameEnabled: false });
    const r = await svc.run('u1');
    expect(r.points).toEqual(POINTS_RESULT);
    expect(r.water).toBeNull();
    expect(r.pending).toEqual([]);
    expect(economy.checkIn).not.toHaveBeenCalled();
  });

  it('một phần lỗi bất ngờ: giữ phần kia, báo phần thiếu ở pending; gọi lại thì bù đúng phần đó', async () => {
    const { svc, economy } = build();
    economy.checkIn.mockRejectedValueOnce(new Error('db down'));
    const first = await svc.run('u1');
    expect(first.points).toEqual(POINTS_RESULT);
    expect(first.water).toBeNull();
    expect(first.pending).toEqual(['water']);
    expect(first.alreadyDone).toBe(false);

    const second = await svc.run('u1');
    expect(second.points).toBeNull();
    expect(second.water).toEqual(WATER_RESULT);
    expect(second.pending).toEqual([]);
  });

  it('cả hai lỗi bất ngờ, chưa cộng được gì: ném lỗi như endpoint cũ', async () => {
    const { svc, loyalty, economy } = build();
    loyalty.dailyCheckIn.mockRejectedValueOnce(new Error('boom'));
    economy.checkIn.mockRejectedValueOnce(new Error('boom2'));
    await expect(svc.run('u1')).rejects.toThrow('boom');
  });

  it('400 không phải "đã xong" (đọc lại vẫn chưa điểm danh) không bị nuốt', async () => {
    const { svc, economy } = build({ pointsDone: true });
    economy.checkIn.mockRejectedValueOnce(new BadRequestException('Điểm danh chưa xong'));
    await expect(svc.run('u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DailyCheckInService.status', () => {
  it('đã điểm danh khi cả hai phần xong; thiếu một phần thì chưa', async () => {
    expect((await build({ pointsDone: true, waterDone: true }).svc.status('u1')).checkedInToday).toBe(true);
    const half = await build({ pointsDone: true }).svc.status('u1');
    expect(half).toMatchObject({ checkedInToday: false, pointsDone: true, waterDone: false, gameEnabled: true, todayWater: 10 });
  });

  it('game tắt: chỉ cần Điểm Xanh', async () => {
    const s = await build({ pointsDone: true, gameEnabled: false }).svc.status('u1');
    expect(s).toMatchObject({ checkedInToday: true, gameEnabled: false, todayWater: 0 });
  });

  it('giữ nguyên dải 7 ngày của Điểm Xanh', async () => {
    const s = await build().svc.status('u1');
    expect(s).toMatchObject({ currentCycleDay: 1, todayPoints: 1000, rewards: [] });
  });
});
