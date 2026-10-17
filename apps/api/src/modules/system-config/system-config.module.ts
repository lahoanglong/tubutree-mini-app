import { Global, Module } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { SystemConfigController } from './system-config.controller';
import { LegalConfigController } from './legal-config.controller';

@Global()
@Module({
  controllers: [SystemConfigController, LegalConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
