import { PayrollJob } from './payroll.job';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PayrollService } from './payroll.service';

function mk(members = [{ id: 'u1' }]) {
  const recomputeStaffMonth = jest.fn().mockResolvedValue({});
  const prisma = { user: { findMany: jest.fn().mockResolvedValue(members) } } as unknown as PrismaService;
  const job = new PayrollJob(prisma, { recomputeStaffMonth } as unknown as PayrollService);
  return { job, recomputeStaffMonth };
}

/**
 * Cron chạy 00:30 UTC = 07:30 giờ VN. Lần chạy ngày cuối tháng chưa có ca làm của chính ngày
 * hôm đó, còn lần chạy kế đã sang tháng mới — nên công ngày cuối mỗi tháng không bao giờ được
 * cron đưa vào bảng lương tháng đó.
 */
describe('PayrollJob.nightly — không bỏ sót ngày cuối tháng', () => {
  afterEach(() => jest.useRealTimers());

  it('ngày 2 của tháng mới → tính lại cả tháng trước', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-02T00:30:00.000Z')); // 07:30 VN ngày 2/10
    const { job, recomputeStaffMonth } = mk();

    await job.nightly();

    expect(recomputeStaffMonth).toHaveBeenCalledWith('u1', 2026, 10);
    expect(recomputeStaffMonth).toHaveBeenCalledWith('u1', 2026, 9);
  });

  it('sang năm mới: ngày 1/1 → tính lại tháng 12 năm trước', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-01T00:30:00.000Z'));
    const { job, recomputeStaffMonth } = mk();

    await job.nightly();

    expect(recomputeStaffMonth).toHaveBeenCalledWith('u1', 2026, 12);
  });

  it('giữa tháng → chỉ tính tháng hiện tại (không tốn công quét tháng cũ mỗi ngày)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T00:30:00.000Z'));
    const { job, recomputeStaffMonth } = mk();

    await job.nightly();

    expect(recomputeStaffMonth).toHaveBeenCalledTimes(1);
    expect(recomputeStaffMonth).toHaveBeenCalledWith('u1', 2026, 10);
  });

  it('một nhân sự lỗi → vẫn chạy tiếp người còn lại', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T00:30:00.000Z'));
    const { job, recomputeStaffMonth } = mk([{ id: 'u1' }, { id: 'u2' }]);
    recomputeStaffMonth.mockRejectedValueOnce(new Error('db down'));

    await job.nightly();

    expect(recomputeStaffMonth).toHaveBeenCalledWith('u2', 2026, 10);
  });
});
