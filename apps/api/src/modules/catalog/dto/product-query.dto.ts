import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

/** Query string luôn là chuỗi: 'true'/'1' → true, 'false'/'0' → false; giá trị khác để IsBoolean từ chối. */
function toBool({ value }: { value: unknown }): unknown {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}

export class ProductQuery extends PaginationQuery {
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() segment?: string; // forSegment (vd mom_baby)
  @IsOptional() @IsString() q?: string;

  @IsOptional()
  @IsIn(['price_asc', 'price_desc', 'newest', 'best_seller', 'rating'])
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'best_seller' | 'rating';

  // ── Dự án 4b (bộ lọc Browse). Đều tuỳ chọn → web shop và miniapp cũ gọi như trước. ──

  /** Giá đang bán tối thiểu (salePrice nếu có, không thì basePrice), VND. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000_000)
  minPrice?: number;

  /** Giá đang bán tối đa, VND. min > max → service tự đổi chỗ. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000_000)
  maxPrice?: number;

  /** Chỉ SP còn ít nhất 1 phân loại đang bán có tồn > 0. */
  @IsOptional() @Transform(toBool) @IsBoolean()
  inStock?: boolean;

  /** Điểm đánh giá trung bình tối thiểu (ratingAvg). Miniapp gửi 4 ("Từ 4★"). */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(5)
  minRating?: number;
}
