import { Body, Controller, Get, Header, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { clientIp, throttleIpKey } from '../../../common/throttle/throttle.config';
import { GuestCheckoutService } from './guest-checkout.service';
import { GUEST_DEVICE_RE, GuestPlaceOrderDto, GuestQuoteDto } from './dto/guest-checkout.dto';

const ORDER_CODE_RE = /^[A-Za-z0-9-]{4,40}$/;

function deviceOf(header: string | undefined): string {
  if (!header || !GUEST_DEVICE_RE.test(header)) throw new NotFoundException();
  return header;
}

function codeOf(code: string): string {
  if (!ORDER_CODE_RE.test(code)) throw new NotFoundException('Không tìm thấy đơn hàng.');
  return code;
}

/**
 * Đặt hàng trên web không cần đăng nhập (cờ web.guest_checkout_enabled). Khách nhận diện bằng deviceId của trình duyệt trong header
 * `x-guest-device` (không có phiên nào được cấp, đường khác không nhận header này); khoá theo dõi đơn đi trong header `x-order-key`
 * để không nằm trong URL của nhật ký máy chủ.
 */
@Controller('checkout/guest')
export class GuestCheckoutController {
  constructor(private readonly guest: GuestCheckoutService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  quote(@Body() dto: GuestQuoteDto, @Headers('x-guest-device') device: string | undefined, @Req() req: Request) {
    return this.guest.quote({ deviceId: deviceOf(device), ip: throttleIpKey(clientIp(req)) }, dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('orders')
  @HttpCode(HttpStatus.OK)
  placeOrder(
    @Body() dto: GuestPlaceOrderDto,
    @Headers('x-guest-device') device: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    return this.guest.placeOrder({ deviceId: deviceOf(device), ip: throttleIpKey(clientIp(req)) }, dto, idempotencyKey);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Header('Cache-Control', 'no-store')
  @Get('orders/:code')
  track(@Param('code') code: string, @Headers('x-order-key') key: string | undefined) {
    return this.guest.track(codeOf(code), key);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Header('Cache-Control', 'no-store')
  @Get('orders/:code/bank-qr')
  bankQr(@Param('code') code: string, @Headers('x-order-key') key: string | undefined) {
    return this.guest.bankQr(codeOf(code), key);
  }

  /** Cần phiên Zalo: đưa đơn vãng lai của trình duyệt (deviceId) về tài khoản đang đăng nhập. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  claim(@CurrentUser('sub') userId: string, @Headers('x-guest-device') device: string | undefined) {
    return this.guest.claim(userId, deviceOf(device));
  }
}
