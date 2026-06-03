import { Body, Controller, Headers, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CheckoutService } from './checkout.service';
import { PlaceOrderDto, QuoteDto } from './dto/checkout.dto';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('quote')
  quote(@CurrentUser('sub') userId: string, @Body() dto: QuoteDto) {
    return this.checkout.quote(userId, dto);
  }

  @Post('place-order')
  placeOrder(
    @CurrentUser('sub') userId: string,
    @Body() dto: PlaceOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.checkout.placeOrder(userId, dto, idempotencyKey);
  }
}
