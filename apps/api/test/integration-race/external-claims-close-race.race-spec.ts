import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { applyStatusToClaim } from '../../src/modules/external-points/external-claim-status';
import { releaseClaim } from '../../src/modules/external-points/external-claim-release';
import { createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';

const DAY = 864e5;

/**
 * A2: webhook huỷ/hoàn chen vào lúc cron cộng. Kết quả cuối không bao giờ là claim CREDITED trong khi đơn đã đóng mà điểm chưa được
 * đảo (đơn khoá trước, claim sau, ở mọi đường).
 */
describe('Cron cộng điểm đơn ngoài so với webhook huỷ/hoàn song song (real Postgres)', () => {
  let prisma: PrismaService;
  const restore: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const notify = jest.fn(async () => undefined);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    restore.push(await pinConfig(prisma, 'loyalty.marketplace_claim_enabled', true));
  });
  afterAll(async () => {
    for (const r of restore.reverse()) await r();
    await prisma.externalClaimEvent?.deleteMany({ where: { claimId: { in: (await prisma.externalPointsClaim.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((c) => c.id) } } });
    await prisma.externalPointsClaim.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.externalOrder.deleteMany({ where: { id: { in: orderIds } } });
    await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });

  async function setup() {
    const user = await createUser(prisma, { phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, zaloId: `z_${randCode(8)}` });
    userIds.push(user.id);
    const code = `IT${randCode(10)}`;
    const order = await prisma.externalOrder.create({
      data: {
        pancakeOrderId: `EXTRC${randCode(10)}`, source: 'MARKETPLACE', channel: 'shopee', sourceKey: 'x', trackingCode: code, trackingCodes: [code],
        goodsValue: 200_000, pancakeStatus: 3, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 20 * DAY), lastPayload: {},
      },
    });
    orderIds.push(order.id);
    const claim = await prisma.externalPointsClaim.create({
      data: { externalOrderId: order.id, userId: user.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 2_000, claimedCode: code, dayKey: '2026-10-20' },
    });
    return { user, order, claim };
  }

  it.each(['RETURNED', 'CANCELLED'] as const)('30 vòng: cộng song song với webhook %s, không bao giờ CREDITED + đơn đóng mà chưa đảo', async (status) => {
    const config = new SystemConfigService(prisma);
    const bad: string[] = [];
    for (let i = 0; i < 30; i++) {
      const { user, order, claim } = await setup();
      const closeAndApply = async () => {
        await prisma.externalOrder.update({ where: { id: order.id }, data: { status, pancakeStatus: status === 'RETURNED' ? 5 : 6, closedAt: new Date() } });
        await applyStatusToClaim(prisma, { notify }, config, order.pancakeOrderId);
      };
      const delay = i % 3 === 0 ? 0 : i % 3;
      await Promise.all([
        releaseClaim(prisma, claim.id, { pendingDays: 14, expiryMonths: 12 }).catch(() => null),
        new Promise((r) => setTimeout(r, delay)).then(closeAndApply),
      ]);
      // Không có lượt webhook thứ hai: Pancake không gửi lại, nên một lượt phải tự đúng.
      const c = await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } });
      const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      if (c.state === 'CREDITED') bad.push(`vòng ${i}: CREDITED + đơn ${status}`);
      if (u.pointsBalance !== 0) bad.push(`vòng ${i}: số dư ${u.pointsBalance}`);
      if (!['VOIDED', 'REVERSED'].includes(c.state)) bad.push(`vòng ${i}: state ${c.state}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);
});
