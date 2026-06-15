import { BadRequestException } from '@nestjs/common';
import { GameGiftService } from './game-gift.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T,
} as unknown as SystemConfigService;

function setup(opts: {
  me?: Record<string, unknown> | null;
  referees?: unknown[];
  giftCreate?: () => unknown;
  decCount?: number;
  recipient?: Record<string, unknown> | null;
} = {}) {
  const user = {
    findUnique: jest.fn().mockResolvedValue(opts.me ?? { referredById: 'r0' }),
    findMany: jest.fn().mockResolvedValue(opts.referees ?? [{ id: 'friend1', fullName: 'Trần Bình' }]),
  };
  const waterGift = {
    create: jest.fn().mockImplementation(async () => (opts.giftCreate ? opts.giftCreate() : {})),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const gameProfile = {
    updateMany: jest.fn().mockResolvedValue({ count: opts.decCount ?? 1 }),
    findUnique: jest.fn().mockResolvedValue(opts.recipient ?? { totalSeeds: 50 }),
    upsert: jest.fn().mockResolvedValue({}),
  };
  const prisma = { user, waterGift, gameProfile } as unknown as PrismaService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const notifications = { notify } as unknown as NotificationsService;
  return { svc: new GameGiftService(prisma, config, notifications), user, waterGift, gameProfile, notify };
}

describe('GameGiftService.giftWater', () => {
  it('tự tặng cho mình → BadRequest', async () => {
    const { svc } = setup();
    await expect(svc.giftWater('u1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('người nhận không phải bạn bè → BadRequest', async () => {
    const { svc } = setup({ me: { referredById: null }, referees: [] });
    await expect(svc.giftWater('u1', 'stranger')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bạn bè + đủ 💧 → tạo gift, trừ tank người gửi, cộng tank người nhận', async () => {
    const { svc, waterGift, gameProfile, notify } = setup();
    const r = await svc.giftWater('u1', 'friend1');
    expect(r).toEqual({ amount: 10, recipientId: 'friend1' });
    expect(waterGift.create).toHaveBeenCalled();
    expect(gameProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', totalSeeds: { gte: 10 } } }),
    );
    const upsertArg = gameProfile.upsert.mock.calls[0][0];
    expect(upsertArg.update.totalSeeds).toBe(60); // 50 + 10
    expect(notify).toHaveBeenCalledWith('friend1', 'GAME_WATER_GIFT', expect.any(Object));
  });

  it('người nhận là người đã mời mình (referrer) → cũng hợp lệ', async () => {
    const { svc } = setup({ me: { referredById: 'r0' }, referees: [] });
    const r = await svc.giftWater('u1', 'r0');
    expect(r.recipientId).toBe('r0');
  });

  it('đã tặng hôm nay (unique vi phạm) → BadRequest', async () => {
    const { svc } = setup({
      giftCreate: () => {
        throw new Error('Unique constraint failed');
      },
    });
    await expect(svc.giftWater('u1', 'friend1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('không đủ 💧 → rollback gift + BadRequest', async () => {
    const { svc, waterGift } = setup({ decCount: 0 });
    await expect(svc.giftWater('u1', 'friend1')).rejects.toBeInstanceOf(BadRequestException);
    expect(waterGift.deleteMany).toHaveBeenCalled(); // đã rollback bản ghi gift
  });

  it('cộng tank người nhận có cap tank_capacity', async () => {
    const { svc, gameProfile } = setup({ recipient: { totalSeeds: 495 } });
    await svc.giftWater('u1', 'friend1');
    expect(gameProfile.upsert.mock.calls[0][0].update.totalSeeds).toBe(500); // min(500, 505)
  });
});

describe('GameGiftService.getFriends', () => {
  it('liệt kê bạn bè (mời + được mời) + cờ đã tặng hôm nay', async () => {
    const { svc, waterGift } = setup({
      me: { referredById: 'r0' },
      referees: [{ id: 'friend1', fullName: 'Trần Bình' }],
    });
    (waterGift.findMany as jest.Mock).mockResolvedValue([{ recipientId: 'friend1' }]);
    const friends = await svc.getFriends('u1');
    const f1 = friends.find((f) => f.id === 'friend1')!;
    expect(f1.nickname).toBe('Bình***');
    expect(f1.giftedToday).toBe(true);
  });
});
