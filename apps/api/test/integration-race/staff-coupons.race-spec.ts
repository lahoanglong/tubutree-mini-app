import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { CouponClaimService } from '../../src/modules/coupons/coupon-claim.service';
import { AdminCouponBatchService } from '../../src/modules/admin/admin-coupon-batch.service';
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
});
