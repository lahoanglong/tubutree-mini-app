import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { PublicImageController } from './public-image.controller';
import { PublicImageService } from './public-image.service';
import { ImageResizeController } from './image-resize.controller';
import { ImageResizeService } from './image-resize.service';
import { ProductAdminController } from './product-admin.controller';
import { ProductAdminService } from './product-admin.service';
import { StoryAssetsController } from './story-assets.controller';
import { StoryAssetsService } from './story-assets.service';
import { StoryDraftController } from './story-draft.controller';
import { StoryDraftService } from './story-draft.service';
import { CategoryAdminController } from './category-admin.controller';
import { CategoryAdminService } from './category-admin.service';
import { ProductCategoryAdminController } from './product-category-admin.controller';
import { ProductCategoryAdminService } from './product-category-admin.service';
import { ImageRegistryModule } from './image-registry.module';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { OrdersModule } from '../orders/orders.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AiAdvisorModule } from '../ai-advisor/ai-advisor.module';

@Module({
  imports: [ImageRegistryModule, FlashSaleModule, OrdersModule, SubscriptionsModule, AiAdvisorModule],
  controllers: [CatalogController, HomeController, CategoryAdminController, ProductCategoryAdminController, ProductAdminController, StoryAssetsController, StoryDraftController, PublicImageController, ImageResizeController],
  providers: [CatalogService, HomeService, CategoryAdminService, ProductCategoryAdminService, ProductAdminService, StoryAssetsService, StoryDraftService, PublicImageService, ImageResizeService],
  exports: [CatalogService, ImageResizeService],
})
export class CatalogModule {}
