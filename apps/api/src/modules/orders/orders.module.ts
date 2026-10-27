import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderReversalService } from './order-reversal.service';
import { OrderStatusService } from './order-status.service';
import { PurchasedItemsService } from './purchased-items.service';
import { PendingPaymentExpiryCron } from './pending-payment-expiry.cron';
import { DeliveredEffectsResyncCron } from './delivered-effects-resync.cron';
import { ReversalEffectsResyncCron } from './reversal-effects-resync.cron';
import { PurchasedItemsController } from './purchased-items.controller';
import { CustomerRefundsService } from './customer-refunds.service';
import { CustomerRefundsAdminController } from './customer-refunds-admin.controller';
import { OrderReturnsService } from './order-returns.service';
import { ReturnsAdminController } from './returns-admin.controller';
import { ReturnImagesController } from './return-images.controller';
import { CartModule } from '../cart/cart.module';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';
import { PancakeSyncHooksModule } from '../integrations/pancake/pancake-sync-hooks.module';
import { GameModule } from '../game/game.module';
import { WastePickupModule } from '../waste-exchange/pickup/waste-pickup.module';

@Module({
  imports: [CartModule, FlashSaleModule, PancakeSyncHooksModule, WastePickupModule, GameModule],
  controllers: [OrdersController, PurchasedItemsController, CustomerRefundsAdminController, ReturnsAdminController, ReturnImagesController],
  providers: [
    OrdersService,
    OrderReversalService,
    OrderStatusService,
    PurchasedItemsService,
    CustomerRefundsService,
    OrderReturnsService,
    PendingPaymentExpiryCron,
    DeliveredEffectsResyncCron,
    ReversalEffectsResyncCron,
  ],
  // Xuất cho AdminModule/MerchantModule/PancakeModule — nguồn ghi Order.status
  // dùng chung để không lặp lại khối restock/refund + guard chuyển trạng thái.
  exports: [OrderReversalService, OrderStatusService, OrdersService, PurchasedItemsService, CustomerRefundsService, OrderReturnsService],
})
export class OrdersModule {}
