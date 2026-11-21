import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { JwtPayload } from '@tubutree/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { AllowStaff } from '../../../common/staff-permissions';
import { BULK_STATUS_MAX, BULK_STATUS_TARGETS, type BulkStatusTarget } from './order-bulk-status';
import { OrderBulkStatusService } from './order-bulk-status.service';

export class BulkOrderStatusDto {
  @IsArray({ message: 'Danh sách đơn không hợp lệ.' })
  @ArrayMinSize(1, { message: 'Chọn ít nhất một đơn.' })
  @ArrayMaxSize(BULK_STATUS_MAX, { message: `Mỗi lượt tối đa ${BULK_STATUS_MAX} đơn.` })
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  orderIds!: string[];

  @IsIn(BULK_STATUS_TARGETS, { message: 'Đổi hàng loạt chỉ nhận «Đã đóng gói» hoặc «Đã huỷ».' })
  targetStatus!: BulkStatusTarget;

  /** true: chỉ xem trước kết quả từng đơn, không ghi gì. */
  @IsOptional() @IsBoolean() dryRun?: boolean;

  /** Lý do huỷ: khách đọc nguyên văn trong thông báo huỷ đơn (cùng trần với nút trạng thái từng đơn). */
  @OptionalNotNull() @IsString() @MaxLength(500) @Trim() note?: string;
}

/**
 * Thao tác hàng loạt trên tab Đơn hàng. Cùng quyền với nút trạng thái từng đơn (`PUT /admin/orders/:id/status`): ADMIN, nhân viên CSKH (chỉ huỷ)
 * và KHO (chỉ đánh dấu Đã đóng gói); nhóm việc được xét lại cho từng đơn trong service. Đặt ở controller riêng để không đụng AdminController.
 */
@Roles('ADMIN')
@Controller('admin/orders')
export class BulkOpsController {
  constructor(private readonly bulkStatus: OrderBulkStatusService) {}

  @AllowStaff('CSKH', 'KHO')
  @Post('bulk-status')
  @HttpCode(200)
  bulkOrderStatus(@CurrentUser() actor: JwtPayload, @Body() dto: BulkOrderStatusDto) {
    return this.bulkStatus.run(actor, dto);
  }
}
