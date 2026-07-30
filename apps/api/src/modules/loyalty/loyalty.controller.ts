import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SystemConfigService } from '../system-config/system-config.service';
import { LoyaltyService } from './loyalty.service';

class RedeemPreviewDto {
  @IsInt() @Min(1) points!: number;
}

@Controller()
export class LoyaltyController {
  constructor(
    private readonly loyalty: LoyaltyService,
    private readonly config: SystemConfigService,
  ) {}

  @Get('me/loyalty')
  overview(@CurrentUser('sub') userId: string) {
    return this.loyalty.getOverview(userId);
  }

  @Get('me/points/transactions')
  transactions(@CurrentUser('sub') userId: string) {
    return this.loyalty.getPointsTransactions(userId);
  }

  @Get('me/coupons')
  coupons(@CurrentUser('sub') userId: string) {
    return this.loyalty.getAvailableCoupons(userId);
  }

  /**
   * Xem trước giá trị quy đổi điểm (việc trừ điểm thực tế diễn ra ở checkout
   * qua field pointsToUse — tránh tạo voucher rời rạc).
   */
  @Post('me/redeem-points')
  async redeemPreview(@Body() dto: RedeemPreviewDto) {
    const vndPerPoint = await this.config.get<number>('loyalty.vnd_per_point_redeem', 1000);
    return {
      points: dto.points,
      value: dto.points * vndPerPoint,
      note: 'Áp điểm khi thanh toán bằng trường pointsToUse, tối đa 20% giá trị đơn.',
    };
  }
}
