import { Module } from '@nestjs/common';
import { CashbackService } from './cashback.service';
import { CashbackController } from './cashback.controller';
import { WalletModule } from '../wallet/wallet.module';
import { CashbackProviderRegistry } from './providers/cashback-provider.registry';
import { AccessTradeProvider } from './providers/access-trade.provider';
import { CASHBACK_PROVIDERS } from './providers/cashback-provider.interface';

@Module({
  imports: [WalletModule], // CoinsService — thưởng xu giới thiệu khi cashback CONFIRMED
  controllers: [CashbackController],
  providers: [
    CashbackService,
    CashbackProviderRegistry,
    AccessTradeProvider,
    { provide: CASHBACK_PROVIDERS, useFactory: (at: AccessTradeProvider) => [at], inject: [AccessTradeProvider] },
  ],
})
export class CashbackModule {}
