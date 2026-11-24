import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { PICK_LIST_ID_MAX_LEN, PICK_LIST_MAX } from './pick-list';
import { PickListService } from './pick-list.service';

export class PickListQuery {
  /** Mã đơn (id hoặc mã TB…) cách nhau dấu phẩy; số lượng và độ dài từng mã kiểm ở `parsePickListIds`. */
  @IsOptional()
  @IsString()
  @MaxLength(PICK_LIST_MAX * (PICK_LIST_ID_MAX_LEN + 1), { message: `Mỗi lượt in tối đa ${PICK_LIST_MAX} đơn.` })
  ids?: string;
}

/**
 * In phiếu soạn hàng hàng loạt (chỉ đọc). Mở cho ADMIN và nhân viên KHO, cùng nhóm với «Đã đóng gói» ở thanh thao tác hàng loạt.
 * Controller riêng để không đụng AdminController; `pick-list` là đoạn tĩnh nên không đè lên các route `orders/:id/...`.
 */
@Roles('ADMIN')
@Controller('admin/orders')
export class PickListController {
  constructor(private readonly pickList: PickListService) {}

  @AllowStaff('KHO')
  @Get('pick-list')
  get(@Query() q: PickListQuery) {
    return this.pickList.build(q.ids);
  }
}
