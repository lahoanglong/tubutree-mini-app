import { IsInt, IsString, Max, Min } from 'class-validator';

export class AddItemDto {
  @IsString() variationId!: string;
  @IsInt() @Min(1) @Max(999) quantity!: number;
}

export class UpdateItemDto {
  @IsInt() @Min(0) @Max(999) quantity!: number; // 0 = xóa
}

export class ApplyCouponDto {
  @IsString() code!: string;
}
