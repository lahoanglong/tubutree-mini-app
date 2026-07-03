import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PayrollService } from './payroll.service';
import { AdjustDto, FinalizeDto, MarkPaidDto, SetRateDto } from './payroll.dto';

@ApiTags('admin-payroll')
@Roles('ADMIN')
@Controller('admin')
export class AdminPayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('payroll')
  month(@Query('year') year: string, @Query('month') month: string) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('Thiếu hoặc sai year/month.');
    }
    return this.payroll.adminMonth(y, m);
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
    return this.payroll.recomputeStaffMonth(staffId, Number(year), Number(month));
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
