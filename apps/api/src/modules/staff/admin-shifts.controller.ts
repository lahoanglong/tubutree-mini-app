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
  ApproveShiftDto,
  BulkApproveDto,
  RejectShiftDto,
  ShiftTemplateDto,
  UpdateShiftTemplateDto,
} from './shifts/dto/shift.dto';

@ApiTags('admin-shifts')
@Roles('ADMIN')
@Controller('admin')
export class AdminShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get('shifts')
  listAll(@Query('from') from: string, @Query('to') to: string, @Query('staffId') staffId?: string) {
    if (!from || !to) throw new BadRequestException('Thiếu khoảng thời gian (from/to).');
    const f = new Date(from);
    const t = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
      throw new BadRequestException('from/to không hợp lệ.');
    }
    return this.shifts.listAll(f, t, staffId);
  }

  @Post('shifts/:id/approve')
  approve(
    @CurrentUser('sub') adminId: string,
    @Param('id') id: string,
    @Body() dto: ApproveShiftDto,
  ) {
    return this.shifts.approve(adminId, id, {
      approvedStart: dto.approvedStart ? new Date(dto.approvedStart) : undefined,
      approvedEnd: dto.approvedEnd ? new Date(dto.approvedEnd) : undefined,
    });
  }

  @Post('shifts/:id/reject')
  reject(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: RejectShiftDto) {
    return this.shifts.reject(adminId, id, dto.reason);
  }

  @Post('shifts/bulk-approve')
  bulkApprove(@CurrentUser('sub') adminId: string, @Body() dto: BulkApproveDto) {
    return this.shifts.bulkApprove(adminId, dto.ids);
  }

  // ── Ca chuẩn ──
  @Get('shift-templates')
  listTemplates() {
    return this.shifts.listAllTemplates();
  }

  @Post('shift-templates')
  createTemplate(@Body() dto: ShiftTemplateDto) {
    return this.shifts.createTemplate(dto);
  }

  @Patch('shift-templates/:id')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateShiftTemplateDto) {
    return this.shifts.updateTemplate(id, dto);
  }

  @Delete('shift-templates/:id')
  deleteTemplate(@Param('id') id: string) {
    return this.shifts.deleteTemplate(id);
  }
}
