import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { SubscriptionUpcomingService } from '../../src/modules/subscriptions/subscription-upcoming.service';
import { startOfVnDay } from '../../src/common/vn-time';
import { createUser, deleteItData, randCode, warmPool } from './helpers';

const TEMPLATE = 'SUBSCRIPTION_UPCOMING';
const DAY = 864e5;

/**
 * Tin nhắc 09:00 "ngày mai Tubu tự đặt đơn định kỳ" trên Postgres thật, NotificationsService thật (khoá advisory theo dedupeKey
 * `sub_upcoming:<gói>:<ngày giao>`): nhiều lượt quét cùng lúc, chạy lại cron, hay hai instance chỉ để lại MỘT tin mỗi kỳ cho mỗi gói.
 */
describe('Gói định kỳ: nhắc trước kỳ giao 24 giờ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: SubscriptionUpcomingService;
  let createdTemplate = false;
  const created = { userIds: [] as string[], productIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    if (!(await prisma.notificationTemplate.findUnique({ where: { code: TEMPLATE } }))) {
      await prisma.notificationTemplate.create({
        data: { id: 'nt-sub-upcoming', code: TEMPLATE, channel: 'INAPP', bodyTemplate: 'Ngày mai ({{date}}) Tubu sẽ tự đặt đơn định kỳ {{product}}.' },
      });
      createdTemplate = true;
    }
    const notifications = new NotificationsService(prisma, {} as never, { recordBestEffort: jest.fn() } as never);
    svc = new SubscriptionUpcomingService(prisma, notifications);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRaw`DELETE FROM "subscriptions" WHERE "userId" = ANY(${created.userIds}::text[])`;
      await prisma.$executeRaw`DELETE FROM "notification_logs" WHERE "userId" = ANY(${created.userIds}::text[])`;
      await deleteItData(prisma, created);
      if (createdTemplate) await prisma.notificationTemplate.delete({ where: { code: TEMPLATE } });
    }
    await moduleRef?.close();
  });

  /** Khách + biến thể đang bán + địa chỉ, và một gói với các cột cho sẵn. */
  async function sub(data: { nextRunAt: Date; status?: string; retryCount?: number; productActive?: boolean }) {
    const u = await createUser(prisma);
    created.userIds.push(u.id);
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT Brand', slug: `it-sp-${tag.toLowerCase()}`, name: `SP IT ${tag}`, description: 'IT', basePrice: 100_000, isActive: data.productActive ?? true },
    });
    created.productIds.push(product.id);
    const v = await prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, affiliateRate: 10, stock: 50 },
    });
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
        recipient: 'Khach IT',
        phone: `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`,
        province: 'Ha Noi',
        district: '',
        ward: 'Phuong IT',
        street: '1 Duong IT',
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '00001',
      },
    });
    const s = await prisma.subscription.create({
      data: {
        userId: u.id,
        variationId: v.id,
        addressId: addr.id,
        quantity: 1,
        intervalWeeks: 4,
        nextRunAt: data.nextRunAt,
        status: data.status ?? 'ACTIVE',
        retryCount: data.retryCount ?? 0,
      },
    });
    return { u, s, product };
  }

  const notices = (userId: string) => prisma.notificationLog.findMany({ where: { userId, templateCode: TEMPLATE, channel: 'INAPP' }, select: { payload: true } });
  const runOnce = (now: Date) => (svc as unknown as { runOnce(now: Date): Promise<unknown> }).runOnce(now);

  it('4 lượt quét song song (bỏ qua khoá lượt chạy) cùng gói đến hạn ngày mai: đúng MỘT tin, mang tên sản phẩm, ngày giao và khoá sub_upcoming:<gói>:<ngày>', async () => {
    const now = new Date();
    const tomorrow = new Date(startOfVnDay(now).getTime() + DAY);
    const { u, s, product } = await sub({ nextRunAt: tomorrow });
    await Promise.all(Array.from({ length: 4 }, () => runOnce(now)));
    const got = await notices(u.id);
    expect(got).toHaveLength(1);
    const payload = got[0]!.payload as { dedupeKey: string; data: Record<string, string>; body: string };
    const vnDay = new Date(tomorrow.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
    expect(payload.dedupeKey).toBe(`sub_upcoming:${s.id}:${vnDay}`);
    expect(payload.data.product).toBe(product.name);
    expect(payload.body).toContain(product.name);
    await runOnce(now);
    expect(await notices(u.id)).toHaveLength(1);
  });

  it('cron chạy lại / hai instance (khoá lượt chạy thật): vẫn đúng một tin; gói hẹn giờ lẻ trong ngày mai cũng được nhắc', async () => {
    const now = new Date();
    const { u } = await sub({ nextRunAt: new Date(startOfVnDay(now).getTime() + DAY + 14 * 3600e3) });
    const runs = await Promise.all([svc.nudgeUpcoming(now), svc.nudgeUpcoming(now), svc.nudgeUpcoming(now)]);
    expect(runs.filter((r) => 'skipped' in r && r.skipped === 'RUNNING').length).toBeGreaterThanOrEqual(1);
    await svc.nudgeUpcoming(now);
    expect(await notices(u.id)).toHaveLength(1);
  });

  it('không nhắc gói hẹn hôm nay, ngày kia, đang tạm dừng, đang thử lại vì hết hàng, hay sản phẩm đã ngừng bán', async () => {
    const now = new Date();
    const today = startOfVnDay(now);
    const tomorrow = new Date(today.getTime() + DAY);
    const cases = await Promise.all([
      sub({ nextRunAt: today }),
      sub({ nextRunAt: new Date(today.getTime() + 2 * DAY) }),
      sub({ nextRunAt: tomorrow, status: 'PAUSED' }),
      sub({ nextRunAt: tomorrow, retryCount: 1 }),
      sub({ nextRunAt: tomorrow, productActive: false }),
    ]);
    await runOnce(now);
    for (const c of cases) expect(await notices(c.u.id)).toHaveLength(0);
  });

  it('khách dời kỳ sang ngày khác: ngày giao mới được nhắc thêm một tin (khoá theo ngày giao), ngày cũ không nhắc lại', async () => {
    const now = new Date();
    const tomorrow = new Date(startOfVnDay(now).getTime() + DAY);
    const { u, s } = await sub({ nextRunAt: tomorrow });
    await runOnce(now);
    await prisma.subscription.update({ where: { id: s.id }, data: { nextRunAt: new Date(tomorrow.getTime() + DAY) } });
    const nextMorning = new Date(now.getTime() + DAY);
    await Promise.all([runOnce(nextMorning), runOnce(nextMorning)]);
    await runOnce(now);
    const keys = (await notices(u.id)).map((n) => (n.payload as { dedupeKey: string }).dedupeKey).sort();
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});
