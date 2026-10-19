import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPageQuery } from '../../common/cursor-page-query.dto';
import { clampTake } from '../../common/pagination';
import { CATEGORY_ASSIGN_MAX_PRODUCTS, ProductCategoryAdminService, type CategoryAssignMode } from './product-category-admin.service';

const flag = ({ value }: { value: unknown }) =>
  value === '1' || value === 'true' ? true : value === '0' || value === 'false' || value === '' ? false : value;

export class ListCategoryProductsQuery extends CursorPageQuery {
  @IsOptional() @IsString() @MaxLength(64) q?: string;
  /** `?uncategorized=1`: chỉ sản phẩm chưa có danh mục nào. */
  @IsOptional() @Transform(flag) @IsBoolean() uncategorized?: boolean;
  @IsOptional() @IsIn(['pancake', 'all']) source?: 'pancake' | 'all';
  @IsOptional() @IsString() @MaxLength(64) categoryId?: string;
}

export class AssignCategoryDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(CATEGORY_ASSIGN_MAX_PRODUCTS) @IsString({ each: true }) @MaxLength(64, { each: true }) productIds!: string[];
  @IsString() @IsNotEmpty() @MaxLength(64) categoryId!: string;
  @IsIn(['ADD', 'REMOVE']) mode!: CategoryAssignMode;
}

/** Gán danh mục hàng loạt cho sản phẩm (kể cả hàng đồng bộ Pancake). Chỉ ADMIN. */
@ApiTags('admin-catalog')
@Roles('ADMIN')
@Controller('admin/product-categories')
export class ProductCategoryAdminController {
  constructor(private readonly svc: ProductCategoryAdminService) {}

  @Get('products')
  list(@Query() q: ListCategoryProductsQuery) {
    return this.svc.listProducts({
      q: q.q,
      uncategorized: q.uncategorized,
      source: q.source,
      categoryId: q.categoryId,
      cursor: q.cursor,
      take: clampTake(q.take, 50, 100),
    });
  }

  @Post('assign')
  assign(@CurrentUser('sub') adminId: string, @Body() dto: AssignCategoryDto) {
    return this.svc.assign(adminId, dto.productIds, dto.categoryId, dto.mode);
  }
}
