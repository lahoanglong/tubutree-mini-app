import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FlashSaleService } from './flash-sale.service';

class CreateSaleDto {
  @IsString() title!: string;
  @IsString() startAt!: string;
  @IsString() endAt!: string;
}
class UpdateSaleDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() startAt?: string;
  @IsOptional() @IsString() endAt?: string;
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

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: AddItemDto) {
    return this.flashSale.addItem(id, dto);
  }

  @Delete('items/:itemId')
  removeItem(@Param('itemId') itemId: string) {
    return this.flashSale.removeItem(itemId);
  }
}
