import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';

@Module({
  imports: [CatalogModule, FlashSaleModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
