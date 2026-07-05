import { Module } from '@nestjs/common';
import { FlashSaleService } from './flash-sale.service';

@Module({
  providers: [FlashSaleService],
  exports: [FlashSaleService],
})
export class FlashSaleModule {}
