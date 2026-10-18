import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { assertActiveAdmin } from '../../../common/staff-access';
import { vnMonthKey } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteReportsService } from './waste-reports.service';

export class WasteMonthQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Tháng phải có dạng YYYY-MM.' })
  month?: string;
}

const monthOf = (q: WasteMonthQueryDto): string => q.month ?? vnMonthKey(new Date());

@Controller()
export class WasteReportsController {
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
    res.setHeader('Content-Disposition', `attachment; filename="doi-rac-${month}.csv"`);
    return text;
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
