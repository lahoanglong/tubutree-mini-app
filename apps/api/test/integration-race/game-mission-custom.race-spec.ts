import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { AdminEngagementService } from '../../src/modules/admin/admin-engagement.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/** Nhiệm vụ quản trị thêm: chỉ tính việc từ lúc tạo, và hai lượt nhận đồng thời chỉ cộng một lần (real Postgres). */
describe('Nhiệm vụ quản trị thêm (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;
  let admin: AdminEngagementService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, GameService, AdminEngagementService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    game = moduleRef.get(GameService);
    admin = moduleRef.get(AdminEngagementService);
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
    await dropItMissions();
    // Tắt các nhiệm vụ cùng loại còn sót từ spec khác để phép kiểm trùng không chặn việc tạo.
    await prisma.mission.updateMany({ where: { code: { in: ['FIRST_ORDER'] } }, data: { disabledAt: new Date() } });
  });

  const dropItMissions = async () => {
    const ids = (await prisma.mission.findMany({ where: { title: { startsWith: 'IT ' }, code: { startsWith: 'CUSTOM_' } }, select: { id: true } })).map((m) => m.id);
    await prisma.missionProgress.deleteMany({ where: { missionId: { in: ids } } });
    await prisma.mission.deleteMany({ where: { id: { in: ids } } });
  };

  afterAll(async () => {
    await dropItMissions();
    await prisma.mission.updateMany({ where: { code: 'FIRST_ORDER' }, data: { disabledAt: null } });
    await moduleRef?.close();
  });

  const create = async (goal = 1) => {
    const m = await admin.createMission('it-admin', { title: `IT ${randCode(4)}`, description: 'IT', kind: 'ORDER_COUNT', goal, rewardPoints: 777 });
    return m;
  };

  it('khách có đơn giao từ trước không nhận được; có đơn mới sau khi tạo (qua hạn đổi/trả) thì nhận; hai lượt nhận đồng thời chỉ cộng một lần', async () => {
    const old = await createUser(prisma);
    await createOrder(prisma, { userId: old.id, status: 'DELIVERED', deliveredAt: ago(30) });
    const mission = await create();
    await expect(game.claimMission(old.id, mission.code)).rejects.toThrow('Chưa đủ điều kiện');

    // Đơn giao sau mốc bắt đầu: dời mốc về 20 ngày trước để đơn 10 ngày trước đã qua hạn 7 ngày.
    await prisma.mission.update({ where: { id: mission.id }, data: { startsAt: ago(20) } });
    const buyer = await createUser(prisma);
    await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', deliveredAt: ago(10) });
    const results = await Promise.allSettled([game.claimMission(buyer.id, mission.code), game.claimMission(buyer.id, mission.code)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.missionProgress.count({ where: { userId: buyer.id, missionId: mission.id } })).toBe(1);
    expect(await prisma.pointsTransaction.count({ where: { userId: buyer.id, reason: { startsWith: `MISSION:${mission.code}` } } })).toBe(1);
    // Đơn giao trước mốc vẫn không tính cho khách cũ dù mốc đã dời.
    await expect(game.claimMission(old.id, mission.code)).rejects.toThrow('Chưa đủ điều kiện');
  });

  it('tạo trùng (loại, mục tiêu) với nhiệm vụ đang bật bị chặn', async () => {
    await create(2);
    await expect(create(2)).rejects.toThrow('cùng loại và cùng mục tiêu');
  });
  it('hai lần tạo đồng thời cùng (loại, mục tiêu): chỉ một lần thành công', async () => {
    const mk = () => admin.createMission('it-admin', { title: `IT ${randCode(4)}`, description: 'IT', kind: 'REVIEW_COUNT', goal: 5, rewardPoints: 10 });
    const results = await Promise.allSettled([mk(), mk(), mk()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
  });

  it('hai nhiệm vụ trùng đang tạm dừng bật lại đồng thời: chỉ một cái bật được', async () => {
    const mkPaused = () =>
      prisma.mission.create({
        data: {
          id: `it-${randCode(8)}`, code: `CUSTOM_${randCode(6)}`, title: `IT ${randCode(4)}`, description: 'IT', kind: 'INVITE_COUNT',
          goal: 7, rewardPoints: 10, disabledAt: new Date(), startsAt: new Date(),
        },
      });
    const [a, b] = await Promise.all([mkPaused(), mkPaused()]);
    const results = await Promise.allSettled([admin.updateMission(a.id, { disabled: false }), admin.updateMission(b.id, { disabled: false })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.mission.count({ where: { id: { in: [a.id, b.id] }, disabledAt: null } })).toBe(1);
  });

  async function buyers(n: number) {
    const users = [];
    for (let i = 0; i < n; i += 1) {
      const u = await createUser(prisma);
      await createOrder(prisma, { userId: u.id, status: 'DELIVERED', deliveredAt: ago(10) });
      users.push(u);
    }
    return users;
  }

  it('100 khách khác nhau nhận cùng một nhiệm vụ đồng thời: không lỗi, mỗi người được cộng đúng một lần (khoá chia sẻ không xếp hàng)', async () => {
    await prisma.mission.updateMany({ where: { title: { startsWith: 'IT ' }, code: { startsWith: 'CUSTOM_' } }, data: { disabledAt: new Date() } });
    const mission = await create();
    await prisma.mission.update({ where: { id: mission.id }, data: { startsAt: ago(20) } });
    const users = await buyers(100);
    const results = await Promise.allSettled(users.map((u) => game.claimMission(u.id, mission.code)));
    expect(results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    const ids = users.map((u) => u.id);
    expect(await prisma.missionProgress.count({ where: { userId: { in: ids }, missionId: mission.id } })).toBe(100);
    expect(await prisma.pointsTransaction.count({ where: { userId: { in: ids }, reason: { startsWith: `MISSION:${mission.code}` } } })).toBe(100);
  });

  it('quản trị tạm dừng giữa chừng: lượt nhận sau đó đọc lại và bị chặn, lượt đã thành công mỗi người đúng một lần', async () => {
    const mission = await create(3);
    await prisma.mission.update({ where: { id: mission.id }, data: { startsAt: ago(20) } });
    const users = await Promise.all(
      Array.from({ length: 40 }, async () => {
        const u = await createUser(prisma);
        for (let i = 0; i < 3; i += 1) await createOrder(prisma, { userId: u.id, status: 'DELIVERED', deliveredAt: ago(10 + i) });
        return u;
      }),
    );
    const first = users.slice(0, 20);
    const later = users.slice(20);
    const [pause, ...claims] = await Promise.allSettled([
      admin.updateMission(mission.id, { disabled: true }),
      ...first.map((u) => game.claimMission(u.id, mission.code)),
    ]);
    expect(pause.status).toBe('fulfilled');
    for (const r of claims) if (r.status === 'rejected') expect(String(r.reason)).toContain('tạm dừng');
    const ok = claims.filter((r) => r.status === 'fulfilled').length;
    expect(await prisma.missionProgress.count({ where: { missionId: mission.id } })).toBe(ok);
    const after = await Promise.allSettled(later.map((u) => game.claimMission(u.id, mission.code)));
    expect(after.every((r) => r.status === 'rejected' && String(r.reason).includes('tạm dừng'))).toBe(true);
    expect(await prisma.missionProgress.count({ where: { missionId: mission.id } })).toBe(ok);
  });
});
