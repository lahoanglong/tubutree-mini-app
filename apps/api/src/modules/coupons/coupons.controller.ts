import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CouponClaimService } from './coupon-claim.service';

export class ClaimCouponDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;
}

@Controller('coupons')
export class CouponsController {
  constructor(private readonly claims: CouponClaimService) {}

  /** Nhận mã từ thẻ QR (`?claim=`) vào ví. Gọi lại với mã đã nhận trả kết quả cũ. Throttle theo khách chặn dò mã thẻ. */
  @Post('claim')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  claim(@CurrentUser('sub') userId: string, @Body() dto: ClaimCouponDto) {
    return this.claims.claim(userId, dto.code);
  }
}
