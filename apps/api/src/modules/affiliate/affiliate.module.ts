import { Global, Module } from '@nestjs/common';
import { PancakeModule } from '../integrations/pancake/pancake.module';
import { WalletModule } from '../wallet/wallet.module';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { ImageRegistryModule } from '../catalog/image-registry.module';
import { AffiliateService } from './affiliate.service';
import { AffiliateController } from './affiliate.controller';
import { PayoutAdminController } from './payout-admin.controller';
import { CommissionAdminController } from './commission-admin.controller';
import { CommissionAdminService } from './commission-admin.service';

@Global()
@Module({
  // WalletModule → RewardPointsService: thưởng mốc doanh số CTV và giới thiệu cộng Điểm Xanh.
  // FlashSaleModule → FlashSaleService: đơn CTV lên hộ tính giờ vàng như khách tự đặt.
  // ImageRegistryModule → ImageRegistryStale: đăng ký CTV làm gian hàng CTV có sẵn hiện lại.
  imports: [PancakeModule, WalletModule, FlashSaleModule, ImageRegistryModule],
  controllers: [AffiliateController, PayoutAdminController, CommissionAdminController],
  providers: [AffiliateService, CommissionAdminService],
  exports: [AffiliateService],
})
export class AffiliateModule {}
