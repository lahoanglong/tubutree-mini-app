import { Body, Controller, Get, Header, Headers, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { clientIp, throttleIpKey } from '../../common/throttle/throttle.config';
import type { Env } from '../../config/env.validation';
import { flashIpHash } from '../flash-sale/flash-buyer-keys';
import { CheckoutService } from './checkout.service';
import { ShippingEstimateService } from './shipping-estimate.service';
import { CouponPreviewDto, PickupOptionsQueryDto, PlaceOrderDto, QuoteDto } from './dto/checkout.dto';
import { ShippingEstimateQueryDto } from './dto/shipping-estimate.dto';

@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly shippingEstimate: ShippingEstimateService,
    private readonly env: ConfigService<Env, true>,
  ) {}

  /** IP của lần gọi, gom và băm như khách web vãng lai: khoá giới hạn Giờ vàng khi người mua chưa xác thực (tài khoản `guest_` Mini). */
  private ipHash(req: Request): string | null {
    return flashIpHash(throttleIpKey(clientIp(req)), this.env.get('JWT_ACCESS_SECRET', { infer: true }));
  }

  /**
   * Phí giao ước tính cho giỏ và trang sản phẩm, trước khi có địa chỉ. Công khai; có phiên thì tính theo hạng, ưu đãi đơn đầu và địa chỉ
   * mặc định của chính khách. Kết quả khác nhau theo người gọi nên chỉ trình duyệt được giữ (private + Vary), proxy không giữ chung.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Header('Cache-Control', 'private, max-age=300')
  @Header('Vary', 'Origin, Authorization')
  @Get('shipping-estimate')
  estimateShipping(@Query() q: ShippingEstimateQueryDto, @CurrentUser('sub') userId?: string) {
    return this.shippingEstimate.estimate(userId, { subtotal: q.subtotal, provinceCode: q.provinceCode });
  }

  @Post('quote')
  quote(@CurrentUser('sub') userId: string, @Body() dto: QuoteDto, @Req() req: Request) {
    return this.checkout.quote(userId, dto, false, this.ipHash(req));
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
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-client-platform') clientPlatform: string | undefined,
    @Req() req: Request,
  ) {
    const platform = clientPlatform === 'web' ? 'web' : 'miniapp';
    return this.checkout.placeOrder(userId, dto, idempotencyKey, platform, undefined, this.ipHash(req));
  }
}
