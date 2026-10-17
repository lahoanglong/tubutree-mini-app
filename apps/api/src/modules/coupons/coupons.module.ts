import { Global, Module } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { CouponCleanupCron } from './coupon-cleanup.cron';
import { CouponClaimService } from './coupon-claim.service';
import { CouponsController } from './coupons.controller';

@Global()
@Module({
  controllers: [CouponsController],
  providers: [CouponsService, CouponCleanupCron, CouponClaimService],
  exports: [CouponsService, CouponClaimService],
})
export class CouponsModule {}
