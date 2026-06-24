import { Module } from '@nestjs/common';
import { CashbackService } from './cashback.service';
import { CashbackController } from './cashback.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule], // CoinsService — thưởng xu giới thiệu khi cashback CONFIRMED
  controllers: [CashbackController],
  providers: [CashbackService],
})
export class CashbackModule {}
