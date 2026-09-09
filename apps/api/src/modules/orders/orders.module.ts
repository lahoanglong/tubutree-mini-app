import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderReversalService } from './order-reversal.service';
import { OrderStatusService } from './order-status.service';
import { CartModule } from '../cart/cart.module';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';

@Module({
  imports: [CartModule, FlashSaleModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderReversalService, OrderStatusService],
  // Xuất cho AdminModule/MerchantModule/PancakeModule — nguồn ghi Order.status
  // dùng chung để không lặp lại khối restock/refund + guard chuyển trạng thái.
  exports: [OrderReversalService, OrderStatusService],
})
export class OrdersModule {}
