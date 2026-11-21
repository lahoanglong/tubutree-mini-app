import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AllowStaff } from '../../../common/staff-permissions';
import { PrismaService } from '../../../prisma/prisma.service';
import { streamCsv } from '../admin-export';
import { ReportRangeQuery } from '../admin-reports.controller';
import { AdminService } from '../admin.service';
import { EXPORT_MAX_DAYS, resolveReportRange } from '../report-range';
import { accountingCsvChunks } from './accounting-export';

/**
 * File đối soát doanh thu và hoàn tiền theo đơn cho kế toán. Chỉ ADMIN và nhân viên KE_TOAN, cùng quyền với các file tài chính khác ở
 * `admin/reports`. Đặt ở controller riêng để không đụng AdminReportsController.
 */
@Roles('ADMIN')
@Controller('admin/reports')
export class AccountingExportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
  ) {}

  /** `?from=YYYY-MM-DD&to=YYYY-MM-DD` theo ngày đặt giờ VN, tính cả hai đầu, tối đa 366 ngày (thiếu thì 30 ngày gần nhất). */
  @AllowStaff('KE_TOAN')
  @Get('accounting-export')
  async exportAccounting(@Query() q: ReportRangeQuery, @Res() res: Response, @CurrentUser('sub') actorId?: string) {
    const range = resolveReportRange(q.from, q.to, { maxDays: EXPORT_MAX_DAYS });
    await streamCsv(res, `doi-soat-ke-toan-${range.from}-${range.to}.csv`, accountingCsvChunks(this.prisma, range), (n) =>
      this.admin.recordExport(actorId ?? '', 'reports/accounting-export', { from: range.from, to: range.to }, n),
    );
  }
}
