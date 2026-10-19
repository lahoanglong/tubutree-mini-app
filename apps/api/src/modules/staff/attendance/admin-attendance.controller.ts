import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AttendanceService } from './attendance.service';
import { PayrollService } from '../payroll/payroll.service';
import { AddSessionDto, EditSessionDto, ManualCheckoutDto } from './attendance.dto';

@ApiTags('admin-attendance')
@Roles('ADMIN')
@Controller('admin/attendance')
export class AdminAttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly payroll: PayrollService,
  ) {}

  @Get('live')
  live() {
    return this.attendance.listLive();
  }

  /** "Chốt ra ca" cho phiên nhân viên quên ra ca → tính lại lương ngày đó (tháng đã chốt thì không cho đóng). */
  @Post('manual-checkout')
  async manualCheckout(@Body() dto: ManualCheckoutDto) {
    const owner = await this.attendance.sessionOwner(dto.sessionId);
    // Kiểm khoá tháng, ghi phiên và tính lại lương nằm chung một transaction dưới khoá tháng: kiểm ngoài khoá thì
    // "Đã chi" chen vào giữa và phiên đổi trong tháng PAID.
    return this.payroll.writeInMonth(owner.staffId, owner.workDate, (tx) => this.attendance.manualCheckout(dto.sessionId, tx));
  }

  /** QL sửa giờ phiên → recompute lương ngày đó. */
  @Post('session/:id/edit')
  async editSession(@Param('id') id: string, @Body() dto: EditSessionDto) {
    const owner = await this.attendance.sessionOwner(id);
    await this.payroll.writeInMonth(owner.staffId, owner.workDate, (tx) =>
      this.attendance.adminEditSession(
        id,
        {
          checkinAt: dto.checkinAt ? new Date(dto.checkinAt) : undefined,
          checkoutAt: dto.checkoutAt ? new Date(dto.checkoutAt) : undefined,
        },
        tx,
      ),
    );
    return { updated: true };
  }

  /** QL thêm phiên thủ công (NV quên chấm) → recompute. */
  @Post('session')
  async addSession(@Body() dto: AddSessionDto) {
    const owner = await this.attendance.shiftOwner(dto.shiftId);
    await this.payroll.writeInMonth(owner.staffId, owner.workDate, (tx) =>
      this.attendance.adminAddSession(dto.shiftId, new Date(dto.checkinAt), new Date(dto.checkoutAt), tx),
    );
    return { added: true };
  }
}
