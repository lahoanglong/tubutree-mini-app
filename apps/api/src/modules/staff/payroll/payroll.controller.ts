import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PayrollService } from './payroll.service';
import { UpdateBankDto } from './payroll.dto';
import { YearMonthQuery } from '../dto/staff-query.dto';
import { parseYearMonth } from '../date-range';

@ApiTags('staff-payroll')
@Roles('STAFF', 'ADMIN')
@Controller('staff')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('payroll')
  myPayroll(@CurrentUser('sub') staffId: string, @Query() query: YearMonthQuery) {
    const { y, m } = parseYearMonth(query.year, query.month);
    return this.payroll.getMyPayroll(staffId, y, m);
  }

  @Put('bank')
  updateBank(@CurrentUser('sub') staffId: string, @Body() dto: UpdateBankDto) {
    return this.payroll.updateBank(staffId, dto);
  }
}
