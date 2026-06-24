import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CoinsService } from './coins.service';
import { WalletController } from './wallet.controller';

@Module({
  controllers: [WalletController],
  providers: [WalletService, CoinsService],
  exports: [WalletService, CoinsService],
})
export class WalletModule {}
