import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollService } from '../../src/modules/staff/payroll/payroll.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { createUser, warmPool } from './helpers';

/**
 * R4-ADMIN-9 trên Postgres THẬT: khoản điều chỉnh lương giống hệt (cùng nhân viên, ngày, số tiền, lý do) gửi lại trong
 * 5 phút trước đây được "bỏ qua" nhưng vẫn trả {adjusted: true} — admin tưởng đã ghi khoản phạt thứ hai. Giờ: đúng một
 * bản ghi, mọi lần gửi trùng khác nhận 409 PAYROLL_ADJUST_DUPLICATE; admin xác nhận (allowDuplicate) thì ghi thêm.
 */
describe('Điều chỉnh lương gửi trùng (real Postgres)', () => {
  let prisma: PrismaService;
  let payroll: PayrollService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const config = { get: async (_k: string, d: unknown) => d } as unknown as SystemConfigService;
    payroll = new PayrollService(prisma, config);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function staff() {
    const u = await createUser(prisma, { role: 'STAFF' });
    await prisma.staffProfile.create({ data: { userId: u.id, hourlyRate: 30_000 } });
    return u;
  }

  it('5 request giống hệt cùng lúc → 1 bản ghi, 4 lần nhận 409 có mã, không lần nào "thành công" giả', async () => {
    const s = await staff();
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const day = new Date('2026-07-03T00:00:00.000Z');
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => payroll.adjust(s.id, day, 20_000, 'trễ ca sáng', admin.id)),
    );
    const ok = results.filter((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ok[0]!.value).toEqual({ adjusted: true });
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(ConflictException);
      expect((r.reason as ConflictException).getResponse()).toMatchObject({ code: 'PAYROLL_ADJUST_DUPLICATE' });
    }
    expect(await prisma.payrollAdjustment.count({ where: { staffId: s.id, type: 'MANUAL' } })).toBe(1);
    const dayRow = await prisma.payrollDay.findFirst({ where: { staffId: s.id, workDate: day } });
    expect(dayRow?.fines).toBe(20_000);
  });

  it('admin xác nhận khoản thứ hai giống hệt (allowDuplicate) → ghi thêm, bảng lương ngày trừ đủ hai lần', async () => {
    const s = await staff();
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const day = new Date('2026-07-04T00:00:00.000Z');
    await payroll.adjust(s.id, day, 20_000, 'trễ ca sáng', admin.id);
    await expect(payroll.adjust(s.id, day, 20_000, 'trễ ca sáng', admin.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(payroll.adjust(s.id, day, 20_000, 'trễ ca sáng', admin.id, { allowDuplicate: true })).resolves.toEqual({
      adjusted: true,
    });
    expect(await prisma.payrollAdjustment.count({ where: { staffId: s.id, type: 'MANUAL' } })).toBe(2);
    const dayRow = await prisma.payrollDay.findFirst({ where: { staffId: s.id, workDate: day } });
    expect(dayRow?.fines).toBe(40_000);
  });

  it('khác số tiền hoặc lý do cùng ngày → không phải trùng, ghi bình thường', async () => {
    const s = await staff();
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const day = new Date('2026-07-05T00:00:00.000Z');
    await Promise.all([
      payroll.adjust(s.id, day, 20_000, 'trễ ca sáng', admin.id),
      payroll.adjust(s.id, day, 30_000, 'trễ ca sáng', admin.id),
      payroll.adjust(s.id, day, 20_000, 'quên chấm công', admin.id),
    ]);
    expect(await prisma.payrollAdjustment.count({ where: { staffId: s.id, type: 'MANUAL' } })).toBe(3);
  });
});
