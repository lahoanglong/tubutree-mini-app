import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CartService } from './cart.service';
import { publicFulfiller, type LineFulfiller } from '../checkout/checkout-split';
import { AddItemDto, ApplyCouponDto, UpdateItemDto } from './dto/cart.dto';

/** Giỏ trả cho khách: nơi giao từng dòng không kèm ID chủ gian hàng (R2-MERCHANT-14). */
export function toPublicCart<C extends { items: { fulfiller: LineFulfiller }[] }>(cart: C) {
  return { ...cart, items: cart.items.map((it) => ({ ...it, fulfiller: publicFulfiller(it.fulfiller) })) };
}

@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  async get(@CurrentUser('sub') userId: string) {
    return toPublicCart(await this.cart.getCart(userId));
  }

  @Post('items')
  async addItem(@CurrentUser('sub') userId: string, @Body() dto: AddItemDto) {
    return toPublicCart(await this.cart.addItem(userId, dto));
  }

  @Patch('items/:id')
  async updateItem(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return toPublicCart(await this.cart.updateItem(userId, id, dto.quantity));
  }

  @Delete('items/:id')
  async removeItem(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return toPublicCart(await this.cart.removeItem(userId, id));
  }

  @Post('coupon')
  async applyCoupon(@CurrentUser('sub') userId: string, @Body() dto: ApplyCouponDto) {
    return toPublicCart(await this.cart.applyCoupon(userId, dto.code));
  }

  @Delete('coupon')
  async removeCoupon(@CurrentUser('sub') userId: string) {
    return toPublicCart(await this.cart.removeCoupon(userId));
  }
}
