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
  @IsInt() @Min(0) @Max(999) quantity!: number; // 0 = xóa
}

export class ApplyCouponDto {
  @IsString() code!: string;
}

/** Gian hàng đang ghi công (cùng chuỗi báo giá nhận): giỏ trừ combo của gian hàng đó như checkout. */
export class CartQueryDto {
  @IsOptional() @IsString() @MaxLength(200) storefrontSlug?: string;
  /** ID các dòng giỏ được chọn, cách nhau bằng dấu phẩy: giá trả về là của riêng phần chọn (như báo giá có itemIds). Rỗng/thiếu = cả giỏ. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  itemIds?: string[];
}
