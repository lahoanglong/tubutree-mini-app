import { Module } from '@nestjs/common';
import { WasteCoreModule } from '../core/waste-core.module';
import { WasteRequestsService } from './waste-requests.service';

@Module({ imports: [WasteCoreModule], providers: [WasteRequestsService] })
export class WasteCustomerModule {}
