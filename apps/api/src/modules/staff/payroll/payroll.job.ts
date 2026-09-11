import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { PayrollService } from './payroll.service';

@Injectable()
export class PayrollJob {
  private readonly logger = new Logger(PayrollJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
  ) {}

  /**
   * Mỗi ngày 00:30 UTC (07:30 giờ VN): tính lại lương tháng hiện tại cho toàn bộ nhân sự
   * (idempotent).
   *
   * Trong 3 ngày đầu tháng tính lại CẢ THÁNG TRƯỚC: lần chạy 07:30 ngày cuối tháng chưa có ca
   * làm của chính ngày hôm đó, còn lần chạy kế đã sang tháng mới — nên công ngày cuối mỗi
   * tháng không bao giờ được cron đưa vào bảng lương tháng đó.
   */
  @Cron('30 0 * * *')
  async nightly(): Promise<void> {
    const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const year = vn.getUTCFullYear();
    const month = vn.getUTCMonth() + 1;
    const periods: { year: number; month: number }[] = [{ year, month }];
    if (vn.getUTCDate() <= 3) {
      periods.push(month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 });
    }
    const members = await this.prisma.user.findMany({
      where: { role: { in: ['STAFF', 'ADMIN'] } },
      select: { id: true },
    });
    let ok = 0;
    for (const m of members) {
      for (const p of periods) {
        try {
          // recomputeStaffMonth tự bỏ qua tháng đã FINALIZED/PAID nên tính lại là an toàn.
          await this.payroll.recomputeStaffMonth(m.id, p.year, p.month);
        } catch (e) {
          this.logger.error(`recompute lương ${m.id} (T${p.month}/${p.year}) lỗi: ${(e as Error).message}`);
        }
      }
      ok++;
    }
    if (members.length > 0) {
      const label = periods.map((p) => `T${p.month}/${p.year}`).join(' + ');
      this.logger.log(`Nightly payroll: recompute ${ok}/${members.length} NV (${label}).`);
    }
  }
}
