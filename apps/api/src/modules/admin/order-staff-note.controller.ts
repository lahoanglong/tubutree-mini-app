import { Body, Controller, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Trim } from '../../common/decorators/trim.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { ORDER_STAFF_NOTE_MAX, OrderStaffNoteService } from './order-staff-note.service';

export class SaveOrderStaffNoteDto {
  /** Chữ rỗng (sau khi cắt khoảng trắng hai đầu) là xoá ghi chú. */
  @Trim() @IsString() @MaxLength(ORDER_STAFF_NOTE_MAX, { message: `Ghi chú nội bộ tối đa ${ORDER_STAFF_NOTE_MAX} ký tự.` }) note!: string;
  /** Mốc `updatedAt` của ghi chú người sửa đang thấy; null khi lúc mở đơn chưa có ghi chú. Bắt buộc gửi (null hay chuỗi ISO). */
  @ValidateIf((o: SaveOrderStaffNoteDto) => o.baseUpdatedAt !== null)
  @IsISO8601({ strict: true })
  baseUpdatedAt!: string | null;
}

/**
 * Ghi chú nội bộ cho kho trên đơn còn mở: ADMIN và nhân viên CSKH ghi, kho đọc ở chi tiết đơn và phiếu soạn hàng.
 * Controller riêng để không phình AdminController; route `orders/:id/staff-note` không đè route nào của nó.
 */
@ApiTags('admin-orders')
@Roles('ADMIN')
@Controller('admin/orders')
export class OrderStaffNoteController {
  constructor(private readonly notes: OrderStaffNoteService) {}

  @AllowStaff('CSKH')
  @Put(':id/staff-note')
  save(@CurrentUser('sub') actorId: string, @Param('id') id: string, @Body() dto: SaveOrderStaffNoteDto) {
    return this.notes.save(actorId, id, dto.note, dto.baseUpdatedAt);
  }
}
