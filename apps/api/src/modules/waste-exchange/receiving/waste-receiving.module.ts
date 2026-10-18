import { Module } from '@nestjs/common';
import { WalletModule } from '../../wallet/wallet.module';
import { WasteCoreModule } from '../core/waste-core.module';
import { WasteConfirmService } from './waste-confirm.service';
import { WasteReceiveService } from './waste-receive.service';

@Module({ imports: [WalletModule, WasteCoreModule], providers: [WasteConfirmService, WasteReceiveService] })
export class WasteReceivingModule {}
