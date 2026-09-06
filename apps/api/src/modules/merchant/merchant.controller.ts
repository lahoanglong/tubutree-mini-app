import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantService } from './merchant.service';

export class UpdateMerchantStoreDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  headerNote?: string;

  @IsOptional()
  @IsString()
  subdomain?: string;

  @IsOptional()
  @IsString()
  customDomain?: string;

  @IsOptional()
  @IsString()
  themeColor?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankBin?: string;

  @IsOptional()
  @IsString()
  bankAccountNo?: string;

  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @IsOptional()
  @IsString()
  warehouseAddress?: string;

  @IsOptional()
  @IsString()
  warehouseCity?: string;

  @IsOptional()
  @IsString()
  warehouseDistrict?: string;

  @IsOptional()
  @IsString()
  warehouseWard?: string;

  @IsOptional()
  @IsString()
  warehousePhone?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class CreateMerchantProductDto {
  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsNotEmpty()
  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  shortDesc?: string;

  @IsInt()
  @Min(0)
  basePrice!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salePrice?: number;

  @IsOptional()
  @IsArray()
  images?: string[];

  @IsOptional()
  @IsString()
  thumbnail?: string;

  @IsOptional()
  @IsArray()
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsArray()
  forSegment?: string[];

  @IsOptional()
  ingredients?: unknown;

  @IsOptional()
  @IsArray()
  certifications?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;
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

@Controller('merchant')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('DEALER', 'AFFILIATE', 'ADMIN')
export class MerchantController {
  constructor(private readonly merchant: MerchantService) {}

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
  listMyProducts(@CurrentUser('sub') userId: string) {
    return this.merchant.listMyProducts(userId);
  }

  @Post('products')
  createProduct(@CurrentUser('sub') userId: string, @Body() dto: CreateMerchantProductDto) {
    return this.merchant.createProduct(userId, dto);
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
  listOrders(@CurrentUser('sub') userId: string, @Query('status') status?: string) {
    return this.merchant.listMerchantOrders(userId, status);
  }

  @Put('orders/:id/status')
  updateOrderStatus(
    @CurrentUser('sub') userId: string,
    @Param('id') orderId: string,
    @Body() dto: UpdateMerchantOrderStatusDto,
  ) {
    return this.merchant.updateMerchantOrderStatus(userId, orderId, dto.status);
  }
}
