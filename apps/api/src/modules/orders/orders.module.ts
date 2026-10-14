import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderReversalService } from './order-reversal.service';
import { OrderStatusService } from './order-status.service';
import { PurchasedItemsService } from './purchased-items.service';
import { PendingPaymentExpiryCron } from './pending-payment-expiry.cron';
import { PurchasedItemsController } from './purchased-items.controller';
import { CustomerRefundsService } from './customer-refunds.service';
import { CustomerRefundsAdminController } from './customer-refunds-admin.controller';
import { CartModule } from '../cart/cart.module';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { PancakeSyncHooksModule } from '../integrations/pancake/pancake-sync-hooks.module';

@Module({
  imports: [CartModule, FlashSaleModule, PancakeSyncHooksModule],
  controllers: [OrdersController, PurchasedItemsController, CustomerRefundsAdminController],
  providers: [OrdersService, OrderReversalService, OrderStatusService, PurchasedItemsService, CustomerRefundsService, PendingPaymentExpiryCron],
  // Xuất cho AdminModule/MerchantModule/PancakeModule — nguồn ghi Order.status
  // dùng chung để không lặp lại khối restock/refund + guard chuyển trạng thái.
  exports: [OrderReversalService, OrderStatusService, OrdersService, PurchasedItemsService],
})
export class OrdersModule {}
