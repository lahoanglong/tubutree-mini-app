import { Module } from '@nestjs/common';
import { FlashSaleService } from './flash-sale.service';
import { FlashSaleController } from './flash-sale.controller';
import { FlashSaleAdminController } from './flash-sale-admin.controller';

@Module({
  controllers: [FlashSaleController, FlashSaleAdminController],
  providers: [FlashSaleService],
  exports: [FlashSaleService],
})
export class FlashSaleModule {}
