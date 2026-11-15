import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { WasteCatalogModule } from '../waste-exchange/catalog/waste-catalog.module';

@Module({
  imports: [FlashSaleModule, StorefrontModule, WasteCatalogModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
