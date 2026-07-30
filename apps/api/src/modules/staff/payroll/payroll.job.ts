import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PayrollService } from './payroll.service';

@Injectable()
export class PayrollJob {
  private readonly logger = new Logger(PayrollJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
  ) {}

  /** Mỗi ngày 00:30: tính lại lương tháng hiện tại cho toàn bộ nhân sự (idempotent). */
  @Cron('30 0 * * *')
  async nightly(): Promise<void> {
    const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const year = vn.getUTCFullYear();
    const month = vn.getUTCMonth() + 1;
    const members = await this.prisma.user.findMany({
      where: { role: { in: ['STAFF', 'ADMIN'] } },
      select: { id: true },
    });
    let ok = 0;
    for (const m of members) {
      try {
        await this.payroll.recomputeStaffMonth(m.id, year, month);
        ok++;
      } catch (e) {
        this.logger.error(`recompute lương ${m.id} lỗi: ${(e as Error).message}`);
      }
    }
    if (members.length > 0) this.logger.log(`Nightly payroll: recompute ${ok}/${members.length} NV (T${month}/${year}).`);
  }
}
