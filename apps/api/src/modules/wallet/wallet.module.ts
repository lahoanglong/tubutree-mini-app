import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { RewardPointsService } from './reward-points.service';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletController } from './wallet.controller';

@Module({
  controllers: [WalletController],
  providers: [WalletService, RewardPointsService, WalletLedgerService],
  exports: [WalletService, RewardPointsService, WalletLedgerService],
})
export class WalletModule {}
