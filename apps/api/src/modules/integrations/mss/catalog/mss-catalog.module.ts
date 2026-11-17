import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ImageRegistryModule } from '../../../catalog/image-registry.module';
import { MssCatalogAdminController, MssCatalogDoorbellController, MssCatalogOpsService } from './mss-catalog.controller';
import { MSS_CATALOG_QUEUE, MssCatalogCron, MssCatalogProcessor, MssCatalogQueue } from './mss-catalog.queue';
import { MssCatalogService } from './mss-catalog.service';
import { MssPreviewController, MssPreviewService } from './mss-preview';

/**
 * Nội dung bổ sung từ MSS (cờ `mss.catalog_enrichment_enabled`, mặc định TẮT): kéo định kỳ + chuông, lưu `product_mss_enrichment`,
 * thẻ Ops, bản xem trước bản nháp. Cờ tắt thì cron chỉ ghi "bỏ qua", chuông trả 202 không làm gì, và phía đọc (CatalogService) không
 * đọc bảng mới. MssClient/MssHealthService/MssFlagsService đến từ MssModule (@Global).
 */
@Module({
  imports: [ImageRegistryModule, BullModule.registerQueue({ name: MSS_CATALOG_QUEUE })],
  controllers: [MssCatalogDoorbellController, MssCatalogAdminController, MssPreviewController],
  providers: [MssCatalogService, MssCatalogQueue, MssCatalogProcessor, MssCatalogCron, MssCatalogOpsService, MssPreviewService],
})
export class MssCatalogModule {}
