import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AttendanceService } from './attendance.service';
import { ManualCheckoutDto } from './attendance.dto';

@ApiTags('admin-attendance')
@Roles('ADMIN')
@Controller('admin/attendance')
export class AdminAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('live')
  live() {
    return this.attendance.listLive();
  }

  @Post('manual-checkout')
  manualCheckout(@Body() dto: ManualCheckoutDto) {
    return this.attendance.manualCheckout(dto.sessionId);
  }
}
