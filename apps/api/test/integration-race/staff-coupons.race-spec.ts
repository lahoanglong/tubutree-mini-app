import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { CouponClaimService } from '../../src/modules/coupons/coupon-claim.service';
import { AdminCouponBatchService } from '../../src/modules/admin/admin-coupon-batch.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { createUser, randCode, warmPool } from './helpers';

/**
 * D1-05 trên Postgres THẬT: mã do nhân viên Marketing tạo mang người tạo (createdById), có trần theo cấu hình, nhân viên
 * không sửa lô của quản trị viên và không tự dùng mã mình tạo (kể cả mã công khai và mã thẻ).
 */
describe('Mã giảm giá do nhân viên tạo (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let coupons: CouponsService;
  let claims: CouponClaimService;
  let batches: AdminCouponBatchService;
  let admins: AdminService;
  const future = () => new Date(Date.now() + 30 * 864e5).toISOString();
  const now = () => new Date().toISOString();
  const realUser = (role: 'STAFF' | 'ADMIN' | 'CUSTOMER') =>
    createUser(prisma, {
      role,
      ...(role === 'STAFF' ? { staffPermissions: ['MARKETING'] } : {}),
      phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      zaloId: `z-${randCode(8)}`,
    });
  const batchInput = (over: Record<string, unknown> = {}) => ({
    prefix: `KT${randCode(4).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`,
    quantity: 2,
    type: 'AMOUNT' as const,
    value: 20_000,
    minOrder: 99_000,
    startAt: now(),
    endAt: future(),
    newCustomerOnly: false,
    ...over,
  });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, CouponsService, CouponClaimService, AdminCouponBatchService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    coupons = moduleRef.get(CouponsService);
    claims = moduleRef.get(CouponClaimService);
    batches = moduleRef.get(AdminCouponBatchService);
    const none = {} as never;
    admins = new AdminService(prisma, moduleRef.get(SystemConfigService), none, none, none, none, none, none, none, none);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('nhân viên tạo lô vượt trần mặc định (200.000đ mỗi thẻ) → 403, không có mã nào vào bảng', async () => {
    const staff = await realUser('STAFF');
    const input = batchInput({ value: 250_000, minOrder: 500_000 });
    await expect(batches.create(input, { id: staff.id, staff: true })).rejects.toThrow(ForbiddenException);
    expect(await prisma.coupon.count({ where: { batch: input.prefix } })).toBe(0);
  });

  it('lô nhân viên tạo: mỗi mã ghi người tạo; chính người tạo không nhận được thẻ, khách nhận và áp được', async () => {
    const staff = await realUser('STAFF');
    const customer = await realUser('CUSTOMER');
    const input = batchInput();
    const res = await batches.create(input, { id: staff.id, staff: true });
    const rows = await prisma.coupon.findMany({ where: { batch: res.batch }, select: { code: true, createdById: true, updatedById: true } });
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ createdById: staff.id, updatedById: staff.id });

    const [own, theirs] = rows;
    await expect(claims.claim(staff.id, own!.code)).rejects.toThrow('Mã do chính bạn tạo');
    expect(await prisma.couponClaim.count({ where: { userId: staff.id } })).toBe(0);
    await claims.claim(customer.id, theirs!.code);
    expect((await coupons.validateAndCompute(theirs!.code, customer.id, 200_000)).discount).toBe(20_000);
  });

  it('mã công khai nhân viên tạo: người tạo áp mã bị từ chối; khách áp được', async () => {
    const staff = await realUser('STAFF');
    const customer = await realUser('CUSTOMER');
    const code = `PUB${randCode(6).toUpperCase()}`;
    await prisma.coupon.create({
      data: {
        code,
        type: 'AMOUNT',
        value: 15_000,
        startAt: new Date(Date.now() - 864e5),
        endAt: new Date(Date.now() + 864e5),
        usageLimit: 10,
        perUserLimit: 1,
        scope: 'PUBLIC',
        createdById: staff.id,
      },
    });
    await expect(coupons.validateAndCompute(code, staff.id, 200_000)).rejects.toThrow('Mã do chính bạn tạo');
    expect((await coupons.validateAndCompute(code, customer.id, 200_000)).discount).toBe(15_000);
  });

  it('nhân viên không bật lại lô quản trị viên đã tắt; quản trị viên bật được, ghi người sửa', async () => {
    const admin = await realUser('ADMIN');
    const staff = await realUser('STAFF');
    const res = await batches.create(batchInput(), { id: admin.id, staff: false });
    await batches.setActive(res.batch, false, { id: admin.id, staff: false });
    await expect(batches.setActive(res.batch, true, { id: staff.id, staff: true })).rejects.toThrow(ForbiddenException);
    expect(await prisma.coupon.count({ where: { batch: res.batch, isActive: true } })).toBe(0);
    await batches.setActive(res.batch, true, { id: admin.id, staff: false });
    const rows = await prisma.coupon.findMany({ where: { batch: res.batch }, select: { isActive: true, updatedById: true } });
    expect(rows.every((r) => r.isActive && r.updatedById === admin.id)).toBe(true);
  });

  describe('ngân sách mã theo ngày của nhân viên (mặc định 10.000.000đ)', () => {
    const coupon = (over: Record<string, unknown> = {}) => ({
      code: `NS${randCode(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`,
      type: 'AMOUNT' as const,
      value: 100_000,
      minOrder: 500_000,
      usageLimit: 60,
      startAt: now(),
      endAt: future(),
      scope: 'PUBLIC' as const,
      ...over,
    });
    const settle = async (ps: Promise<unknown>[]) => {
      const out = await Promise.allSettled(ps);
      const rejected = out.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      for (const r of rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
      return { ok: out.length - rejected.length, rejected };
    };

    it('hai mã 6.000.000đ tạo song song sát ngân sách: chỉ một mã được ghi (lặp 5 vòng)', async () => {
      for (let round = 0; round < 5; round++) {
        const staff = await realUser('STAFF');
        const actor = { id: staff.id, staff: true };
        const { ok, rejected } = await settle([admins.createCoupon(coupon(), actor), admins.createCoupon(coupon(), actor)]);
        expect({ round, ok }).toEqual({ round, ok: 1 });
        expect(String((rejected[0]!.reason as Error).message)).toContain('còn 4.000.000đ');
        expect(await prisma.coupon.count({ where: { createdById: staff.id } })).toBe(1);
      }
    });

    it('mã 6.000.000đ và lô 300 thẻ × 20.000đ song song: chỉ một bên được ghi', async () => {
      const staff = await realUser('STAFF');
      const actor = { id: staff.id, staff: true };
      const { ok } = await settle([admins.createCoupon(coupon(), actor), batches.create(batchInput({ quantity: 300 }), actor)]);
      expect(ok).toBe(1);
      const rows = await prisma.coupon.findMany({ where: { createdById: staff.id }, select: { batch: true } });
      expect(rows.length === 1 || (rows.length === 300 && rows.every((r) => r.batch))).toBe(true);
    });

    it('cộng đủ mọi loại mã trong ngày (giảm %, freeship, giảm tiền); sửa tăng lượt tính phần chênh; quản trị viên không bị giới hạn', async () => {
      const staff = await realUser('STAFF');
      const actor = { id: staff.id, staff: true };
      await admins.createCoupon(coupon({ type: 'PERCENT', value: 20, maxDiscount: 50_000, usageLimit: 40 }), actor);
      await admins.createCoupon(coupon({ type: 'FREESHIP', value: 0, minOrder: undefined, usageLimit: 30 }), actor);
      const amount = await admins.createCoupon(coupon({ value: 50_000, usageLimit: 80 }), actor);
      await expect(admins.updateCoupon(amount.id, { usageLimit: 101 }, actor)).rejects.toThrow('còn 1.000.000đ');
      await admins.updateCoupon(amount.id, { usageLimit: 100 }, actor);
      await expect(admins.createCoupon(coupon({ value: 1_000, minOrder: 100_000, usageLimit: 1 }), actor)).rejects.toThrow('còn 0đ');
      const admin = await realUser('ADMIN');
      await admins.createCoupon(coupon({ value: 500_000, minOrder: 1_000_000, usageLimit: 10_000 }), { id: admin.id, staff: false });
    });
  });
});
