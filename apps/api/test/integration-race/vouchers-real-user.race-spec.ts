import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { VouchersService } from '../../src/modules/vouchers/vouchers.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * Voucher tự động (C-059, Q-05) trên Postgres thật: chỉ user thật (zaloId Zalo hoặc SĐT đã xác
 * thực) nhận voucher chào mừng/sinh nhật/winback; cron sinh nhật/winback quét theo lô có thứ tự,
 * không bỏ sót ai khi vượt kích thước lô và chạy lại không cấp trùng.
 */
describe('VouchersService real-user + batching (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let vouchers: VouchersService;
  const statics = VouchersService as unknown as { BATCH_PAGE: number };
  let originalPage: number;

  const couponsOf = (userId: string, prefix: string) =>
    prisma.coupon.findMany({ where: { code: { startsWith: `${prefix}-` }, scopeMeta: { path: ['userId'], equals: userId } } });

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
    originalPage = statics.BATCH_PAGE;
  });

  afterEach(() => {
    statics.BATCH_PAGE = originalPage;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const guest = () => createUser(prisma, { zaloId: `guest_d_${randCode(20)}` });
  const mergedGuest = () => createUser(prisma, { zaloId: `guest_d_${randCode(20)}_merged_${Date.now()}` });
  const zaloUser = () => createUser(prisma, { zaloId: `${Date.now()}${randCode(8)}` });
  const phoneUser = () => createUser(prisma, { phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` });

  it('(a) welcome: guest / guest đã gộp không nhận; user Zalo và user có SĐT nhận đúng 1 lần', async () => {
    const [g, mg, z, p] = [await guest(), await mergedGuest(), await zaloUser(), await phoneUser()];

    await vouchers.welcomeVouchers();
    await vouchers.welcomeVouchers();

    const counts = await Promise.all([g, mg, z, p].map((u) => couponsOf(u.id, 'WELCOME').then((c) => c.length)));
    console.log('[a] welcome guest=%d merged=%d zalo=%d phone=%d', ...counts);
    expect(counts).toEqual([0, 0, 1, 1]);
  });

  it('(b) birthday: guest không nhận; > 1 lô user cùng ngày sinh đều nhận, chạy 2 lần không trùng', async () => {
    statics.BATCH_PAGE = 3;
    const now = new Date();
    const dob = new Date(Date.UTC(1990, now.getMonth(), now.getDate(), 12));
    const reals = [];
    for (let i = 0; i < 8; i++) reals.push(await createUser(prisma, { zaloId: `${Date.now()}${randCode(8)}`, dob }));
    const g = await createUser(prisma, { zaloId: `guest_d_${randCode(20)}`, dob });

    await vouchers.birthdayVouchers();
    await vouchers.birthdayVouchers();

    const realCounts = await Promise.all(reals.map((u) => couponsOf(u.id, 'BIRTHDAY').then((c) => c.length)));
    const guestCount = (await couponsOf(g.id, 'BIRTHDAY')).length;
    console.log('[b] birthday real=%j guest=%d', realCounts, guestCount);
    expect(realCounts).toEqual(reals.map(() => 1));
    expect(guestCount).toBe(0);
  });

  it('(c) winback: guest có đơn cũ không nhận; > 1 lô user thật đều nhận, chạy 2 lần không trùng', async () => {
    statics.BATCH_PAGE = 2;
    const old = new Date(Date.now() - 120 * 864e5);
    const reals = [];
    for (let i = 0; i < 5; i++) {
      const u = await phoneUser();
      await createOrder(prisma, { userId: u.id, createdAt: old });
      reals.push(u);
    }
    const g = await guest();
    await createOrder(prisma, { userId: g.id, createdAt: old });

    await vouchers.winbackVouchers();
    await vouchers.winbackVouchers();

    const realCounts = await Promise.all(reals.map((u) => couponsOf(u.id, 'WINBACK').then((c) => c.length)));
    const guestCount = (await couponsOf(g.id, 'WINBACK')).length;
    console.log('[c] winback real=%j guest=%d', realCounts, guestCount);
    expect(realCounts).toEqual(reals.map(() => 1));
    expect(guestCount).toBe(0);
  });

  it('(d) birthday: 2 instance cron chạy song song → mỗi user đúng 1 voucher', async () => {
    statics.BATCH_PAGE = 2;
    const now = new Date();
    const dob = new Date(Date.UTC(1985, now.getMonth(), now.getDate(), 12));
    const reals = [];
    for (let i = 0; i < 5; i++) reals.push(await createUser(prisma, { phone: `08${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, dob }));

    await Promise.all([vouchers.birthdayVouchers(), vouchers.birthdayVouchers()]);

    const realCounts = await Promise.all(reals.map((u) => couponsOf(u.id, 'BIRTHDAY').then((c) => c.length)));
    console.log('[d] birthday parallel real=%j', realCounts);
    expect(realCounts).toEqual(reals.map(() => 1));
  });

  it('(e) birthday: 520 user thật cùng ngày sinh (vượt mốc 500 cũ) với lô mặc định → không sót ai', async () => {
    const now = new Date();
    const dob = new Date(Date.UTC(1977, now.getMonth(), now.getDate(), 12));
    const tag = randCode(6);
    await prisma.user.createMany({
      data: Array.from({ length: 520 }, (_, i) => ({ referralCode: `E${tag}${i}`, zaloId: `z${tag}${i}`, dob })),
    });
    const ids = (await prisma.user.findMany({ where: { zaloId: { startsWith: `z${tag}` } }, select: { id: true } })).map((u) => u.id);

    await vouchers.birthdayVouchers();

    const codes = ids.map((id) => `BIRTHDAY-${now.getFullYear()}-${now.getMonth() + 1}-${id}`.toUpperCase());
    const granted = await prisma.coupon.count({ where: { code: { in: codes } } });
    console.log('[e] birthday 520 users granted=%d', granted);
    expect(ids).toHaveLength(520);
    expect(granted).toBe(520);
  });
});
