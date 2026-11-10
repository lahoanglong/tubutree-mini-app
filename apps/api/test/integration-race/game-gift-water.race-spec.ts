import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { GameGiftService } from '../../src/modules/game/game-gift.service';
import { createUser, setConfig, summarize, warmPool } from './helpers';

/**
 * Tặng nước (`GameGiftService.giftWater`) trên Postgres thật. Bản ghi gift, trừ nước người gửi và cộng nước người nhận nằm trong một
 * transaction; unique `[sender, recipient, dayKey]` chặn tặng đôi; hai dòng `game_profiles` luôn được ghi theo thứ tự userId để A tặng B
 * cùng lúc B tặng A không chờ chéo (deadlock 40P01). `RaceDb` không có phát hiện deadlock nên chỉ Postgres thật chứng minh được phần này.
 */
describe('GameGiftService.giftWater song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let gift: GameGiftService;
  const AMOUNT = 10;
  const ALREADY = 'Hôm nay bạn đã tặng nước cho người này rồi';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, GameGiftService, { provide: NotificationsService, useValue: { notifySafe: jest.fn().mockResolvedValue(undefined) } }],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    gift = moduleRef.get(GameGiftService);
    await setConfig(prisma, 'game.gift_water_amount', AMOUNT);
    await setConfig(prisma, 'game.tank_capacity', 100_000);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function withSeeds(userId: string, seeds: number) {
    await prisma.gameProfile.create({ data: { userId, totalSeeds: seeds } });
  }

  const seedsOf = async (userId: string) => (await prisma.gameProfile.findUniqueOrThrow({ where: { userId } })).totalSeeds;
  const giftRows = (where: { senderId?: string; recipientId?: string }) => prisma.waterGift.count({ where });

  it('8 lượt tặng song song từ cùng người gửi tới cùng người nhận: đúng 1 thành công, 7 báo đã tặng hôm nay, nước chuyển đúng 1 lần', async () => {
    const recipient = await createUser(prisma);
    const sender = await createUser(prisma, { referredById: recipient.id });
    await withSeeds(sender.id, 100);
    await withSeeds(recipient.id, 20);

    const results = await Promise.allSettled(Array.from({ length: 8 }, () => gift.giftWater(sender.id, recipient.id)));
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected).toHaveLength(7);
    for (const e of s.errors) expect(e).toContain(ALREADY);
    expect(await seedsOf(sender.id)).toBe(100 - AMOUNT);
    expect(await seedsOf(recipient.id)).toBe(20 + AMOUNT);
    expect(await giftRows({ senderId: sender.id })).toBe(1);
  });

  it('A tặng B cùng lúc B tặng A, mỗi chiều 5 lượt: không deadlock, mỗi chiều đúng 1 lần, số nước hai bên giữ nguyên (trừ rồi cộng đúng 10)', async () => {
    const b = await createUser(prisma);
    const a = await createUser(prisma, { referredById: b.id });
    await withSeeds(a.id, 100);
    await withSeeds(b.id, 100);

    const calls = Array.from({ length: 5 }, () => [gift.giftWater(a.id, b.id), gift.giftWater(b.id, a.id)]).flat();
    const results = await Promise.allSettled(calls);
    const s = summarize(results);
    expect(s.errors.filter((e) => !e.includes(ALREADY))).toEqual([]);
    expect(s.fulfilled).toHaveLength(2);
    expect(await giftRows({ senderId: a.id, recipientId: b.id })).toBe(1);
    expect(await giftRows({ senderId: b.id, recipientId: a.id })).toBe(1);
    expect(await seedsOf(a.id)).toBe(100);
    expect(await seedsOf(b.id)).toBe(100);
  });

  it('6 người gửi khác nhau cùng tặng một người nhận: người nhận nhận đủ 60, mỗi người gửi mất đúng 10, 6 bản ghi', async () => {
    const recipient = await createUser(prisma);
    await withSeeds(recipient.id, 5);
    const senders = await Promise.all(Array.from({ length: 6 }, () => createUser(prisma, { referredById: recipient.id })));
    for (const u of senders) await withSeeds(u.id, 50);

    const results = await Promise.allSettled(senders.map((u) => gift.giftWater(u.id, recipient.id)));
    expect(summarize(results).errors).toEqual([]);
    expect(await seedsOf(recipient.id)).toBe(5 + 6 * AMOUNT);
    for (const u of senders) expect(await seedsOf(u.id)).toBe(50 - AMOUNT);
    expect(await giftRows({ recipientId: recipient.id })).toBe(6);
  });

  it('người gửi chỉ còn 5💧: 4 lượt tặng song song tới 4 bạn đều bị từ chối, không có bản ghi gift và không ai được cộng nước', async () => {
    const sender = await createUser(prisma);
    await withSeeds(sender.id, 5);
    const friends = await Promise.all(Array.from({ length: 4 }, () => createUser(prisma, { referredById: sender.id })));
    for (const f of friends) await withSeeds(f.id, 0);

    const results = await Promise.allSettled(friends.map((f) => gift.giftWater(sender.id, f.id)));
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(0);
    for (const e of s.errors) expect(e).toContain(`Cần ${AMOUNT}💧`);
    expect(await seedsOf(sender.id)).toBe(5);
    expect(await giftRows({ senderId: sender.id })).toBe(0);
    for (const f of friends) expect(await seedsOf(f.id)).toBe(0);
  });

  it('người gửi có đủ nước cho 2 lượt (25💧) nhưng gửi song song tới 4 bạn: đúng 2 thành công, nước còn 5, đúng 2 bản ghi, đúng 2 bạn được cộng', async () => {
    const sender = await createUser(prisma);
    await withSeeds(sender.id, 25);
    const friends = await Promise.all(Array.from({ length: 4 }, () => createUser(prisma, { referredById: sender.id })));
    for (const f of friends) await withSeeds(f.id, 0);

    const results = await Promise.allSettled(friends.map((f) => gift.giftWater(sender.id, f.id)));
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(2);
    expect(s.rejected).toHaveLength(2);
    for (const e of s.errors) expect(e).toContain(`Cần ${AMOUNT}💧`);
    expect(await seedsOf(sender.id)).toBe(5);
    expect(await giftRows({ senderId: sender.id })).toBe(2);
    const credited = (await Promise.all(friends.map((f) => seedsOf(f.id)))).filter((n) => n === AMOUNT);
    expect(credited).toHaveLength(2);
  });
});
