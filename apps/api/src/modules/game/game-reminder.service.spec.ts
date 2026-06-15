import { GameReminderService } from './game-reminder.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T,
} as unknown as SystemConfigService;

function setup(profiles: unknown[]) {
  const findMany = jest.fn().mockResolvedValue(profiles);
  const prisma = { gameProfile: { findMany } } as unknown as PrismaService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const notifications = { notify } as unknown as NotificationsService;
  return { svc: new GameReminderService(prisma, config, notifications), findMany, notify };
}

describe('GameReminderService.sendCheckInReminders', () => {
  it('user có chuỗi đang chạy → nhắc giữ chuỗi (kèm số ngày + vé giữ lửa)', async () => {
    const { svc, notify } = setup([{ userId: 'u1', streakDays: 6, streakFreezes: 1 }]);
    const sent = await svc.sendCheckInReminders();
    expect(sent).toBe(1);
    expect(notify).toHaveBeenCalledWith('u1', 'GAME_CHECKIN_REMINDER', { streak: '6', freezes: '1' });
  });

  it('không ai đủ điều kiện → không nhắc', async () => {
    const { svc, notify } = setup([]);
    expect(await svc.sendCheckInReminders()).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('lọc đúng: có chuỗi ≥1, điểm danh hôm qua nhưng chưa điểm danh hôm nay', async () => {
    const { svc, findMany } = setup([]);
    await svc.sendCheckInReminders();
    const where = findMany.mock.calls[0][0].where;
    expect(where.streakDays).toEqual({ gte: 1 });
    expect(where.lastCheckInAt.gte).toBeInstanceOf(Date);
    expect(where.lastCheckInAt.lt).toBeInstanceOf(Date);
    // cửa sổ "hôm qua": gte (đầu hôm qua) < lt (đầu hôm nay)
    expect(where.lastCheckInAt.gte.getTime()).toBeLessThan(where.lastCheckInAt.lt.getTime());
  });

  it('lỗi gửi 1 user không chặn cả lô', async () => {
    const { svc, notify } = setup([
      { userId: 'u1', streakDays: 3, streakFreezes: 0 },
      { userId: 'u2', streakDays: 5, streakFreezes: 0 },
    ]);
    (notify as jest.Mock).mockRejectedValueOnce(new Error('zns down'));
    const sent = await svc.sendCheckInReminders();
    expect(sent).toBe(2);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe('GameReminderService.sendThirstyTreeReminders', () => {
  it('cây sắp héo (chưa tưới lâu) nhưng chưa chết → nhắc tưới', async () => {
    const { svc, notify } = setup([{ userId: 'u2', lastWateredAt: new Date() }]);
    const sent = await svc.sendThirstyTreeReminders();
    expect(sent).toBe(1);
    expect(notify).toHaveBeenCalledWith('u2', 'GAME_TREE_THIRSTY', {});
  });

  it('lọc cửa sổ héo (đã từng tưới; quá wilt-1 ngày nhưng chưa quá death)', async () => {
    const { svc, findMany } = setup([]);
    await svc.sendThirstyTreeReminders();
    const where = findMany.mock.calls[0][0].where;
    expect(where.lastWateredAt.lte).toBeInstanceOf(Date);
    expect(where.lastWateredAt.gt).toBeInstanceOf(Date);
    // lte (mốc cảnh báo, gần hơn) phải mới hơn gt (mốc chết, xa hơn)
    expect(where.lastWateredAt.lte.getTime()).toBeGreaterThan(where.lastWateredAt.gt.getTime());
  });
});

describe('GameReminderService.sendDailyReminders (cron)', () => {
  it('gọi cả hai loại nhắc trong 1 lần chạy', async () => {
    const { svc, findMany } = setup([]);
    await svc.sendDailyReminders();
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
