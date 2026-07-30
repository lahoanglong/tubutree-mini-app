import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CartService } from './cart.service';
import { AddItemDto, ApplyCouponDto, UpdateItemDto } from './dto/cart.dto';

@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser('sub') userId: string) {
    return this.cart.getCart(userId);
  }

  @Post('items')
  addItem(@CurrentUser('sub') userId: string, @Body() dto: AddItemDto) {
    return this.cart.addItem(userId, dto);
  }

  @Patch('items/:id')
  updateItem(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.cart.updateItem(userId, id, dto.quantity);
  }

  @Delete('items/:id')
  removeItem(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.cart.removeItem(userId, id);
  }

  @Post('coupon')
  applyCoupon(@CurrentUser('sub') userId: string, @Body() dto: ApplyCouponDto) {
    return this.cart.applyCoupon(userId, dto.code);
  }

  @Delete('coupon')
  removeCoupon(@CurrentUser('sub') userId: string) {
    return this.cart.removeCoupon(userId);
  }
}
