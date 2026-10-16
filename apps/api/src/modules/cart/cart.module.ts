import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { StorefrontModule } from '../storefront/storefront.module';

@Module({
  imports: [FlashSaleModule, StorefrontModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
