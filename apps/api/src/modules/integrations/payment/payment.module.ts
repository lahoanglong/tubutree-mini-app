import { Module } from '@nestjs/common';
import { ZalopayService } from './zalopay.service';
import { BankTransferService } from './bank-transfer.service';
import { PaymentController } from './payment.controller';
import { ZalopayReconcileCron } from './zalopay-reconcile.cron';
import { PancakeSyncHooksModule } from '../pancake/pancake-sync-hooks.module';

@Module({
  imports: [PancakeSyncHooksModule],
  controllers: [PaymentController],
  providers: [ZalopayService, BankTransferService, ZalopayReconcileCron],
  exports: [ZalopayService, BankTransferService],
})
export class PaymentModule {}
