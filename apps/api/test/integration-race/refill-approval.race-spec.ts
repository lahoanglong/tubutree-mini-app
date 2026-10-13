import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { RefillService } from '../../src/modules/refill/refill.service';
import { createUser, summarize, warmPool } from './helpers';

/**
 * ENGAGE-13 trên Postgres thật: nhân viên nhập số vỏ thực nhận khi duyệt (kẹp ≤ số khai), 💧 theo số thực nhận,
 * ghi người duyệt, đếm trần tháng theo vỏ thật, và hai nhân viên duyệt cùng lúc chỉ thưởng đúng một lần.
 */
describe('Duyệt đổi vỏ chai: số vỏ thực nhận và duyệt song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let refill: RefillService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        RefillService,
        { provide: AnalyticsEventsService, useValue: { recordBestEffort: jest.fn() } },
        { provide: ZnsClient, useValue: { sendTemplate: jest.fn().mockResolvedValue(true) } },
        {
          provide: NotificationsService,
          inject: [PrismaService, ZnsClient, AnalyticsEventsService],
          useFactory: (p: PrismaService, z: ZnsClient, a: AnalyticsEventsService) => new NotificationsService(p, z, a),
        },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    refill = moduleRef.get(RefillService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function pendingReturn(quantity: number, perBottle = 50) {
    const user = await createUser(prisma);
    const staff = await createUser(prisma, { role: 'STAFF' });
    const br = await prisma.bottleReturn.create({
      data: { userId: user.id, quantity, seedsAwarded: quantity * perBottle, status: 'PENDING' },
    });
    return { user, staff, br };
  }
  const seeds = async (userId: string) => (await prisma.gameProfile.findUnique({ where: { userId } }))?.totalSeeds ?? 0;

  it('nhận 3 trên 5 vỏ khai → quantity 3, declaredQuantity 5, 💧 = 3 × 50, ghi người duyệt; trần tháng đếm 3', async () => {
    const { user, staff, br } = await pendingReturn(5);

    await refill.approveReturn(br.id, staff.id, 3);

    const row = await prisma.bottleReturn.findUniqueOrThrow({ where: { id: br.id } });
    expect(row).toMatchObject({
      status: 'APPROVED', quantity: 3, declaredQuantity: 5, seedsAwarded: 150, reviewedBy: staff.id,
    });
    expect(row.reviewedAt).toBeInstanceOf(Date);
    expect(await seeds(user.id)).toBe(150);
    const summary = await refill.getSummary(user.id);
    expect(summary.monthlyUsed).toBe(3);
    expect(summary.totalRecycled).toBe(3);
    const notice = await prisma.notificationLog.findFirst({ where: { userId: user.id, templateCode: 'REFILL_APPROVED' } });
    expect((notice?.payload as { data: Record<string, string> }).data).toEqual({ quantity: '3', seeds: '150', note: ' (bạn khai 5 vỏ)' });
  });

  it('nhập số lớn hơn số khai → kẹp về số khai, không thưởng thừa', async () => {
    const { user, staff, br } = await pendingReturn(2);

    await refill.approveReturn(br.id, staff.id, 50);

    expect((await prisma.bottleReturn.findUniqueOrThrow({ where: { id: br.id } })).quantity).toBe(2);
    expect(await seeds(user.id)).toBe(100);
  });

  it('hai nhân viên duyệt CÙNG LÚC (hai số khác nhau) → đúng một người thắng, 💧 cộng một lần', async () => {
    const { user, staff, br } = await pendingReturn(4);
    const other = await createUser(prisma, { role: 'STAFF' });

    const results = await Promise.allSettled([
      refill.approveReturn(br.id, staff.id, 4),
      refill.approveReturn(br.id, other.id, 1),
    ]);

    expect(summarize(results).fulfilled.length).toBe(1);
    const row = await prisma.bottleReturn.findUniqueOrThrow({ where: { id: br.id } });
    expect(row.status).toBe('APPROVED');
    expect([staff.id, other.id]).toContain(row.reviewedBy);
    expect(await seeds(user.id)).toBe(row.seedsAwarded);
    expect(await prisma.notificationLog.count({ where: { userId: user.id, templateCode: 'REFILL_APPROVED' } })).toBe(1);
  });

  it('duyệt rồi từ chối cùng lúc → chỉ một kết quả; từ chối không cộng 💧 và lưu lý do', async () => {
    const { user, staff, br } = await pendingReturn(3);

    const results = await Promise.allSettled([
      refill.approveReturn(br.id, staff.id),
      refill.rejectReturn(br.id, staff.id, 'Vỏ chưa rửa sạch'),
    ]);

    expect(summarize(results).fulfilled.length).toBe(1);
    const row = await prisma.bottleReturn.findUniqueOrThrow({ where: { id: br.id } });
    if (row.status === 'REJECTED') {
      expect(row.rejectionReason).toBe('Vỏ chưa rửa sạch');
      expect(await seeds(user.id)).toBe(0);
    } else {
      expect(await seeds(user.id)).toBe(150);
    }
  });

  it('danh sách chờ duyệt: cũ nhất trước và phân trang theo cursor không bỏ sót dòng nào', async () => {
    const made = [];
    for (let i = 0; i < 5; i++) {
      const u = await createUser(prisma);
      made.push(
        await prisma.bottleReturn.create({
          data: { userId: u.id, quantity: 1, seedsAwarded: 50, status: 'PENDING', createdAt: new Date(Date.now() - (10 - i) * 3600e3) },
        }),
      );
    }
    const ids = new Set(made.map((m) => m.id));
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 200; page++) {
      const rows = await refill.listPending({ cursor, take: 2 });
      if (rows.length === 0) break;
      seen.push(...rows.map((r) => r.id));
      cursor = rows[rows.length - 1]!.id;
    }
    expect(seen.filter((id) => ids.has(id))).toEqual(made.map((m) => m.id));
  });
});
