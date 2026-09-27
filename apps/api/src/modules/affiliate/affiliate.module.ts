import { Global, Module } from '@nestjs/common';
import { PancakeModule } from '../integrations/pancake/pancake.module';
import { WalletModule } from '../wallet/wallet.module';
import { AffiliateService } from './affiliate.service';
import { AffiliateController } from './affiliate.controller';
import { PayoutAdminController } from './payout-admin.controller';

@Global()
@Module({
  // WalletModule → CoinsService: thưởng mốc doanh số CTV cộng TubuXu (claimMilestone).
  imports: [PancakeModule, WalletModule],
  controllers: [AffiliateController, PayoutAdminController],
  providers: [AffiliateService],
  exports: [AffiliateService],
})
export class AffiliateModule {}
