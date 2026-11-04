import { Controller, Get, Logger, Header, Param, Query, Res } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { assertActiveAdmin } from '../../../common/staff-access';
import { vnMonthKey } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { createCsvRecordCounter } from '../../admin/admin-export';
import { WasteReportsService } from './waste-reports.service';

export class WasteMonthQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Tháng phải có dạng YYYY-MM.' })
  month?: string;
}

const monthOf = (q: WasteMonthQueryDto): string => q.month ?? vnMonthKey(new Date());

@Controller()
export class WasteReportsController {
  private readonly logger = new Logger(WasteReportsController.name);

  constructor(
    private readonly reports: WasteReportsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('admin/waste/overview')
  @Roles('ADMIN')
  async overview(@CurrentUser('sub') userId: string, @Query() q: WasteMonthQueryDto) {
    await assertActiveAdmin(this.prisma, userId);
    return this.reports.overview(monthOf(q));
  }

  @Get('admin/waste/reports/monthly')
  @Roles('ADMIN')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async monthlyCsv(@CurrentUser('sub') userId: string, @Query() q: WasteMonthQueryDto, @Res({ passthrough: true }) res: Response) {
    await assertActiveAdmin(this.prisma, userId);
    const month = monthOf(q);
    const text = await this.reports.csv(month);
    const counter = createCsvRecordCounter();
    counter.push(text);
    await this.logExport(userId, month, counter.dataRows());
    res.setHeader('Content-Disposition', `attachment; filename="doi-rac-${month}.csv"`);
    return text;
  }

  /** Cùng bảng nhật ký với các CSV khác của admin: ai xuất, tháng nào, bao nhiêu dòng. Lỗi ghi chỉ log, không chặn file. */
  private async logExport(actorId: string, month: string, rowCount: number): Promise<void> {
    try {
      await this.prisma.adminExportLog.create({ data: { actorId, route: 'admin/waste/reports/monthly', filters: { month }, rowCount } });
    } catch (err) {
      this.logger.error(`Không ghi được nhật ký xuất doi-rac ${month} của ${actorId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  @Get('admin/waste/points/:id/report')
  @Roles('ADMIN')
  async adminPointReport(@CurrentUser('sub') userId: string, @Param('id') id: string, @Query() q: WasteMonthQueryDto) {
    await assertActiveAdmin(this.prisma, userId);
    return this.reports.adminPointReport(id, monthOf(q));
  }

  @Get('waste/desk/points/:pointId/report')
  deskPointReport(@CurrentUser('sub') userId: string, @Param('pointId') pointId: string, @Query() q: WasteMonthQueryDto) {
    return this.reports.pointReport(userId, pointId, monthOf(q));
  }
}
