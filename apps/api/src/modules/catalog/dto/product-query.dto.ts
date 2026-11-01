import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';
import { SEED_PATTERN } from '../catalog-seed';
import { SEARCH_Q_MAX_LENGTH } from './suggest-query.dto';

/** Query string luôn là chuỗi: 'true'/'1' → true, 'false'/'0' → false; giá trị khác để IsBoolean từ chối. */
function toBool({ value }: { value: unknown }): unknown {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}

/** Kiểu sắp xếp công khai của danh sách sản phẩm; dùng chung cho `/products` và `/brand/public/:slug/products`. */
export const PRODUCT_SORTS = ['price_asc', 'price_desc', 'newest', 'best_seller', 'best_seller_30d', 'rating'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export class ProductQuery extends PaginationQuery {
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() segment?: string; // forSegment (vd mom_baby)
  @IsOptional() @IsString() @MaxLength(SEARCH_Q_MAX_LENGTH) q?: string;

  @IsOptional()
  @IsIn([...PRODUCT_SORTS])
  sort?: ProductSort;

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

  /** Danh sách slug cách nhau bằng dấu phẩy (tối đa 20): lấy giá/trạng thái hiện hành của các sản phẩm đã xem gần đây. */
  @IsOptional() @IsString() @MaxLength(2000)
  slugs?: string;

  /** Điểm đánh giá trung bình tối thiểu (ratingAvg). Miniapp gửi 4 ("Từ 4★"). */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(5)
  minRating?: number;

  /** Ngày VN `YYYYMMDD`: xoay thứ tự mặc định (không `sort`, không `q`) ổn định trong ngày. Bỏ qua khi khách đã chọn cách sắp. */
  @IsOptional() @IsString() @Matches(SEED_PATTERN)
  seed?: string;
}
