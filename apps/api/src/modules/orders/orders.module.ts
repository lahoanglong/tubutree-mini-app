import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { CartModule } from '../cart/cart.module';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';

@Module({
  imports: [CartModule, FlashSaleModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
