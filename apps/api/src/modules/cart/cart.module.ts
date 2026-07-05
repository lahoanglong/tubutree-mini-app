import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { FlashSaleModule } from '../flash-sale/flash-sale.module';

@Module({
  imports: [FlashSaleModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
