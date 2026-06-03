import { Module } from '@nestjs/common';
import { ZalopayService } from './zalopay.service';
import { PaymentController } from './payment.controller';

@Module({
  controllers: [PaymentController],
  providers: [ZalopayService],
  exports: [ZalopayService],
})
export class PaymentModule {}
