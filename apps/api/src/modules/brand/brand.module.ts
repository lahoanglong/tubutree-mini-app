import { Module } from '@nestjs/common';
import { BrandService } from './brand.service';
import { BrandController } from './brand.controller';
import { BrandAdminController } from './brand-admin.controller';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  // RefillPairsService: bảng cặp Refill có bộ nhớ chung cho cờ `hasRefillProducts` của trang thương hiệu.
  imports: [CatalogModule],
  controllers: [BrandController, BrandAdminController],
  providers: [BrandService],
  exports: [BrandService],
})
export class BrandModule {}
