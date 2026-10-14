import { Global, Module } from '@nestjs/common';
import { PancakeModule } from '../integrations/pancake/pancake.module';
import { WalletModule } from '../wallet/wallet.module';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { AffiliateService } from './affiliate.service';
import { AffiliateController } from './affiliate.controller';
import { PayoutAdminController } from './payout-admin.controller';

@Global()
@Module({
  // WalletModule → RewardPointsService: thưởng mốc doanh số CTV và giới thiệu cộng Điểm Xanh.
  // FlashSaleModule → FlashSaleService: đơn CTV lên hộ tính giờ vàng như khách tự đặt.
  imports: [PancakeModule, WalletModule, FlashSaleModule],
  controllers: [AffiliateController, PayoutAdminController],
  providers: [AffiliateService],
  exports: [AffiliateService],
})
export class AffiliateModule {}
