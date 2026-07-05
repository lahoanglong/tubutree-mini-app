import { Module } from '@nestjs/common';
import { LifecycleService } from './lifecycle.service';
import { RemarketingService } from './remarketing.service';

@Module({
  providers: [LifecycleService, RemarketingService],
  exports: [LifecycleService, RemarketingService],
})
export class LifecycleModule {}
