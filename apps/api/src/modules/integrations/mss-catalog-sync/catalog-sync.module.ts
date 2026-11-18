import { Module } from '@nestjs/common';
import { MssCatalogModule } from '../mss/catalog/mss-catalog.module';
import { CatalogSyncController } from './catalog-sync.controller';
import { CatalogSyncService } from './catalog-sync.service';

/**
 * MSS đẩy nội dung + tồn sang Tubu (`POST /api/integrations/mss/catalog-sync`). Nội dung đi đúng đường ghép của lượt kéo
 * (MssCatalogService); tồn theo cờ riêng `mss.stock_sync_enabled`. MssHealthService/MssInboundGuard đến từ MssModule (@Global).
 */
@Module({
  imports: [MssCatalogModule],
  controllers: [CatalogSyncController],
  providers: [CatalogSyncService],
})
export class CatalogSyncModule {}
