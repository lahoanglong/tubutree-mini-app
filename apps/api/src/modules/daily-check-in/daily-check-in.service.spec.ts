import { BadRequestException } from '@nestjs/common';
import { DailyCheckInService } from './daily-check-in.service';

const POINTS_RESULT = { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: 'ok' };
const WATER_RESULT = { seedsEarned: 15, pointsEarned: 0, streakDays: 1, totalSeeds: 15, streakFrozeUsed: false, bonusNote: '' };

function build(opts: { pointsDone?: boolean; waterDone?: boolean; waterCheckThrows?: boolean; totalSeeds?: number; tankCap?: number; neverCheckedIn?: boolean; lastDaysAgo?: number; streakDays?: number; streakFreezes?: number } = {}) {
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
  const profile = (lastCheckInAt: Date | null) => ({ lastCheckInAt, totalSeeds: opts.totalSeeds ?? 0, streakDays: opts.streakDays ?? 0, streakFreezes: opts.streakFreezes ?? 0 });
  const prisma = {
    gameProfile: {
      findUnique: jest.fn(async () => {
        if (opts.waterCheckThrows) return Promise.reject(new Error('db down'));
        if (opts.neverCheckedIn && !state.waterDone) return profile(null);
        if (state.waterDone) return profile(new Date());
        return profile(new Date(Date.now() - (opts.lastDaysAgo ?? 3) * 864e5));
      }),
    },
  };
  const config = { get: jest.fn(async (key: string, def: unknown) => (key === 'game.tank_capacity' && opts.tankCap != null ? opts.tankCap : def)) };
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

  it('lỗi DB khi kiểm phần nước sau khi đã cộng điểm: không thành 500, giữ điểm và báo thiếu nước', async () => {
    const { svc } = build({ waterCheckThrows: true });
    const r = await svc.run('u1');
    expect(r.points).toEqual(POINTS_RESULT);
    expect(r.water).toBeNull();
    expect(r.pending).toEqual(['water']);
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
  });

  it('nửa vời: xong điểm, thiếu nước → chỉ còn hứa giọt nước (todayPoints = 0)', async () => {
    const half = await build({ pointsDone: true }).svc.status('u1');
    expect(half).toMatchObject({ checkedInToday: false, pointsDone: true, waterDone: false, todayPoints: 0, todayWater: 10 });
  });

  it('nửa vời: xong nước, thiếu điểm → chỉ còn hứa Điểm Xanh (todayWater = 0)', async () => {
    const half = await build({ waterDone: true }).svc.status('u1');
    expect(half).toMatchObject({ checkedInToday: false, pointsDone: false, waterDone: true, todayPoints: 1000, todayWater: 0 });
  });

  it('bình gần đầy: todayWater chỉ là phần còn chứa được (min(thưởng ngày, chỗ trống))', async () => {
    const s = await build({ totalSeeds: 495, tankCap: 500 }).svc.status('u1');
    expect(s.todayWater).toBe(5);
  });

  it('bình đã đầy mà phần nước còn thiếu: todayWater = 0, không hứa giọt nước; điểm vẫn hứa', async () => {
    const s = await build({ pointsDone: false, totalSeeds: 500, tankCap: 500 }).svc.status('u1');
    expect(s).toMatchObject({ waterDone: false, todayWater: 0, todayPoints: 1000, tankFull: true });
  });

  it('tankFull theo totalSeeds >= sức chứa, không theo todayWater (thưởng ngày cấu hình 0 thì chưa đầy)', async () => {
    expect((await build({ totalSeeds: 499, tankCap: 500 }).svc.status('u1')).tankFull).toBe(false);
    expect((await build({ totalSeeds: 700, tankCap: 500 }).svc.status('u1')).tankFull).toBe(true);
  });

  it('bình vượt trần (cấu hình hạ thấp): chỗ trống không âm', async () => {
    expect((await build({ totalSeeds: 700, tankCap: 500 }).svc.status('u1')).todayWater).toBe(0);
  });

  it('chưa làm gì: hứa cả hai', async () => {
    expect(await build().svc.status('u1')).toMatchObject({ todayPoints: 1000, todayWater: 10 });
  });

  it('lần đầu: todayWater gồm cả quà điểm danh đầu tiên, khớp số nước thật sẽ cộng', async () => {
    expect(await build({ neverCheckedIn: true }).svc.status('u1')).toMatchObject({ todayWater: 60 });
  });

  it('lần đầu mà bình gần đầy: quà đầu tiên cũng bị cắt theo chỗ trống', async () => {
    expect((await build({ neverCheckedIn: true, totalSeeds: 495, tankCap: 500 }).svc.status('u1')).todayWater).toBe(5);
  });

  it('giữ nguyên dải 7 ngày của Điểm Xanh', async () => {
    const s = await build().svc.status('u1');
    expect(s).toMatchObject({ currentCycleDay: 1, todayPoints: 1000, rewards: [] });
  });

  describe('todayWater cùng một nguồn với số nước thật sẽ cộng (R-10)', () => {
    it('ngày 3 của chuỗi (hôm qua là ngày 2): gồm +5 chuỗi 3 ngày', async () => {
      expect(await build({ lastDaysAgo: 1, streakDays: 2 }).svc.status('u1')).toMatchObject({ todayWater: 15 });
    });

    it('ngày 7 của chuỗi: gồm thưởng chuỗi 7 ngày (mặc định 20)', async () => {
      expect(await build({ lastDaysAgo: 1, streakDays: 6 }).svc.status('u1')).toMatchObject({ todayWater: 30 });
    });

    it('quay lại sau nhiều ngày: gồm quà quay lại, chuỗi về ngày 1', async () => {
      const s = await build({ lastDaysAgo: 10, streakDays: 5 }).svc.status('u1');
      expect(s).toMatchObject({ waterDone: false, todayWater: 70 });
    });

    it('ngày 3 mà bình gần đầy: chỉ phần còn chứa được', async () => {
      expect((await build({ lastDaysAgo: 1, streakDays: 2, totalSeeds: 495, tankCap: 500 }).svc.status('u1')).todayWater).toBe(5);
    });
  });
});
