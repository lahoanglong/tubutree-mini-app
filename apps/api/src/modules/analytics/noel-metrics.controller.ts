import { Controller, Get, Query } from '@nestjs/common';
import type { NoelMetricsDTO } from '@tubutree/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { NoelMetricsService } from './noel-metrics.service';
import { parseNoelDays } from './noel-metrics-window';

@Roles('ADMIN')
@Controller('admin/analytics')
export class NoelMetricsController {
  constructor(private readonly noel: NoelMetricsService) {}

  /** Số liệu Noel Xanh cho tab "Noel" (1, 7 hoặc 14 ngày giờ VN): chỉ đọc, chỉ số đếm, API giữ kết quả 60 giây. */
  @Get('noel')
  snapshot(@Query('days') days?: string): Promise<NoelMetricsDTO> {
    return this.noel.getSnapshot(parseNoelDays(days));
  }
}
