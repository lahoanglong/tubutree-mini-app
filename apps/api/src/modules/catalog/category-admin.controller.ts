import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Trim } from '../../common/decorators/trim.decorator';
import { CategoryAdminService } from './category-admin.service';
import { CATEGORY_MAX_CHILDREN, CATEGORY_NAME_MAX } from './category-tree';

export class CreateCategoryDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(CATEGORY_NAME_MAX) name!: string;
  @IsOptional() @IsString() @MaxLength(64) parentId?: string;
}

export class UpdateCategoryDto {
  @OptionalNotNull() @Trim() @IsString() @IsNotEmpty() @MaxLength(CATEGORY_NAME_MAX) name?: string;
  /** `null` = chuyển lên tầng gốc; bỏ trường = giữ nguyên cha. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(64) parentId?: string | null;
}

export class ReorderCategoriesDto {
  /** Cha của nhóm đang sắp; `null` = nhóm gốc. */
  @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(64) parentId!: string | null;
  /** Toàn bộ id anh em theo thứ tự mới (trần 8 vì mỗi nhóm tối đa 8 mục). */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(CATEGORY_MAX_CHILDREN) @IsString({ each: true }) @MaxLength(64, { each: true }) orderedIds!: string[];
}

/** Cây danh mục hai tầng của gian hàng. Cùng quyền với gán danh mục cho sản phẩm: chỉ ADMIN. */
@ApiTags('admin-catalog')
@Roles('ADMIN')
@Controller('admin/categories')
export class CategoryAdminController {
  constructor(private readonly svc: CategoryAdminService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  create(@CurrentUser('sub') adminId: string, @Body() dto: CreateCategoryDto) {
    return this.svc.create(adminId, dto);
  }

  // Khai trước `:id` cho dễ đọc; khác phương thức nên không tranh đường với PATCH/DELETE.
  @Put('order')
  reorder(@CurrentUser('sub') adminId: string, @Body() dto: ReorderCategoriesDto) {
    return this.svc.reorder(adminId, dto.parentId, dto.orderedIds);
  }

  @Patch(':id')
  update(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.svc.update(adminId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.svc.remove(adminId, id);
  }
}
