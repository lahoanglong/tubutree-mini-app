import { Module } from '@nestjs/common';
import { ZalopayService } from './zalopay.service';
import { BankTransferService } from './bank-transfer.service';
import { PaymentController } from './payment.controller';

@Module({
  controllers: [PaymentController],
  providers: [ZalopayService, BankTransferService],
  exports: [ZalopayService, BankTransferService],
})
export class PaymentModule {}
