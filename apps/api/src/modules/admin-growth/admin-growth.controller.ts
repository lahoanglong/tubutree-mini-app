import { Controller, Get, Query } from '@nestjs/common';
import { toGrowthWindowDays } from '@tubutree/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminGrowthService } from './admin-growth.service';

@Roles('ADMIN')
@Controller('admin/growth')
export class AdminGrowthController {
  constructor(private readonly growth: AdminGrowthService) {}

  /** Phễu mua, tỷ lệ mua lần 2, người chơi game đặt đơn và số theo ngày cho 7 hoặc 30 ngày (giá trị khác 30 coi là 7). Chỉ số đếm. */
  @Get('overview')
  overview(@Query('days') days?: string) {
    return this.growth.overview(toGrowthWindowDays(days));
  }
}
