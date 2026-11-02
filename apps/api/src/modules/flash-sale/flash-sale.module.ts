import { Module } from '@nestjs/common';
import { FlashSaleService } from './flash-sale.service';
import { FlashSaleController } from './flash-sale.controller';
import { FlashSaleAdminController } from './flash-sale-admin.controller';
import { FlashAllowanceController } from './flash-allowance.controller';
import { FlashAllowanceService } from './flash-allowance.service';
import { LifecycleModule } from '../lifecycle/lifecycle.module';

@Module({
  imports: [LifecycleModule],
  controllers: [FlashSaleController, FlashAllowanceController, FlashSaleAdminController],
  providers: [FlashSaleService, FlashAllowanceService],
  exports: [FlashSaleService],
})
export class FlashSaleModule {}
