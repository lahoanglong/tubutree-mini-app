import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { GameCommunityService } from '../../src/modules/game/game-community.service';
import { createUser, summarize, warmPool } from './helpers';

/**
 * Góp giọt nước vào hồ cộng đồng (`GameCommunityService.contribute`) khi nhiều khách thu hoạch cùng lúc.
 * Bất biến cần giữ: tổng `currentDrops` của mốc bằng tổng các dòng đóng góp, mỗi khách đúng một dòng, và mốc vượt target chỉ được chốt
 * đúng một lần (ACTIVE → DONE). Mốc của spec đặt startAt rất cũ để `findFirst(ACTIVE, startAt asc)` luôn chọn mốc này trước mốc seed.
 */
describe('GameCommunityService.contribute song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let community: GameCommunityService;
  const goalIds: string[] = [];
  let seq = 0;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [GameCommunityService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    community = moduleRef.get(GameCommunityService);
  });

  afterEach(async () => {
    await prisma.communityGoal.deleteMany({ where: { id: { in: goalIds.splice(0) } } });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function goal(targetDrops: number) {
    const g = await prisma.communityGoal.create({
      data: { title: 'IT hồ', region: 'IT', targetDrops, treesToPlant: 1, startAt: new Date(1000 + seq++) },
    });
    goalIds.push(g.id);
    return g;
  }

  const sumOf = async (goalId: string) =>
    (await prisma.communityContribution.aggregate({ where: { goalId }, _sum: { drops: true } }))._sum.drops ?? 0;

  it('10 lượt góp song song của CÙNG một khách: hồ và dòng đóng góp cùng đúng 100, chỉ một dòng', async () => {
    const g = await goal(1_000_000);
    const user = await createUser(prisma);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => community.contribute(user.id, 10)));
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    expect((await prisma.communityGoal.findUniqueOrThrow({ where: { id: g.id } })).currentDrops).toBe(100);
    const rows = await prisma.communityContribution.findMany({ where: { goalId: g.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].drops).toBe(100);
  });

  it('8 khách khác nhau góp song song: hồ bằng tổng 80, mỗi khách đúng một dòng 10', async () => {
    const g = await goal(1_000_000);
    const users = await Promise.all(Array.from({ length: 8 }, () => createUser(prisma)));
    const results = await Promise.allSettled(users.map((u) => community.contribute(u.id, 10)));
    expect(summarize(results).errors).toEqual([]);
    expect((await prisma.communityGoal.findUniqueOrThrow({ where: { id: g.id } })).currentDrops).toBe(80);
    const rows = await prisma.communityContribution.findMany({ where: { goalId: g.id } });
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.drops === 10)).toBe(true);
  });

  it('10 lượt góp 20💧 vượt mốc 50💧: mốc chốt đúng một lần (DONE, có fulfilledAt), tổng hồ khớp tổng dòng đóng góp, không mất giọt nào', async () => {
    const g = await goal(50);
    const sink = await goal(1_000_000);
    const fulfilResults: boolean[] = [];
    const original = community.fulfil.bind(community);
    const spy = jest.spyOn(community, 'fulfil').mockImplementation(async (id: string) => {
      const won = await original(id);
      if (id === g.id) fulfilResults.push(won);
      return won;
    });
    try {
      const users = await Promise.all(Array.from({ length: 10 }, () => createUser(prisma)));
      const results = await Promise.allSettled(users.map((u) => community.contribute(u.id, 20)));
      expect(summarize(results).errors).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    const after = await prisma.communityGoal.findUniqueOrThrow({ where: { id: g.id } });
    const sinkAfter = await prisma.communityGoal.findUniqueOrThrow({ where: { id: sink.id } });
    console.log('[community-cross] goal.currentDrops=%d sink.currentDrops=%d fulfilResults=%j', after.currentDrops, sinkAfter.currentDrops, fulfilResults);
    expect(after.status).toBe('DONE');
    expect(after.fulfilledAt).not.toBeNull();
    expect(fulfilResults.filter(Boolean)).toHaveLength(1);
    expect(after.currentDrops).toBe(await sumOf(g.id));
    expect(sinkAfter.currentDrops).toBe(await sumOf(sink.id));
    expect(after.currentDrops + sinkAfter.currentDrops).toBe(200);
  });
});
