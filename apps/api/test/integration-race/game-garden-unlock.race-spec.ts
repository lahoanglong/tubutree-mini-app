import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { GameGardenService } from '../../src/modules/game/game-garden.service';
import { createUser, setConfig, summarize, warmPool } from './helpers';

/**
 * R2-ENGAGE-15: bấm đúp "Mở lô đất" bắn hai request song song cho cùng ô. Trước đây request thua ăn P2002 trên
 * unique(userId, slot) và khách thấy "Dữ liệu trùng (vi phạm ràng buộc duy nhất)" dù ô đã mở. Nay lần thua trả đúng ô
 * vừa được mở, 💧 chỉ bị trừ một lần.
 */
describe('Mở lô đất song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let garden: GameGardenService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, GameGardenService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    garden = moduleRef.get(GameGardenService);
    await setConfig(prisma, 'game.max_plots', 5);
    await setConfig(prisma, 'game.plot_unlock_seed_base', 100);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function userWithSeeds(totalSeeds: number) {
    const user = await createUser(prisma);
    await prisma.gameProfile.create({ data: { userId: user.id, totalSeeds } });
    return user;
  }
  const seeds = async (userId: string) => (await prisma.gameProfile.findUniqueOrThrow({ where: { userId } })).totalSeeds;

  it('hai lệnh mở song song (đủ 💧 cho cả hai) → cả hai thành công, một ô duy nhất, trừ 💧 một lần', async () => {
    const user = await userWithSeeds(1000);

    const results = await Promise.allSettled([garden.unlockPlot(user.id, 'SEEDS'), garden.unlockPlot(user.id, 'SEEDS')]);

    const s = summarize(results);
    expect(s.errors).toEqual([]);
    expect(s.fulfilled).toHaveLength(2);
    expect(s.fulfilled[0]!.value).toMatchObject({ slot: 1 });
    expect(s.fulfilled[1]!.value).toMatchObject({ slot: 1 });
    expect(await prisma.gardenPlot.count({ where: { userId: user.id } })).toBe(1);
    expect(await seeds(user.id)).toBe(900);
  });

  it('mười lệnh song song → vẫn một ô, trừ đúng một lần', async () => {
    const user = await userWithSeeds(5000);

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => garden.unlockPlot(user.id, 'SEEDS')));

    expect(summarize(results).errors).toEqual([]);
    expect(await prisma.gardenPlot.count({ where: { userId: user.id } })).toBe(1);
    expect(await seeds(user.id)).toBe(4900);
  });

  it('không đủ 💧 vẫn báo thiếu nước (không bị nuốt thành "đã mở")', async () => {
    const user = await userWithSeeds(50);

    await expect(garden.unlockPlot(user.id, 'SEEDS')).rejects.toThrow('Cần 100💧');
    expect(await prisma.gardenPlot.count({ where: { userId: user.id } })).toBe(0);
    expect(await seeds(user.id)).toBe(50);
  });

  it('mở tuần tự hai lần là hai ô khác nhau (giá theo ô, không bị coi là bấm đúp)', async () => {
    const user = await userWithSeeds(1000);

    const first = await garden.unlockPlot(user.id, 'SEEDS');
    const second = await garden.unlockPlot(user.id, 'SEEDS');

    expect([first.slot, second.slot]).toEqual([1, 2]);
    expect(await seeds(user.id)).toBe(1000 - 100 - 200);
  });
});
