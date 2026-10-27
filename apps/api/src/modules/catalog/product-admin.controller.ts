import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';
import { PRODUCT_CATEGORIES_MAX, PRODUCT_IMAGES_MAX, ProductAdminService } from './product-admin.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
// Ảnh base64 nén tới ~1,5 triệu ký tự (cùng trần ảnh gian hàng); trần body 10 MB ở main.ts đủ cho 8 ảnh nén.
const IMAGE_MAX = 1_500_000;

export class UpdateProductDto {
  @OptionalNotNull() @IsArray() @ArrayMaxSize(PRODUCT_IMAGES_MAX) @IsString({ each: true }) @MaxLength(IMAGE_MAX, { each: true }) images?: string[];
  @OptionalNotNull() @IsString() @MaxLength(6000) description?: string;
  /** null hoặc chuỗi rỗng = xoá mô tả ngắn. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @Transform(trim) @IsString() @MaxLength(400) shortDesc?: string | null;
  @OptionalNotNull() @IsBoolean() isActive?: boolean;
  @OptionalNotNull() @IsBoolean() isFeatured?: boolean;
  @OptionalNotNull() @IsArray() @ArrayMaxSize(PRODUCT_CATEGORIES_MAX + 5) @IsString({ each: true }) @MaxLength(64, { each: true }) categoryIds?: string[];
}

/** Sửa sản phẩm: ảnh, mô tả, ẩn/hiện, nổi bật, danh mục. Chỉ ADMIN; tên và giá không sửa ở đây (xem ProductAdminService). */
@ApiTags('admin-catalog')
@Roles('ADMIN')
@Controller('admin/catalog-products')
export class ProductAdminController {
  constructor(private readonly svc: ProductAdminService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Patch(':id')
  update(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.svc.update(adminId, id, dto);
  }
}
