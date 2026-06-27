import { Module } from '@nestjs/common';
import { BrandService } from './brand.service';
import { BrandController } from './brand.controller';
import { BrandAdminController } from './brand-admin.controller';

@Module({
  controllers: [BrandController, BrandAdminController],
  providers: [BrandService],
  exports: [BrandService],
})
export class BrandModule {}
