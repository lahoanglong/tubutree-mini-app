import { Global, Module } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { CouponCleanupCron } from './coupon-cleanup.cron';

@Global()
@Module({
  providers: [CouponsService, CouponCleanupCron],
  exports: [CouponsService],
})
export class CouponsModule {}
