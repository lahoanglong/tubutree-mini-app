import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MerchantController } from './merchant.controller';
import { MerchantService } from './merchant.service';
import { MerchantFulfilmentService } from './merchant-fulfilment.service';
import { MerchantAdminController } from './merchant-admin.controller';
import { MerchantSlaCron } from './merchant-sla.cron';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [PrismaModule, OrdersModule],
  controllers: [MerchantController, MerchantAdminController],
  providers: [MerchantService, MerchantFulfilmentService, MerchantSlaCron],
  exports: [MerchantService, MerchantFulfilmentService],
})
export class MerchantModule {}
