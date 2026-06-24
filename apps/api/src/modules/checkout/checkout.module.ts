import { Module } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { CartModule } from '../cart/cart.module';
import { PancakeModule } from '../integrations/pancake/pancake.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [CartModule, PancakeModule, WalletModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
