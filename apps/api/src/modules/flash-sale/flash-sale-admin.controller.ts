import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { Trim } from '../../common/decorators/trim.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '@tubutree/shared-types';
import type { CouponActor } from '../admin/coupon-input-rules';
import { FlashSaleService } from './flash-sale.service';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';

export class CreateSaleDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
}
class UpdateSaleDto {
  @OptionalNotNull() @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @OptionalNotNull() @IsDateString() startAt?: string;
  @OptionalNotNull() @IsDateString() endAt?: string;
  @OptionalNotNull() @IsBoolean() isActive?: boolean;
}
class AddItemDto {
  @IsString() variationId!: string;
  @IsInt() @Min(1) flashPrice!: number;
  @IsInt() @Min(1) quota!: number;
  @IsOptional() @IsInt() @Min(1) perUserLimit?: number;
}

const actorOf = (user: JwtPayload): CouponActor => ({ id: user.sub, staff: user.role !== 'ADMIN' });

@Roles('ADMIN')
@AllowStaff('MARKETING')
@Controller('admin/flash-sales')
export class FlashSaleAdminController {
  constructor(private readonly flashSale: FlashSaleService) {}

  @Get()
  list() {
    return this.flashSale.listSales();
  }

  @Post()
  create(@CurrentUser('sub') adminId: string, @Body() dto: CreateSaleDto) {
    return this.flashSale.createSale(adminId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateSaleDto) {
    return this.flashSale.updateSale(id, dto, actorOf(user));
  }

  @Delete(':id')
  removeSale(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.flashSale.deleteSale(id, actorOf(user));
  }

  @Post(':id/items')
  addItem(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: AddItemDto) {
    return this.flashSale.addItem(id, dto, actorOf(user));
  }

  @Delete('items/:itemId')
  removeItem(@CurrentUser() user: JwtPayload, @Param('itemId') itemId: string) {
    return this.flashSale.removeItem(itemId, actorOf(user));
  }
}
