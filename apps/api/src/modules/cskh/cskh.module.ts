import { Module } from '@nestjs/common';
import { CskhService } from './cskh.service';
import { CskhAdminController } from './cskh-admin.controller';

@Module({
  controllers: [CskhAdminController],
  providers: [CskhService],
  exports: [CskhService],
})
export class CskhModule {}
