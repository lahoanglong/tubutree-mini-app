import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AddItemDto {
  @IsString() variationId!: string;
  @IsInt() @Min(1) @Max(999) quantity!: number;
  @IsOptional()
  @IsIn(['pdp', 'buy_now', 'repurchase', 'wishlist', 'ctv_sheet', 'reorder_notification'])
  addSource?: string;
}

export class UpdateItemDto {
  @IsInt() @Min(0) @Max(999) quantity!: number; // 0 = xoá
}

export class ApplyCouponDto {
  @IsString() code!: string;
}

/** `?itemIds=a,b` hoặc lặp tham số (`itemIds=a&itemIds=b,c`): tách dấu phẩy ở từng phần tử, bỏ rỗng và trùng. Giá trị lạ để validator từ chối. */
function splitIds(value: unknown): unknown {
  const parts = Array.isArray(value) ? value : [value];
  if (!parts.every((p) => typeof p === 'string')) return value;
  return [...new Set((parts as string[]).flatMap((p) => p.split(',')).filter(Boolean))];
}

/** Gian hàng đang ghi công (cùng chuỗi báo giá nhận): giỏ trừ combo của gian hàng đó như checkout. */
export class CartQueryDto {
  @IsOptional() @IsString() @MaxLength(200) storefrontSlug?: string;
  /** ID các dòng giỏ được chọn, cách nhau bằng dấu phẩy: giá trả về là của riêng phần chọn (như báo giá có itemIds). Rỗng/thiếu = cả giỏ. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => splitIds(value))
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  itemIds?: string[];
}
