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

@Module({
  imports: [CartModule, PancakeModule, GomdonModule, WalletModule, StorefrontModule, FlashSaleModule, WasteCoreModule, WasteCustomerModule, WasteCatalogModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, ShippingEstimateService],
})
export class CheckoutModule {}
