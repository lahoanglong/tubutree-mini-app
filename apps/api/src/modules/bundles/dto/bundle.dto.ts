import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { ADDON_MAX_ITEMS, BUNDLE_MAX_QTY, BUNDLE_PCT_MAX_PRODUCTS } from '../bundle-admin-rules';

export const BUNDLE_KINDS = ['BUNDLE_PCT', 'ADDON'] as const;
export const BUNDLE_STATUSES = ['live', 'scheduled', 'ended', 'off'] as const;
/** Tối đa của hai loại: luật số món theo loại do `normalizeBundleContent` kiểm. */
const MAX_ITEMS = Math.max(BUNDLE_PCT_MAX_PRODUCTS, ADDON_MAX_ITEMS);

export class BundleItemDto {
  @IsString() @IsNotEmpty() @MaxLength(64) productId!: string;
  /** Ghim phân loại; bỏ hoặc null = mọi phân loại của sản phẩm. */
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64) variationId?: string | null;
  /** Chỉ ADDON: giá mua kèm mỗi đơn vị, nguyên và không âm (0đ hợp lệ). */
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) addonPrice?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(BUNDLE_MAX_QTY) maxQty?: number | null;
}

export class CreateBundleDto {
  @IsIn([...BUNDLE_KINDS]) kind!: (typeof BUNDLE_KINDS)[number];
  @Trim() @IsString() @IsNotEmpty() @MaxLength(120) title!: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) pct?: number | null;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64) anchorProductId?: string | null;
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_ITEMS) @ValidateNested({ each: true }) @Type(() => BundleItemDto) items!: BundleItemDto[];
}

/** Không nhận `kind`: đổi loại làm đổi cả luật của món, tạo bộ mới thay vì sửa. Có `items` thì thay cả danh sách. */
export class UpdateBundleDto {
  @OptionalNotNull() @Trim() @IsString() @IsNotEmpty() @MaxLength(120) title?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) pct?: number | null;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64) anchorProductId?: string | null;
  @OptionalNotNull() @IsDateString() startAt?: string;
  @OptionalNotNull() @IsDateString() endAt?: string;
  @OptionalNotNull() @IsBoolean() isActive?: boolean;
  @OptionalNotNull() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @OptionalNotNull() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_ITEMS) @ValidateNested({ each: true }) @Type(() => BundleItemDto) items?: BundleItemDto[];
}

export class AdminBundleListQuery {
  @IsOptional() @IsIn([...BUNDLE_STATUSES]) status?: (typeof BUNDLE_STATUSES)[number];
}
