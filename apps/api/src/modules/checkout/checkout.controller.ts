import { Body, Controller, Get, Headers, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CheckoutService } from './checkout.service';
import { CouponPreviewDto, PickupOptionsQueryDto, PlaceOrderDto, QuoteDto } from './dto/checkout.dto';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('quote')
  quote(@CurrentUser('sub') userId: string, @Body() dto: QuoteDto) {
    return this.checkout.quote(userId, dto);
  }

  /** Món rác, ngưỡng điểm, trần cân nặng và phiếu thu kèm đang chờ để dựng ngăn chọn thu rác ngay trên thanh toán (chỉ đọc). */
  @Get('pickup-options')
  pickupOptions(@CurrentUser('sub') userId: string, @Query() q: PickupOptionsQueryDto) {
    return this.checkout.pickupOptions(userId, q);
  }

  /** Mức giảm từng mã trong ví cho lần đặt đang xem (chỉ đọc, không áp mã vào giỏ). */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('coupon-previews')
  @HttpCode(200)
  couponPreviews(@CurrentUser('sub') userId: string, @Body() dto: CouponPreviewDto) {
    return this.checkout.couponPreviews(userId, dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('place-order')
  placeOrder(
    @CurrentUser('sub') userId: string,
    @Body() dto: PlaceOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-client-platform') clientPlatform?: string,
  ) {
    const platform = clientPlatform === 'web' ? 'web' : 'miniapp';
    return this.checkout.placeOrder(userId, dto, idempotencyKey, platform);
  }
}
