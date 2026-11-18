import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { VitalsSummaryService, parseVitalsWindow } from './vitals-summary.service';

@Roles('ADMIN')
@Controller('admin/perf')
export class VitalsAdminController {
  constructor(private readonly vitals: VitalsSummaryService) {}

  /** Tốc độ trên máy khách 7 hoặc 28 ngày (mặc định 7): p75 theo mẫu route và nhóm khung nhìn, không có định danh khách. */
  @Get('vitals')
  summary(@Query('days') days?: string) {
    return this.vitals.summary(parseVitalsWindow(days));
  }
}
