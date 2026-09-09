import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MerchantController } from './merchant.controller';
import { MerchantService } from './merchant.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [PrismaModule, OrdersModule],
  controllers: [MerchantController],
  providers: [MerchantService],
  exports: [MerchantService],
})
export class MerchantModule {}
