import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OpsHealthService, type OpsQueue } from '../../src/modules/ops/ops-health.service';
import { createOrder, createUser, markDeliveredEffectsDone, setConfig } from './helpers';

/**
 * R4-SYNC-3 trên Postgres THẬT: (a) đơn thu gom NEEDS_MANUAL_CHECK (hoặc còn báo động Gomdon mở) là một sự cố — kênh báo động
 * không được báo "Hết sự cố" khi đơn còn chờ người tra Gomdon; (b) đơn mới vào "Cần xử lý Pancake" trong giờ nhắc lại cũng
 * được báo ngay, không bị gộp 6 giờ chỉ vì loại sự cố đã có. Stub: hàng đợi, thông báo, webhook ngoài.
 */
describe('Báo động vận hành: việc cho người (real Postgres)', () => {
  let prisma: PrismaService;
  let health: OpsHealthService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const env: Record<string, string> = { PANCAKE_API_KEY: 'k', PANCAKE_SHOP_ID: 's', OPS_ALERT_WEBHOOK_URL: '' };
  const queue: OpsQueue = { name: 'pancake-push', getJobCounts: async () => ({}), getFailed: async () => [] };
  const created: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const sysConfig = {
      get: async <T,>(key: string, fallback: T): Promise<T> => {
        const row = await prisma.systemConfig.findUnique({ where: { key } });
        return (row?.value as T) ?? fallback;
      },
    };
    const gomdon = { getConfig: async () => ({ baseUrl: 'http://gomdon.invalid', phone: '0900000000', password: 'x' }), getHealth: () => null };
    health = new OpsHealthService(prisma, { get: (k: string) => env[k] ?? '' } as never, [queue], sysConfig as never, gomdon as never, { notify } as never);
    await setConfig(prisma, 'ops.alert_repeat_hours', 6);
    await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await prisma.order.updateMany({
      where: { id: { in: created } },
      data: { status: 'CANCELLED', pancakeAttention: null, pancakeAttentionAt: null, gomdonStatus: 'MANUAL_HANDLED' },
    });
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await markDeliveredEffectsDone(prisma);
    notify.mockClear();
    await prisma.opsHealthState.deleteMany({ where: { key: 'alert' } });
  });

  const order = async (data: Partial<Prisma.OrderUncheckedCreateInput>) => {
    const u = await createUser(prisma);
    const o = await createOrder(prisma, { userId: u.id, ...data });
    created.push(o.id);
    return o;
  };

  it('(a) đơn thu gom NEEDS_MANUAL_CHECK → sự cố gomdon.attention kèm mã đơn; còn đơn đó thì không báo "Hết sự cố"', async () => {
    const t0 = new Date();
    const o = await order({ hasRecyclingPickup: true, status: 'CONFIRMED', gomdonStatus: 'NEEDS_MANUAL_CHECK', createdAt: new Date(0) });
    const snap = await health.snapshot(t0);
    const problem = snap.problems.find((p) => p.key === 'gomdon.attention');
    expect(problem?.message).toContain(o.code);

    await expect(health.checkAndAlert(t0)).resolves.toMatchObject({ sent: 'ALERT' });
    for (let i = 1; i <= 3; i++) {
      const r = await health.checkAndAlert(new Date(t0.getTime() + i * 5 * 60_000));
      expect(r.sent).not.toBe('RECOVERED');
      expect(r.problems.map((p) => p.key)).toContain('gomdon.attention');
    }
  });

  it('(b) đơn mới vào "Cần xử lý Pancake" 10 phút sau lần báo → báo ngay; không có việc mới thì không lặp', async () => {
    // Đơn do spec khác để lại trong DB dùng chung phải đã quá ngưỡng "kẹt" ngay từ t0, nếu không chúng thành sự cố mới giữa các mốc giả lập.
    const t0 = new Date(Date.now() + 2 * 3_600_000);
    await order({ pancakeAttention: 'Pancake báo "Đang giao" nhưng đơn đang "Đã huỷ"', pancakeAttentionAt: new Date(t0.getTime() - 60_000) });
    await expect(health.checkAndAlert(t0)).resolves.toMatchObject({ sent: 'ALERT' });

    await expect(health.checkAndAlert(new Date(t0.getTime() + 5 * 60_000))).resolves.toMatchObject({ sent: null });

    const fresh = await order({ pancakeAttention: 'Khách chuyển thiếu: …', pancakeAttentionAt: new Date(t0.getTime() + 6 * 60_000) });
    notify.mockClear();
    const r = await health.checkAndAlert(new Date(t0.getTime() + 10 * 60_000));
    expect(r.sent).toBe('ALERT');
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'OPS_HEALTH_ALERT', expect.objectContaining({ summary: expect.stringContaining('cần xử lý tay trên Pancake') }));
    const state = await prisma.opsHealthState.findUniqueOrThrow({ where: { key: 'alert' } });
    expect((state.detail as { tracked?: Record<string, { count: number }> }).tracked?.['pancake.attention']?.count).toBeGreaterThan(0);

    await prisma.order.update({ where: { id: fresh.id }, data: { pancakeAttention: null, pancakeAttentionAt: null } });
    await expect(health.checkAndAlert(new Date(t0.getTime() + 15 * 60_000))).resolves.toMatchObject({ sent: null });
  });
});
