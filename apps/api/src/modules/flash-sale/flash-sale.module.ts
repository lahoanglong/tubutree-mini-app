import { Module } from '@nestjs/common';
import { FlashSaleService } from './flash-sale.service';
import { FlashSaleController } from './flash-sale.controller';
import { FlashSaleAdminController } from './flash-sale-admin.controller';
import { LifecycleModule } from '../lifecycle/lifecycle.module';

@Module({
  imports: [LifecycleModule],
  controllers: [FlashSaleController, FlashSaleAdminController],
  providers: [FlashSaleService],
  exports: [FlashSaleService],
})
export class FlashSaleModule {}
