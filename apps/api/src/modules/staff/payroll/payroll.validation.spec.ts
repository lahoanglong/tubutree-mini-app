import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdjustDto } from './payroll.dto';
import { PayrollService } from './payroll.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';

/** ADMINOPS-15: ngày điều chỉnh phải là ngày có thật; chỉ điều chỉnh/đặt đơn giá cho nhân viên. */
describe('AdjustDto.workDate — ngày có thật', () => {
  const dto = (workDate: string) => plainToInstance(AdjustDto, { staffId: 'u1', workDate, amount: 500_000, reason: 'thưởng' });

  it.each(['2026-02-31', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00'])('%s → lỗi', async (d) => {
    const errors = await validate(dto(d));
    expect(errors.map((e) => e.property)).toContain('workDate');
  });

  it.each(['2026-02-28', '2028-02-29', '2026-12-31'])('%s → hợp lệ', async (d) => {
    expect(await validate(dto(d))).toEqual([]);
  });
});

// R4-ADMIN-9: khoản trừ/thưởng 0đ hay không lý do vẫn được ghi → bảng lương có dòng vô nghĩa, mất dấu vết kiểm toán.
describe('AdjustDto — số tiền khác 0, lý do đủ để đối chiếu', () => {
  const dto = (over: Record<string, unknown>) =>
    plainToInstance(AdjustDto, { staffId: 'u1', workDate: '2026-07-03', amount: 20_000, reason: 'trễ ca sáng', ...over });
  const props = async (over: Record<string, unknown>) => (await validate(dto(over))).map((e) => e.property);

  it('số tiền 0 → lỗi ở amount', async () => {
    expect(await props({ amount: 0 })).toContain('amount');
  });

  it.each(['', '   ', 'ab', ' x '])('lý do %p → lỗi ở reason', async (reason) => {
    expect(await props({ reason })).toContain('reason');
  });

  it('lý do được cắt khoảng trắng hai đầu trước khi kiểm và lưu', async () => {
    const d = dto({ reason: '  trễ  ' });
    expect(await validate(d)).toEqual([]);
    expect(d.reason).toBe('trễ');
  });

  it('thưởng (âm) và trừ (dương) đều hợp lệ; allowDuplicate chỉ nhận true/false', async () => {
    expect(await props({ amount: -50_000 })).toEqual([]);
    expect(await props({ amount: 50_000, allowDuplicate: true })).toEqual([]);
    expect(await props({ allowDuplicate: 'yes' })).toContain('allowDuplicate');
  });
});

describe('PayrollService — chỉ áp cho nhân viên', () => {
  const config = { get: jest.fn(async (_k: string, d: unknown) => d) } as unknown as SystemConfigService;
  const prismaWith = (user: { role: string; staffProfile: { active: boolean } | null } | null) => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      payrollMonth: { findUnique: jest.fn().mockResolvedValue(null) },
      staffProfile: { upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    return prisma;
  };

  it('điều chỉnh lương cho tài khoản khách (không phải nhân viên, không có hồ sơ lương) → 400, không ghi', async () => {
    const prisma = prismaWith({ role: 'CUSTOMER', staffProfile: null });
    const svc = new PayrollService(prisma as unknown as PrismaService, config);
    await expect(svc.adjust('u_cust', new Date('2026-02-10T00:00:00Z'), 500_000, 'x', 'a1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('người không tồn tại → 400', async () => {
    const prisma = prismaWith(null);
    const svc = new PayrollService(prisma as unknown as PrismaService, config);
    await expect(svc.adjust('nope', new Date('2026-02-10T00:00:00Z'), 1, 'x', 'a1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('đặt đơn giá cho khách → 400, không tạo hồ sơ lương', async () => {
    const prisma = prismaWith({ role: 'CUSTOMER', staffProfile: null });
    const svc = new PayrollService(prisma as unknown as PrismaService, config);
    await expect(svc.setRate('u_cust', 30_000)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.staffProfile.upsert).not.toHaveBeenCalled();
  });

  it('đặt đơn giá cho STAFF → ghi', async () => {
    const prisma = prismaWith({ role: 'STAFF', staffProfile: null });
    const svc = new PayrollService(prisma as unknown as PrismaService, config);
    await svc.setRate('u_staff', 30_000);
    expect(prisma.staffProfile.upsert).toHaveBeenCalled();
  });

  it('cựu nhân viên đã hạ quyền nhưng còn hồ sơ lương active → vẫn điều chỉnh được kỳ cũ', async () => {
    const prisma = prismaWith({ role: 'CUSTOMER', staffProfile: { active: true } });
    prisma.$transaction.mockResolvedValue(null);
    const svc = new PayrollService(prisma as unknown as PrismaService, config);
    await expect(svc.adjust('u_old', new Date('2026-02-10T00:00:00Z'), 1, 'x', 'a1')).resolves.toMatchObject({ adjusted: true });
  });
});
