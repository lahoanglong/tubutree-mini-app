import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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
