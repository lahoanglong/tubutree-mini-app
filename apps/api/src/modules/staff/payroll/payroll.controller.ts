import { BadRequestException, Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { PayrollService } from './payroll.service';
import type { UpdateBankDto } from './payroll.dto';

@ApiTags('staff-payroll')
@Roles('STAFF', 'ADMIN')
@Controller('staff')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('payroll')
  myPayroll(
    @CurrentUser('sub') staffId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('Thiếu hoặc sai year/month.');
    }
    return this.payroll.getMyPayroll(staffId, y, m);
  }

  @Put('bank')
  updateBank(@CurrentUser('sub') staffId: string, @Body() dto: UpdateBankDto) {
    return this.payroll.updateBank(staffId, dto);
  }
}
