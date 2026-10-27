import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { PublicImageController } from './public-image.controller';
import { PublicImageService } from './public-image.service';
import { ProductAdminController } from './product-admin.controller';
import { ProductAdminService } from './product-admin.service';
import { ProductCategoryAdminController } from './product-category-admin.controller';
import { ProductCategoryAdminService } from './product-category-admin.service';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { OrdersModule } from '../orders/orders.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [FlashSaleModule, OrdersModule, SubscriptionsModule],
  controllers: [CatalogController, HomeController, ProductCategoryAdminController, ProductAdminController, PublicImageController],
  providers: [CatalogService, HomeService, ProductCategoryAdminService, ProductAdminService, PublicImageService],
  exports: [CatalogService],
})
export class CatalogModule {}
