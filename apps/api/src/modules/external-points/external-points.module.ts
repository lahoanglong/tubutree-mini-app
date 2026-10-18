import { Module } from '@nestjs/common';
import { PancakeSyncHooksModule } from '../integrations/pancake/pancake-sync-hooks.module';
import { ExternalClaimCron } from './external-claim.cron';
import { ExternalClaimLookupService } from './external-claim-lookup.service';
import { ExternalClaimPollService } from './external-claim-poll.service';
import { ExternalClaimService } from './external-claim.service';
import { ExternalClaimsAdminController } from './external-claims-admin.controller';
import { ExternalClaimsAdminService } from './external-claims-admin.service';
import { ExternalClaimsController } from './external-claims.controller';
import { ExternalOrdersAdminController } from './external-orders-admin.controller';
import { ExternalOrdersAdminService } from './external-orders-admin.service';

@Module({
  imports: [PancakeSyncHooksModule],
  controllers: [ExternalOrdersAdminController, ExternalClaimsController, ExternalClaimsAdminController],
  providers: [
    ExternalOrdersAdminService,
    ExternalClaimService,
    ExternalClaimLookupService,
    ExternalClaimPollService,
    ExternalClaimsAdminService,
    ExternalClaimCron,
  ],
})
export class ExternalPointsModule {}
