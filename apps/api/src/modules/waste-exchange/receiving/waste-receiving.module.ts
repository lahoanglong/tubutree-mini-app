import { Module } from '@nestjs/common';
import { WalletModule } from '../../wallet/wallet.module';
import { WasteCoreModule } from '../core/waste-core.module';
import { WasteAdminRequestsService } from './waste-admin-requests.service';
import { WasteConfirmService } from './waste-confirm.service';
import { WasteDeskController } from './waste-desk.controller';
import { WasteDeskService } from './waste-desk.service';
import { WasteReceiveService } from './waste-receive.service';
import { WasteReverseService } from './waste-reverse.service';

@Module({ imports: [WalletModule, WasteCoreModule], controllers: [WasteDeskController], providers: [WasteAdminRequestsService, WasteConfirmService, WasteDeskService, WasteReceiveService, WasteReverseService] })
export class WasteReceivingModule {}
