import { Module } from '@nestjs/common';
import { AdminGrowthController } from './admin-growth.controller';
import { AdminGrowthService } from './admin-growth.service';

/** PurchaseFunnelService đến từ AnalyticsModule (@Global), dùng chung bộ đệm với bảng Theo dõi 72h. */
@Module({
  controllers: [AdminGrowthController],
  providers: [AdminGrowthService],
})
export class AdminGrowthModule {}
