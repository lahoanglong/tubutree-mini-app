import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [CatalogModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
