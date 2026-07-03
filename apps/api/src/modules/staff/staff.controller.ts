import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShiftsService } from './shifts/shifts.service';
import {
  CancelShiftDto,
  CopyWeekDto,
  CreateShiftsDto,
  UpdateShiftDto,
} from './shifts/dto/shift.dto';

/** Endpoint self-service cho nhân viên (và admin cũng là nhân viên). */
@ApiTags('staff')
@Roles('STAFF', 'ADMIN')
@Controller('staff')
export class StaffController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get('shift-templates')
  templates() {
    return this.shifts.listTemplates();
  }

  @Get('shifts')
  listShifts(
    @CurrentUser('sub') staffId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!from || !to) throw new BadRequestException('Thiếu khoảng thời gian (from/to).');
    return this.shifts.listShifts(staffId, new Date(from), new Date(to));
  }

  @Post('shifts')
  createShifts(@CurrentUser('sub') staffId: string, @Body() dto: CreateShiftsDto) {
    return this.shifts.createShifts(
      staffId,
      dto.items.map((i) => ({
        workDate: new Date(i.workDate),
        startAt: new Date(i.startAt),
        endAt: new Date(i.endAt),
        templateId: i.templateId,
      })),
    );
  }

  @Patch('shifts/:id')
  updateShift(
    @CurrentUser('sub') staffId: string,
    @Param('id') id: string,
    @Body() dto: UpdateShiftDto,
  ) {
    return this.shifts.updateShift(staffId, id, {
      startAt: dto.startAt ? new Date(dto.startAt) : undefined,
      endAt: dto.endAt ? new Date(dto.endAt) : undefined,
    });
  }

  @Delete('shifts/:id')
  deleteShift(@CurrentUser('sub') staffId: string, @Param('id') id: string) {
    return this.shifts.deleteShift(staffId, id);
  }

  @Post('shifts/copy-week')
  copyWeek(@CurrentUser('sub') staffId: string, @Body() dto: CopyWeekDto) {
    return this.shifts.copyWeek(staffId, new Date(dto.sourceWeekStart), new Date(dto.targetWeekStart));
  }

  @Post('shifts/:id/cancel')
  cancelShift(
    @CurrentUser('sub') staffId: string,
    @Param('id') id: string,
    @Body() dto: CancelShiftDto,
  ) {
    return this.shifts.cancelShift(staffId, id, dto);
  }
}
