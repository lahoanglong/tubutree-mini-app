import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ProductCompareService } from './product-compare.service';
import { SearchMatchService } from './search-match.service';
import { SearchPopularService } from './search-popular.service';
import { SearchZeroResultsService } from './search-synonyms-zero-results.service';
import { SearchSynonymsAdminController } from './search-synonyms-admin.controller';
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
import { CatalogQualityController } from './catalog-quality.controller';
import { CatalogAuditService } from './catalog-audit.service';
import { CopyDraftService } from './copy-draft.service';
import { CopyApproveService } from './copy-approve.service';
import { IngredientEnrichService } from './ingredient-enrich.service';
import { SeoEnrichService } from './seo-enrich.service';
import { CategoryAdminController } from './category-admin.controller';
import { CategoryAdminService } from './category-admin.service';
import { ProductCategoryAdminController } from './product-category-admin.controller';
import { ProductCategoryAdminService } from './product-category-admin.service';
import { CategorySuggestionController } from './category-suggestion.controller';
import { CategorySuggestionService } from './category-suggestion.service';
import { WpImageSyncController } from './wp-image-sync.controller';
import { WpImageSyncService } from './wp-image-sync.service';
import { FreeshipUpsellController } from './upsell/freeship-upsell.controller';
import { FreeshipUpsellService } from './upsell/freeship-upsell.service';
import { RefillPairsController } from './refill/refill-pairs.controller';
import { RefillPairsAdminController } from './refill/refill-pairs-admin.controller';
import { RefillPairsService } from './refill/refill-pairs.service';
import { ImageRegistryModule } from './image-registry.module';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { OrdersModule } from '../orders/orders.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AiAdvisorModule } from '../ai-advisor/ai-advisor.module';
import { EcoImpactModule } from '../eco-impact/eco-impact.module';

@Module({
  imports: [ImageRegistryModule, FlashSaleModule, OrdersModule, SubscriptionsModule, AiAdvisorModule, EcoImpactModule],
  controllers: [CatalogController, SearchSynonymsAdminController, HomeController, CategoryAdminController, ProductCategoryAdminController, CategorySuggestionController, ProductAdminController, StoryAssetsController, StoryDraftController, CatalogQualityController, WpImageSyncController, PublicImageController, ImageResizeController, FreeshipUpsellController, RefillPairsController, RefillPairsAdminController],
  providers: [CatalogService, ProductCompareService, SearchMatchService, SearchPopularService, SearchZeroResultsService, HomeService, CategoryAdminService, ProductCategoryAdminService, CategorySuggestionService, ProductAdminService, StoryAssetsService, StoryDraftService, CatalogAuditService, CopyDraftService, CopyApproveService, IngredientEnrichService, SeoEnrichService, WpImageSyncService, PublicImageService, ImageResizeService, FreeshipUpsellService, RefillPairsService],
  exports: [CatalogService, ImageResizeService, RefillPairsService],
})
export class CatalogModule {}
