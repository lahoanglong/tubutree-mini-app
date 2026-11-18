import { Module } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { ShippingEstimateService } from './shipping-estimate.service';
import { CartModule } from '../cart/cart.module';
import { PancakeModule } from '../integrations/pancake/pancake.module';
import { GomdonModule } from '../integrations/gomdon/gomdon.module';
import { WalletModule } from '../wallet/wallet.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { WasteCatalogModule } from '../waste-exchange/catalog/waste-catalog.module';
import { WasteCoreModule } from '../waste-exchange/core/waste-core.module';
import { WasteCustomerModule } from '../waste-exchange/customer/waste-customer.module';
import { GiftTiersModule } from '../gift-tiers/gift-tiers.module';

@Module({
  imports: [CartModule, PancakeModule, GomdonModule, WalletModule, StorefrontModule, FlashSaleModule, WasteCoreModule, WasteCustomerModule, WasteCatalogModule, GiftTiersModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, ShippingEstimateService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
