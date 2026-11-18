import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { MerchShelvesController } from './merch-shelves.controller';
import { MerchShelvesService } from './merch-shelves.service';

@Module({
  imports: [CatalogModule],
  controllers: [MerchShelvesController],
  providers: [MerchShelvesService],
})
export class MerchShelvesModule {}
