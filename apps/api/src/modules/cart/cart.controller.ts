import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CartService } from './cart.service';
import { toPublicCart, type LineFulfiller } from '../checkout/checkout-split';
import { WasteGiftAttachService } from '../waste-exchange/catalog/waste-gift-attach.service';
import { AddItemDto, AddItemsBatchDto, ApplyCouponDto, CartQueryDto, UpdateItemDto } from './dto/cart.dto';

@Controller('cart')
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly gifts: WasteGiftAttachService,
  ) {}

  /**
   * Giỏ trả cho khách kèm quà hiện vật 0đ chờ gắn đơn (`pendingGiftRedemptions`). Mọi đường trả giỏ đều kèm để giỏ trong cache của app
   * không mất danh sách quà sau một thao tác thêm/sửa/xoá.
   */
  private async present<C extends { items: { fulfiller: LineFulfiller }[] }>(userId: string, cart: C) {
    return { ...toPublicCart(cart), pendingGiftRedemptions: await this.gifts.listPending(userId) };
  }

  @Get()
  async get(@CurrentUser('sub') userId: string, @Query() q: CartQueryDto) {
    return this.present(
      userId,
      q.itemIds?.length ? await this.cart.getCartSelection(userId, q.storefrontSlug, q.itemIds) : await this.cart.getCart(userId, q.storefrontSlug),
    );
  }

  @Post('items')
  async addItem(@CurrentUser('sub') userId: string, @Body() dto: AddItemDto, @Query() q: CartQueryDto) {
    return this.present(userId, await this.cart.addItem(userId, dto, q.storefrontSlug));
  }

  // Một transaction: một món hết hàng hoặc ngừng bán thì không món nào vào giỏ (lỗi CART_BATCH_REJECTED nêu variationId).
  @Post('items/batch')
  async addItemsBatch(@CurrentUser('sub') userId: string, @Body() dto: AddItemsBatchDto, @Query() q: CartQueryDto) {
    return this.present(userId, await this.cart.addItemsBatch(userId, dto.items, dto.addSource, q.storefrontSlug));
  }

  @Patch('items/:id')
  async updateItem(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @Query() q: CartQueryDto,
  ) {
    return this.present(userId, await this.cart.updateItem(userId, id, dto.quantity, q.storefrontSlug));
  }

  @Delete('items/:id')
  async removeItem(@CurrentUser('sub') userId: string, @Param('id') id: string, @Query() q: CartQueryDto) {
    return this.present(userId, await this.cart.removeItem(userId, id, q.storefrontSlug));
  }

  // Gõ mã thẻ hộp hàng ở đây cũng nhận mã (CouponClaimService.claimHiddenForCart): cùng trần với POST /coupons/claim,
  // không thì giỏ thành đường dò mã thẻ nhanh gấp 30 lần.
  @Post('coupon')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async applyCoupon(@CurrentUser('sub') userId: string, @Body() dto: ApplyCouponDto, @Query() q: CartQueryDto) {
    return this.present(userId, await this.cart.applyCoupon(userId, dto.code, q.storefrontSlug));
  }

  @Delete('coupon')
  async removeCoupon(@CurrentUser('sub') userId: string, @Query() q: CartQueryDto) {
    return this.present(userId, await this.cart.removeCoupon(userId, q.storefrontSlug));
  }
}
