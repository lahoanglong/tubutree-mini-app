import { Controller, Get } from '@nestjs/common';
import { FlashSaleService } from './flash-sale.service';

@Controller('flash-sales')
export class FlashSaleController {
  constructor(private readonly flashSale: FlashSaleService) {}

  @Get('active')
  active() {
    return this.flashSale.listActive();
  }
}
