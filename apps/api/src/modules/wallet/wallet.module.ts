import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CoinsService } from './coins.service';
import { RewardPointsService } from './reward-points.service';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletController } from './wallet.controller';

@Module({
  controllers: [WalletController],
  providers: [WalletService, CoinsService, RewardPointsService, WalletLedgerService],
  exports: [WalletService, CoinsService, RewardPointsService, WalletLedgerService],
})
export class WalletModule {}
