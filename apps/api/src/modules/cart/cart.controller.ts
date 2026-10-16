import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CartService } from './cart.service';
import { toPublicCart } from '../checkout/checkout-split';
import { AddItemDto, ApplyCouponDto, CartQueryDto, UpdateItemDto } from './dto/cart.dto';

@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  async get(@CurrentUser('sub') userId: string, @Query() q: CartQueryDto) {
    return toPublicCart(await this.cart.getCart(userId, q.storefrontSlug));
  }

  @Post('items')
  async addItem(@CurrentUser('sub') userId: string, @Body() dto: AddItemDto, @Query() q: CartQueryDto) {
    return toPublicCart(await this.cart.addItem(userId, dto, q.storefrontSlug));
  }

  @Patch('items/:id')
  async updateItem(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @Query() q: CartQueryDto,
  ) {
    return toPublicCart(await this.cart.updateItem(userId, id, dto.quantity, q.storefrontSlug));
  }

  @Delete('items/:id')
  async removeItem(@CurrentUser('sub') userId: string, @Param('id') id: string, @Query() q: CartQueryDto) {
    return toPublicCart(await this.cart.removeItem(userId, id, q.storefrontSlug));
  }

  @Post('coupon')
  async applyCoupon(@CurrentUser('sub') userId: string, @Body() dto: ApplyCouponDto, @Query() q: CartQueryDto) {
    return toPublicCart(await this.cart.applyCoupon(userId, dto.code, q.storefrontSlug));
  }

  @Delete('coupon')
  async removeCoupon(@CurrentUser('sub') userId: string, @Query() q: CartQueryDto) {
    return toPublicCart(await this.cart.removeCoupon(userId, q.storefrontSlug));
  }
}
