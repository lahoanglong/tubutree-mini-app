import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { VouchersService } from '../../src/modules/vouchers/vouchers.service';
import { vnDateParts } from '../../src/common/vn-time';
import { createUser, randCode, warmPool } from './helpers';

/** birthdayVouchers xử lý lô song song (tối đa 10): cùng tập coupon + mức theo hạng, chạy lại / 2 instance không trùng. */
describe('VouchersService.birthdayVouchers chunked (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let vouchers: VouchersService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        VouchersService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    vouchers = moduleRef.get(VouchersService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('27 user nhiều hạng: mỗi người đúng 1 coupon đúng mức hạng; chạy lại và 2 instance song song không tạo thêm', async () => {
    const tag = randCode(6);
    const tiers = [
      { id: `IT-BD-A-${tag}`, amount: 300_000 },
      { id: `IT-BD-B-${tag}`, amount: 150_000 },
      { id: `IT-BD-C-${tag}`, amount: null },
    ];
    for (const [i, t] of tiers.entries()) {
      await prisma.membershipTier.create({
        data: { id: t.id, name: t.id, minPoints: 0, birthdayVoucherAmount: t.amount, perks: [], sortOrder: 900 + i },
      });
    }
    const { year, month, day } = vnDateParts();
    const dob = new Date(Date.UTC(1990, month - 1, day, 12));
    const mine: { id: string; expected: number }[] = [];
    for (let i = 0; i < 27; i++) {
      const tier = i % 4 === 3 ? null : tiers[i % 3]!;
      const u = await createUser(prisma, { zaloId: `${Date.now()}${randCode(8)}`, dob, tierId: tier?.id ?? null });
      mine.push({ id: u.id, expected: tier?.amount ?? 50_000 });
    }
    const read = async () => {
      const rows = await prisma.coupon.findMany({
        where: { code: { startsWith: 'BIRTHDAY-' }, OR: mine.map((m) => ({ scopeMeta: { path: ['userId'], equals: m.id } })) },
      });
      return rows;
    };

    await Promise.all([vouchers.birthdayVouchers(), vouchers.birthdayVouchers()]);
    const first = await read();
    await vouchers.birthdayVouchers();
    const second = await read();

    expect(first).toHaveLength(27);
    expect(second).toHaveLength(27);
    for (const m of mine) {
      const c = first.filter((x) => (x.scopeMeta as { userId: string }).userId === m.id);
      expect(c).toHaveLength(1);
      expect(c[0]!.value).toBe(m.expected);
      expect(c[0]!.code).toBe(`BIRTHDAY-${year}-${month}-${m.id}`.toUpperCase());
    }
    expect(second.map((c) => c.id).sort()).toEqual(first.map((c) => c.id).sort());
  });
});
