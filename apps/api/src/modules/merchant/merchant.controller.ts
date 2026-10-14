import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { OrderStatus } from '@tubutree/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationQuery } from '../../common/pagination';
import { MerchantService } from './merchant.service';
import { MERCHANT_FULFIL_STATUSES, MerchantFulfilmentService } from './merchant-fulfilment.service';

// Cùng trần với /storefront/me (storefront.controller.ts): ảnh có thể là data URL base64 khi chưa cấu hình Cloudinary.
const IMAGE_MAX = 1_500_000;
/** Trần giá một sản phẩm (100 triệu đồng) — chặn gõ thừa số 0 làm hỏng tổng đơn/đối soát. */
const MAX_PRICE = 100_000_000;
const MAX_STOCK = 100_000;
/** Phí giao một kiện tối đa đối tác tự đặt. */
const MAX_SHIPPING_FEE = 500_000;

export class UpdateMerchantStoreDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(200) headerNote?: string;
  @IsOptional() @IsString() @MaxLength(63) subdomain?: string;
  @IsOptional() @IsString() @MaxLength(253) customDomain?: string;
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'themeColor phải là mã màu hex dạng #rrggbb.' })
  themeColor?: string;
  @IsOptional() @IsString() @MaxLength(200) bankName?: string;
  @IsOptional() @IsString() @MaxLength(200) bankBin?: string;
  @IsOptional() @IsString() @MaxLength(200) bankAccountNo?: string;
  @IsOptional() @IsString() @MaxLength(200) bankAccountName?: string;
  @IsOptional() @IsString() @MaxLength(200) warehouseAddress?: string;
  @IsOptional() @IsString() @MaxLength(200) warehouseCity?: string;
  @IsOptional() @IsString() @MaxLength(200) warehouseDistrict?: string;
  @IsOptional() @IsString() @MaxLength(200) warehouseWard?: string;
  @IsOptional() @IsString() @MaxLength(200) warehousePhone?: string;
  @IsOptional() @IsString() @MaxLength(IMAGE_MAX) avatarUrl?: string;
  @IsOptional() @IsString() @MaxLength(IMAGE_MAX) coverUrl?: string;
  @IsOptional() @IsBoolean() isPublished?: boolean;
  /** null = dùng phí mặc định của Tubu (`merchant.default_shipping_fee`). */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(MAX_SHIPPING_FEE) shippingFee?: number | null;
  /** null = không miễn phí giao. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(MAX_PRICE) freeShipFrom?: number | null;
}

export class CreateMerchantProductDto {
  @IsNotEmpty() @IsString() @MaxLength(200) name!: string;
  @IsNotEmpty() @IsString() @MaxLength(10_000) description!: string;
  @IsOptional() @IsString() @MaxLength(300) shortDesc?: string;
  @IsInt() @Min(0) @Max(MAX_PRICE) basePrice!: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_PRICE) salePrice?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(IMAGE_MAX, { each: true }) images?: string[];
  @IsOptional() @IsString() @MaxLength(IMAGE_MAX) thumbnail?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) categoryIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(50, { each: true }) tags?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) forSegment?: string[];
  @IsOptional() ingredients?: unknown;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(200, { each: true }) certifications?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(MAX_STOCK) stock?: number;
  @IsOptional() @IsString() @MaxLength(64) pancakeCode?: string;
  @IsOptional() @IsBoolean() tubuFulfils?: boolean;
}

export class UpdateMerchantProductDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(10_000) description?: string;
  @IsOptional() @IsString() @MaxLength(300) shortDesc?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_PRICE) basePrice?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(MAX_PRICE) salePrice?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(IMAGE_MAX, { each: true }) images?: string[];
  @IsOptional() @IsString() @MaxLength(IMAGE_MAX) thumbnail?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_STOCK) stock?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AddResellProductDto {
  @IsNotEmpty()
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  collectionId?: string;
}

export class PublishMerchantStoreDto {
  @IsBoolean()
  isPublished!: boolean;
}

export class UpdateMerchantOrderStatusDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'RETURNED', 'CANCELLED'])
  status!: string;
}

export class ShipMerchantOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(60) carrier!: string;
  @IsString() @IsNotEmpty() @MaxLength(60) trackingCode!: string;
  @IsOptional() @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }) @MaxLength(500) trackingUrl?: string;
}

export class MerchantOrderReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

// Bug 3: /merchant/orders trước đây chỉ nhận `status` rời, không có page/limit thật.
class MerchantOrderListQuery extends PaginationQuery {
  // SELLER-13: chuỗi lạ đi thẳng vào enum Prisma thành 500.
  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  status?: string;
}

class MerchantFulfilListQuery extends PaginationQuery {
  @IsOptional()
  @IsIn([...MERCHANT_FULFIL_STATUSES])
  status?: string;
}

@Controller('merchant')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('DEALER', 'AFFILIATE', 'ADMIN')
export class MerchantController {
  constructor(
    private readonly merchant: MerchantService,
    private readonly fulfilment: MerchantFulfilmentService,
  ) {}

  @Get('store')
  getStore(@CurrentUser('sub') userId: string) {
    return this.merchant.getOrCreateStore(userId);
  }

  @Put('store')
  updateStore(@CurrentUser('sub') userId: string, @Body() dto: UpdateMerchantStoreDto) {
    return this.merchant.updateStore(userId, dto);
  }

  @Post('store/publish')
  publishStore(@CurrentUser('sub') userId: string, @Body() dto: PublishMerchantStoreDto) {
    return this.merchant.publishStore(userId, dto.isPublished);
  }

  @Get('products')
  listMyProducts(@CurrentUser('sub') userId: string, @Query() query: PaginationQuery) {
    return this.merchant.listMyProducts(userId, query.page, query.limit);
  }

  @Post('products')
  createProduct(@CurrentUser('sub') userId: string, @Body() dto: CreateMerchantProductDto) {
    return this.merchant.createProduct(userId, dto);
  }

  @Patch('products/:id')
  updateProduct(@CurrentUser('sub') userId: string, @Param('id') productId: string, @Body() dto: UpdateMerchantProductDto) {
    return this.merchant.updateProduct(userId, productId, dto);
  }

  @Delete('products/:id')
  stopSellingProduct(@CurrentUser('sub') userId: string, @Param('id') productId: string) {
    return this.merchant.stopSellingProduct(userId, productId);
  }

  @Get('pancake-variations/:code')
  checkPancakeVariation(@CurrentUser('sub') userId: string, @Param('code') code: string) {
    return this.merchant.checkPancakeVariation(userId, code);
  }

  @Post('resell-products')
  addResellProduct(@CurrentUser('sub') userId: string, @Body() dto: AddResellProductDto) {
    return this.merchant.addResellProduct(userId, dto.productId, dto.collectionId);
  }

  @Delete('resell-products/:productId')
  removeResellProduct(@CurrentUser('sub') userId: string, @Param('productId') productId: string) {
    return this.merchant.removeResellProduct(userId, productId);
  }

  @Get('orders')
  listOrders(@CurrentUser('sub') userId: string, @Query() query: MerchantOrderListQuery) {
    return this.merchant.listMerchantOrders(userId, query.status, query.page, query.limit);
  }

  @Put('orders/:id/status')
  updateOrderStatus(
    @CurrentUser('sub') userId: string,
    @Param('id') orderId: string,
    @Body() dto: UpdateMerchantOrderStatusDto,
  ) {
    return this.merchant.updateMerchantOrderStatus(userId, orderId, dto.status);
  }

  // ── Đơn đối tác tự giao (D4) ──

  @Get('fulfil-orders')
  listFulfilOrders(@CurrentUser('sub') userId: string, @Query() query: MerchantFulfilListQuery) {
    return this.fulfilment.listOrders(userId, query.status, query.page, query.limit);
  }

  @Post('fulfil-orders/:id/accept')
  accept(@CurrentUser('sub') userId: string, @Param('id') orderId: string) {
    return this.fulfilment.accept(userId, orderId);
  }

  @Post('fulfil-orders/:id/pack')
  pack(@CurrentUser('sub') userId: string, @Param('id') orderId: string) {
    return this.fulfilment.pack(userId, orderId);
  }

  @Post('fulfil-orders/:id/ship')
  ship(@CurrentUser('sub') userId: string, @Param('id') orderId: string, @Body() dto: ShipMerchantOrderDto) {
    return this.fulfilment.ship(userId, orderId, dto);
  }

  @Post('fulfil-orders/:id/deliver')
  deliver(@CurrentUser('sub') userId: string, @Param('id') orderId: string) {
    return this.fulfilment.deliver(userId, orderId);
  }

  @Post('fulfil-orders/:id/fail')
  fail(@CurrentUser('sub') userId: string, @Param('id') orderId: string, @Body() dto: MerchantOrderReasonDto) {
    return this.fulfilment.fail(userId, orderId, dto.reason);
  }

  @Post('fulfil-orders/:id/cancel')
  cancel(@CurrentUser('sub') userId: string, @Param('id') orderId: string, @Body() dto: MerchantOrderReasonDto) {
    return this.fulfilment.cancel(userId, orderId, dto.reason);
  }

  @Get('settlement')
  settlement(@CurrentUser('sub') userId: string) {
    return this.fulfilment.myStatement(userId);
  }
}
