import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { WasteCatalogModule } from '../waste-exchange/catalog/waste-catalog.module';
import { GiftTiersModule } from '../gift-tiers/gift-tiers.module';

@Module({
  imports: [FlashSaleModule, StorefrontModule, WasteCatalogModule, GiftTiersModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
