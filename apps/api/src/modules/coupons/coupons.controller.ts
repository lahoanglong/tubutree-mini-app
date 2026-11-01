import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { CouponClaimService } from './coupon-claim.service';
import { CouponCollectService } from './coupon-collect.service';

export class ClaimCouponDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;
}

@Controller('coupons')
export class CouponsController {
  constructor(
    private readonly claims: CouponClaimService,
    private readonly collect: CouponCollectService,
  ) {}

  /** Kho mã "Nhận mã": mã listed còn hạn còn lượt, xem được khi chưa đăng nhập. Không có dữ liệu riêng của khách nên cache chung được. */
  @Public()
  @PublicCache('CATALOG')
  @Get('collectable')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  collectable() {
    return this.collect.collectable();
  }

  /**
   * Phần riêng của khách trên kho mã: mã đã nhận (kể cả đã dùng hết lượt, mà ví không còn hiện) và mã chỉ-khách-mới khi khách đã có đơn.
   * Để thẻ không mời "Lưu mã" cho mã mà bấm vào chỉ nhận lời từ chối. `private, no-store`: khác với route kho, không để cache nào giữ chung.
   */
  @Get('collectable/mine')
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  collectableMine(@CurrentUser('sub') userId: string) {
    return this.collect.mine(userId);
  }

  /** Nhận mã từ thẻ QR (`?claim=`) vào ví. Gọi lại với mã đã nhận trả kết quả cũ. Throttle theo khách chặn dò mã thẻ. */
  @Post('claim')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  claim(@CurrentUser('sub') userId: string, @Body() dto: ClaimCouponDto) {
    return this.claims.claim(userId, dto.code);
  }
}
