import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsISO8601, IsNotEmpty, IsObject, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CATEGORY_APPLY_MAX, CategorySuggestionService, type CategoryApplyItem } from './category-suggestion.service';
import { PRODUCT_CATEGORIES_MAX } from './product-admin.service';

export class CategoryApplyItemDto implements CategoryApplyItem {
  @IsString() @IsNotEmpty() @MaxLength(64) productId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(PRODUCT_CATEGORIES_MAX) @ArrayUnique() @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(64, { each: true }) categoryIds!: string[];
  @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
}

export class CategoryApplyDto {
  // Như SeoApplyDto: phần tử không phải đối tượng bị 400 ở `IsObject`, `i?.productId` để `ArrayUnique` không ném TypeError (500) trên `null`.
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(CATEGORY_APPLY_MAX) @IsObject({ each: true }) @ArrayUnique((i: CategoryApplyItemDto | null) => i?.productId) @ValidateNested({ each: true }) @Type(() => CategoryApplyItemDto) items!: CategoryApplyItemDto[];
}

/** Gán danh mục hàng loạt theo gợi ý: đọc gợi ý (không ghi) và áp dụng bản admin đã duyệt. Chỉ ADMIN. */
@ApiTags('admin-catalog')
@Roles('ADMIN')
@Controller('admin/catalog/category-suggestions')
export class CategorySuggestionController {
  constructor(private readonly svc: CategorySuggestionService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post('apply')
  apply(@CurrentUser('sub') adminId: string, @Body() dto: CategoryApplyDto) {
    return this.svc.apply(adminId, dto.items);
  }
}
