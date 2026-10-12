import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class HomeMeQuery {
  /** Số SP của kệ "Mua lại" — cùng trần với PurchasedItemsQuery.limit. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  purchasedLimit?: number;
}
