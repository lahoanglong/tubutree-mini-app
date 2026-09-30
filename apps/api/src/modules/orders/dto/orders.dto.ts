import { IsIn, IsOptional } from 'class-validator';
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
