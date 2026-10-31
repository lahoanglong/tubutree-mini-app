import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

// CatalogModule không import module này: Trang chủ đọc banner bằng `listLiveBanners(prisma, …)` để khỏi vòng phụ thuộc.
@Module({
  imports: [CatalogModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
