import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/** `GET /checkout/shipping-estimate?subtotal=<đ>&provinceCode=<mã|rỗng>`. */
export class ShippingEstimateQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  subtotal!: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsString()
  @Matches(/^[0-9A-Za-z_]{1,24}$/)
  provinceCode?: string;
}
