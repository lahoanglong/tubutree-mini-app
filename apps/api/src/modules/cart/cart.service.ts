import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CouponsService } from '../coupons/coupons.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { AddItemDto } from './dto/cart.dto';

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coupons: CouponsService,
    private readonly config: SystemConfigService,
    private readonly flashSale: FlashSaleService,
  ) {}

  private async ensureCart(userId: string): Promise<string> {
    const cart = await this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    return cart.id;
  }

  async getCart(userId: string) {
    const cartId = await this.ensureCart(userId);
    const cart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: { items: { include: { variation: { include: { product: true } } } } },
    });

    const now = new Date();
    const flashMap = await this.flashSale.resolveEffective(
      cart.items.map((it) => it.variationId),
      now,
    );
    const lines = cart.items.map((it) => {
      const flash = flashMap.get(it.variationId);
      const unitPrice = flash ? flash.flashPrice : (it.variation.salePrice ?? it.variation.retailPrice);
      return {
        id: it.id,
        variationId: it.variationId,
        productId: it.variation.productId,
        productName: it.variation.product.name,
        variationName: it.variation.name,
        slug: it.variation.product.slug,
        thumbnail: it.variation.product.thumbnail,
        unitPrice,
        quantity: it.quantity,
        stock: it.variation.stock,
        total: unitPrice * it.quantity,
        isFlash: !!flash,
        flashSaleItemId: flash?.itemId ?? null,
        flashEndAt: flash?.endAt ?? null,
        soldPct: flash ? Math.round((flash.soldCount / flash.quota) * 100) : null,
      };
    });
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    // Coupon base LOẠI flash item (giá flash là giá cuối, không stack coupon) → giảm hiển thị khớp checkout.
    const couponBase = lines.filter((l) => !l.isFlash).reduce((s, l) => s + l.total, 0);

    let discount = 0;
    let freeship = false;
    let couponCode = cart.couponCode;
    if (couponCode) {
      try {
        const r = await this.coupons.validateAndCompute(couponCode, userId, couponBase);
        discount = r.discount;
        freeship = r.freeship;
      } catch {
        // coupon không còn hợp lệ với giỏ hiện tại → gỡ
        await this.prisma.cart.update({ where: { id: cartId }, data: { couponCode: null } });
        couponCode = null;
      }
    }

    // Ngưỡng freeship (config-driven §15.2) để FE hiển thị progress khích lệ.
    const freeshipThreshold = await this.config.get<number>('shipping.free_threshold', 200000);

    return {
      items: lines,
      couponCode,
      subtotal,
      discount,
      freeship,
      freeshipThreshold,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    };
  }

  async addItem(userId: string, dto: AddItemDto) {
    const cartId = await this.ensureCart(userId);
    const variation = await this.prisma.variation.findUnique({ where: { id: dto.variationId } });
    if (!variation || !variation.isActive) throw new NotFoundException('Sản phẩm không khả dụng.');

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variationId: { cartId, variationId: dto.variationId } },
    });
    const newQty = (existing?.quantity ?? 0) + dto.quantity;
    if (newQty > variation.stock) {
      throw new BadRequestException(`Chỉ còn ${variation.stock} sản phẩm trong kho.`);
    }

    await this.prisma.cartItem.upsert({
      where: { cartId_variationId: { cartId, variationId: dto.variationId } },
      update: { quantity: newQty },
      create: { cartId, variationId: dto.variationId, quantity: dto.quantity },
    });
    return this.getCart(userId);
  }

  async updateItem(userId: string, itemId: string, quantity: number) {
    const cartId = await this.ensureCart(userId);
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { variation: true },
    });
    if (!item || item.cartId !== cartId) throw new NotFoundException('Không tìm thấy mục giỏ hàng.');
    if (quantity === 0) {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
    } else {
      if (quantity > item.variation.stock) {
        throw new BadRequestException(`Chỉ còn ${item.variation.stock} sản phẩm trong kho.`);
      }
      await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    }
    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string) {
    const cartId = await this.ensureCart(userId);
    await this.prisma.cartItem.deleteMany({ where: { id: itemId, cartId } });
    return this.getCart(userId);
  }

  /** Xoá nhiều dòng (dùng sau khi đặt đơn checkout TẬP CON — chỉ dọn món đã mua, giữ phần còn lại). */
  async removeItems(userId: string, itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    const cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) return;
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id, id: { in: itemIds } } });
  }

  async applyCoupon(userId: string, code: string) {
    const cart = await this.getCart(userId);
    // validate với subtotal hiện tại (ném lỗi nếu không hợp lệ)
    await this.coupons.validateAndCompute(code, userId, cart.subtotal);
    await this.prisma.cart.update({ where: { userId }, data: { couponCode: code } });
    return this.getCart(userId);
  }

  async removeCoupon(userId: string) {
    await this.prisma.cart.update({ where: { userId }, data: { couponCode: null } });
    return this.getCart(userId);
  }

  async clear(userId: string): Promise<void> {
    const cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) return;
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
  }
}
