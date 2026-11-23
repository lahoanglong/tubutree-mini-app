import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PaymentModule } from '../../integrations/payment/payment.module';
import { CheckoutModule } from '../checkout.module';
import { OrdersModule } from '../../orders/orders.module';
import { GuestCheckoutController } from './guest-checkout.controller';
import { GuestCheckoutService } from './guest-checkout.service';

@Module({
  imports: [CheckoutModule, AuthModule, PaymentModule, OrdersModule],
  controllers: [GuestCheckoutController],
  providers: [GuestCheckoutService],
})
export class GuestCheckoutModule {}
