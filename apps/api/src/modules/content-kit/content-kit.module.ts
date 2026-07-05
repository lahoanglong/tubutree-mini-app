import { Module } from '@nestjs/common';
import { ContentKitService } from './content-kit.service';
import { ContentKitController } from './content-kit.controller';
import { ContentKitAdminController } from './content-kit-admin.controller';

@Module({
  controllers: [ContentKitController, ContentKitAdminController],
  providers: [ContentKitService],
  exports: [ContentKitService],
})
export class ContentKitModule {}
