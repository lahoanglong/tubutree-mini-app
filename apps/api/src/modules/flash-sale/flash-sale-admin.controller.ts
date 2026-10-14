import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Trim } from '../../common/decorators/trim.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FlashSaleService } from './flash-sale.service';

export class CreateSaleDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
}
class UpdateSaleDto {
  @IsOptional() @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class AddItemDto {
  @IsString() variationId!: string;
  @IsInt() @Min(1) flashPrice!: number;
  @IsInt() @Min(1) quota!: number;
  @IsOptional() @IsInt() @Min(1) perUserLimit?: number;
}

@Roles('ADMIN')
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
  update(@Param('id') id: string, @Body() dto: UpdateSaleDto) {
    return this.flashSale.updateSale(id, dto);
  }

  @Delete(':id')
  removeSale(@Param('id') id: string) {
    return this.flashSale.deleteSale(id);
  }

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: AddItemDto) {
    return this.flashSale.addItem(id, dto);
  }

  @Delete('items/:itemId')
  removeItem(@Param('itemId') itemId: string) {
    return this.flashSale.removeItem(itemId);
  }
}
