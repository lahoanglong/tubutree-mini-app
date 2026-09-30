import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { OrderStatus } from '@tubutree/shared-types';
import { PaginationQuery } from '../../../common/pagination';
import { ORDER_STATUS_GROUP_KEYS, type OrderStatusGroup } from '../order-status-groups';

export class OrderListQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'RETURNED', 'CANCELLED'])
  status?: OrderStatus;

  /** Tab gộp nhiều trạng thái. `status` (nếu có) thắng `group`. */
  @IsOptional()
  @IsIn(ORDER_STATUS_GROUP_KEYS)
  group?: OrderStatusGroup;
}

export class RepurchaseItemDto {
  @IsString() @MaxLength(64) orderItemId!: string;
  @IsInt() @Min(1) @Max(999) quantity!: number;
}

/** Body tuỳ chọn — không gửi = mua lại toàn bộ dòng như bản cũ (tương thích ngược). */
export class RepurchaseDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RepurchaseItemDto)
  items?: RepurchaseItemDto[];

  @IsOptional()
  @IsIn(['repurchase', 'reorder_notification'])
  addSource?: 'repurchase' | 'reorder_notification';
}

export class PurchasedItemsQuery {
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional() @IsString() @MaxLength(64) variationId?: string;
}
