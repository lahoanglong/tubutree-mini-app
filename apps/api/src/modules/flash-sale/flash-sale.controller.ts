import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { FlashSaleService } from './flash-sale.service';

@Public()
@Controller('flash-sales')
export class FlashSaleController {
  constructor(private readonly flashSale: FlashSaleService) {}

  @Get('active')
  active() {
    return this.flashSale.listActive();
  }
}
