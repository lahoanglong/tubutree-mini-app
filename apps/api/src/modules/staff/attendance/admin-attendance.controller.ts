import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AttendanceService } from './attendance.service';
import type { PayrollService } from '../payroll/payroll.service';
import type { AddSessionDto, EditSessionDto, ManualCheckoutDto } from './attendance.dto';

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

  @Post('manual-checkout')
  manualCheckout(@Body() dto: ManualCheckoutDto) {
    return this.attendance.manualCheckout(dto.sessionId);
  }

  /** QL sửa giờ phiên → recompute lương ngày đó. */
  @Post('session/:id/edit')
  async editSession(@Param('id') id: string, @Body() dto: EditSessionDto) {
    const { staffId, workDate } = await this.attendance.adminEditSession(id, {
      checkinAt: dto.checkinAt ? new Date(dto.checkinAt) : undefined,
      checkoutAt: dto.checkoutAt ? new Date(dto.checkoutAt) : undefined,
    });
    await this.payroll.recomputeDay(staffId, workDate);
    return { updated: true };
  }

  /** QL thêm phiên thủ công (NV quên chấm) → recompute. */
  @Post('session')
  async addSession(@Body() dto: AddSessionDto) {
    const { staffId, workDate } = await this.attendance.adminAddSession(
      dto.shiftId,
      new Date(dto.checkinAt),
      new Date(dto.checkoutAt),
    );
    await this.payroll.recomputeDay(staffId, workDate);
    return { added: true };
  }
}
