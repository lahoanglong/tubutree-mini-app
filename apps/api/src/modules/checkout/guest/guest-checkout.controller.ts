import { Body, Controller, Get, Header, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { GUEST_LOOKUP_LIMIT } from '@tubutree/shared-types';
import { clientIp, LookupThrottle, throttleIpKey, ThrottleRefusalMessage } from '../../../common/throttle/throttle.config';
import { GuestCheckoutService } from './guest-checkout.service';
import {
  GUEST_DEVICE_RE,
  GUEST_MOBILE_RE,
  GuestLookupDto,
  GuestPlaceOrderDto,
  GuestQuoteDto,
  normalizeLookupCode,
  normalizeLookupPhone,
} from './dto/guest-checkout.dto';

const ORDER_CODE_RE = /^[A-Za-z0-9-]{4,40}$/;
/** Tra đơn bằng mã + SĐT: mỗi mã đơn tối đa chừng này lượt/phút dù gửi từ bao nhiêu IP (SĐT có ~10^8 giá trị nên không dò cạn được). */
export const GUEST_LOOKUP_CODE_LIMIT = 10;
/** Mỗi IP tối đa chừng này lượt tra/phút trên mọi mã: bằng trần IP của đăng nhập vì nhiều thuê bao di động chung một IP (CGNAT). */
export const GUEST_LOOKUP_IP_LIMIT = 30;
/** Mỗi SĐT tối đa chừng này lượt tra mỗi 15 phút trên mọi mã và mọi IP: mã ngắn chỉ có ~10^6 giá trị mỗi tiền tố (mã dài cũ 10^5 mỗi ngày) nên biết SĐT là dò được mã nếu không chặn. */
export const GUEST_LOOKUP_PHONE_LIMIT = 10;
export const GUEST_LOOKUP_PHONE_TTL_MS = 15 * 60_000;
/** Câu 429 của route tra cứu (mọi trần: mã, IP, SĐT), kèm số phút còn bị chặn của trần vừa chạm. */
export const guestLookupLimitMessage = (minutes: number) => `Bạn tra hơi nhiều lần. Thử lại sau ${minutes} phút nhé.`;

/** Định danh đếm trần của route tra cứu: mã đơn đã chuẩn hoá như DTO (gõ thường hay có dấu cách vẫn chung một bộ đếm). */
export function lookupThrottleId(req: Request): string | undefined {
  const code = normalizeLookupCode((req.body as { orderCode?: unknown } | undefined)?.orderCode);
  return typeof code === 'string' && code !== '' ? code : undefined;
}

/** Định danh đếm trần theo SĐT: chuẩn hoá như DTO; không phải số di động (DTO sẽ trả 400) thì không có định danh. */
export function lookupPhoneThrottleId(req: Request): string | undefined {
  const phone = normalizeLookupPhone((req.body as { phone?: unknown } | undefined)?.phone);
  return typeof phone === 'string' && GUEST_MOBILE_RE.test(phone) ? phone : undefined;
}

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

  /** Đổi đơn chuyển khoản chưa trả sang trả tiền khi nhận (COD). Không đổi được: 409 COD_SWITCH_REFUSED kèm `reason`. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Header('Cache-Control', 'no-store')
  @Post('orders/:code/switch-to-cod')
  @HttpCode(HttpStatus.OK)
  switchToCod(@Param('code') code: string, @Headers('x-order-key') key: string | undefined) {
    return this.guest.switchToCod(codeOf(code), key);
  }

  /** Món mua lại được của đơn đã giao/đã huỷ (không ghi gì): trình duyệt thêm vào giỏ khách. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Header('Cache-Control', 'no-store')
  @Get('orders/:code/reorder')
  reorder(@Param('code') code: string, @Headers('x-order-key') key: string | undefined) {
    return this.guest.reorderLines(codeOf(code), key);
  }

  /** Khách mất đường dẫn theo dõi (đổi máy, xoá dữ liệu trình duyệt): tra bằng mã đơn + SĐT đặt hàng, sai thì cùng một 404. */
  @Public()
  @LookupThrottle(lookupThrottleId, GUEST_LOOKUP_CODE_LIMIT, GUEST_LOOKUP_IP_LIMIT, {
    identify: lookupPhoneThrottleId,
    limit: GUEST_LOOKUP_PHONE_LIMIT,
    ttlMs: GUEST_LOOKUP_PHONE_TTL_MS,
  })
  @ThrottleRefusalMessage({ code: GUEST_LOOKUP_LIMIT, message: guestLookupLimitMessage })
  @Header('Cache-Control', 'no-store')
  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  lookup(@Body() dto: GuestLookupDto) {
    return this.guest.lookup(dto);
  }

  /** Cần phiên Zalo: đưa đơn vãng lai của trình duyệt (deviceId) về tài khoản đang đăng nhập. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  claim(@CurrentUser('sub') userId: string, @Headers('x-guest-device') device: string | undefined) {
    return this.guest.claim(userId, deviceOf(device));
  }
}
