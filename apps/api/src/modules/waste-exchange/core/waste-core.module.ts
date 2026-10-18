import { Module } from '@nestjs/common';
import { WasteConfigService } from './waste-config.service';

@Module({ providers: [WasteConfigService], exports: [WasteConfigService] })
export class WasteCoreModule {}
