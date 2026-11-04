import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ImageRegistryModule } from '../catalog/image-registry.module';
import { CampaignsAdminController } from './campaigns-admin.controller';
import { CampaignsAdminService } from './campaigns-admin.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

// CatalogModule không import module này: Trang chủ đọc banner bằng `listLiveBanners(prisma, …)` để khỏi vòng phụ thuộc.
@Module({
  imports: [CatalogModule, ImageRegistryModule],
  controllers: [CampaignsController, CampaignsAdminController],
  providers: [CampaignsService, CampaignsAdminService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
