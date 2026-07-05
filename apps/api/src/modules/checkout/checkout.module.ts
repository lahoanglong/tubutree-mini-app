import { Module } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { CartModule } from '../cart/cart.module';
import { PancakeModule } from '../integrations/pancake/pancake.module';
import { WalletModule } from '../wallet/wallet.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';

@Module({
  imports: [CartModule, PancakeModule, WalletModule, StorefrontModule, FlashSaleModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
