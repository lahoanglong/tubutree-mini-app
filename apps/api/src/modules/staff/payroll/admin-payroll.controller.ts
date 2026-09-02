import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PayrollService } from './payroll.service';
import { AttendanceService } from '../attendance/attendance.service';
import { AdjustDto, FinalizeDto, MarkPaidDto, SetRateDto } from './payroll.dto';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function parseYearMonth(year: string, month: string): { y: number; m: number } {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new BadRequestException('Thiếu hoặc sai year/month.');
  }
  return { y, m };
}

@ApiTags('admin-payroll')
@Roles('ADMIN')
@Controller('admin')
export class AdminPayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly attendance: AttendanceService,
  ) {}

  @Get('payroll')
  month(@Query('year') year: string, @Query('month') month: string) {
    const { y, m } = parseYearMonth(year, month);
    return this.payroll.adminMonth(y, m);
  }

  /** Chi tiết 1 NV trong tháng: giờ theo ngày + lịch sử phiên (để QL rà & sửa trước khi duyệt). */
  @Get('payroll/:staffId/detail')
  async detail(@Param('staffId') staffId: string, @Query('year') year: string, @Query('month') month: string) {
    const { y, m } = parseYearMonth(year, month);
    const base = await this.payroll.getMyPayroll(staffId, y, m);
    // Biên tháng theo giờ VN quy đổi sang UTC — attendance.history() lọc theo checkinAt (mốc
    // thời gian thật), khác với workDate (@db.Date, đã là date-key VN) dùng cho payroll ngày/tháng.
    // Biên UTC "trần" (Date.UTC(y, m-1, 1)) lệch tới 7h, làm rơi/nhiễu phiên ở đầu-cuối tháng.
    const start = new Date(Date.UTC(y, m - 1, 1) - VN_OFFSET_MS);
    const end = new Date(Date.UTC(y, m, 1) - VN_OFFSET_MS - 1);
    const sessions = await this.attendance.history(staffId, start, end);
    return { ...base, sessions };
  }

  @Put('staff/:userId/rate')
  setRate(@Param('userId') userId: string, @Body() dto: SetRateDto) {
    return this.payroll.setRate(userId, dto.hourlyRate);
  }

  @Post('payroll/:staffId/recompute')
  recompute(
    @Param('staffId') staffId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const { y, m } = parseYearMonth(year, month);
    return this.payroll.recomputeStaffMonth(staffId, y, m);
  }

  @Post('payroll/:staffId/finalize')
  finalize(@Param('staffId') staffId: string, @Body() dto: FinalizeDto) {
    return this.payroll.finalize(staffId, dto.year, dto.month);
  }

  @Post('payroll/:staffId/mark-paid')
  markPaid(
    @CurrentUser('sub') adminId: string,
    @Param('staffId') staffId: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.payroll.markPaid(staffId, dto.year, dto.month, dto.proofImageUrl, dto.note, adminId);
  }

  @Post('payroll/adjust')
  adjust(@CurrentUser('sub') adminId: string, @Body() dto: AdjustDto) {
    return this.payroll.adjust(
      dto.staffId,
      new Date(`${dto.workDate}T00:00:00.000Z`),
      dto.amount,
      dto.reason,
      adminId,
    );
  }
}
