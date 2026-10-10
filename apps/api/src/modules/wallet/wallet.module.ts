import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CoinsService } from './coins.service';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletController } from './wallet.controller';

@Module({
  controllers: [WalletController],
  providers: [WalletService, CoinsService, WalletLedgerService],
  exports: [WalletService, CoinsService, WalletLedgerService],
})
export class WalletModule {}
