import { Module } from '@nestjs/common';
import { LifecycleService } from './lifecycle.service';
import { RemarketingService } from './remarketing.service';
import { ReviewInviteService } from './review-invite.service';

@Module({
  providers: [LifecycleService, RemarketingService, ReviewInviteService],
  exports: [LifecycleService, RemarketingService],
})
export class LifecycleModule {}
