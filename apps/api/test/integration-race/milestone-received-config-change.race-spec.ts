import { PrismaService } from '../../src/prisma/prisma.service';
import { VouchersService } from '../../src/modules/vouchers/vouchers.service';
import { createUser, randCode, warmPool } from './helpers';

/** L2-05 / m2 trên Postgres thật: "đã nhận trong kỳ" đọc từ scopeMeta.reason của coupon đã cấp, đúng với bộ lọc JSON của Prisma. */
describe('Voucher mốc: đã nhận trong kỳ đọc theo coupon đã cấp (real Postgres)', () => {
  let prisma: PrismaService;
  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('cộng đúng các mã mốc của kỳ theo userId, bỏ qua kỳ khác và mã không phải mốc, kể cả bậc không còn trong cấu hình', async () => {
    const u = await createUser(prisma);
    const tag = randCode(4);
    const mk = (reason: string, value: number) =>
      prisma.coupon.create({
        data: {
          code: `${reason}-${u.id}-${tag}`.toUpperCase(),
          type: 'AMOUNT',
          value,
          startAt: new Date(),
          endAt: new Date(Date.now() + 864e5),
          usageLimit: 1,
          perUserLimit: 1,
          scope: 'USER_GROUP',
          scopeMeta: { userId: u.id, reason },
        },
      });
    const period = `2099-${String(1 + Math.floor(Math.random() * 9)).padStart(2, '0')}`;
    await mk(`MILESTONE3000000-${period}`, 100_000);
    await mk(`MILESTONE1000000-${period}`, 30_000);
    await mk('MILESTONE1000000-2098-01', 30_000);
    await mk(`WELCOME-${period}`, 5_000);
    const svc = new VouchersService(prisma, { get: async <T>(_k: string, f?: T) => f as T } as never, {} as never);
    const received = await (svc as unknown as { milestoneReceived(p: string): Promise<Map<string, { sum: number; codes: Set<string> }>> }).milestoneReceived(period);
    expect(received.get(u.id)?.sum).toBe(130_000);
    expect(received.get(u.id)?.codes.size).toBe(2);
    await prisma.coupon.deleteMany({ where: { code: { endsWith: `-${u.id}-${tag}`.toUpperCase() } } });
  });
});
