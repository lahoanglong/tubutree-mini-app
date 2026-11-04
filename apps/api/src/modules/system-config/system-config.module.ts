import { Global, Module } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { SystemConfigController } from './system-config.controller';
import { LegalConfigController } from './legal-config.controller';
import { ImageRegistryModule } from '../catalog/image-registry.module';

@Global()
@Module({
  imports: [ImageRegistryModule],
  controllers: [SystemConfigController, LegalConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
