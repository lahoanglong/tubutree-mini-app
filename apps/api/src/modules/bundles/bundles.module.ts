import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { BundlesAdminController } from './bundles-admin.controller';
import { BundlesAdminService } from './bundles-admin.service';
import { BundlesController } from './bundles.controller';
import { BundlesService } from './bundles.service';

// ComboService (StorefrontModule) chỉ dùng hàm thuần `bundle-read`/`bundle-rules`, không import module này: khỏi vòng phụ thuộc.
@Module({
  imports: [CatalogModule],
  controllers: [BundlesController, BundlesAdminController],
  providers: [BundlesService, BundlesAdminService],
  exports: [BundlesService],
})
export class BundlesModule {}
