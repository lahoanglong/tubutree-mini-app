import { Global, Module } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { SystemConfigController } from './system-config.controller';
import { LegalConfigController } from './legal-config.controller';
import { OrderZaloConfigController } from './order-zalo-config.controller';
import { ImageRegistryModule } from '../catalog/image-registry.module';

@Global()
@Module({
  imports: [ImageRegistryModule],
  controllers: [SystemConfigController, LegalConfigController, OrderZaloConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
