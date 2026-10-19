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
import { AdminShiftsQuery } from './dto/staff-query.dto';
import { parseDateRange } from './date-range';
import { ShiftsService } from './shifts/shifts.service';
import { PAYROLL_MONTH_LOCKED_MSG, PayrollService } from './payroll/payroll.service';
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
  constructor(
    private readonly shifts: ShiftsService,
    private readonly payroll: PayrollService,
  ) {}

  @Get('shifts')
  listAll(@Query() query: AdminShiftsQuery) {
    const { f, t } = parseDateRange(query.from, query.to);
    return this.shifts.listAll(f, t, query.staffId);
  }

  @Post('shifts/:id/approve')
  async approve(
    @CurrentUser('sub') adminId: string,
    @Param('id') id: string,
    @Body() dto: ApproveShiftDto,
  ) {
    const times = {
      approvedStart: dto.approvedStart ? new Date(dto.approvedStart) : undefined,
      approvedEnd: dto.approvedEnd ? new Date(dto.approvedEnd) : undefined,
    };
    const [owner] = await this.shifts.owners([id]);
    if (!owner) return this.shifts.approve(adminId, id, times);
    // Duyệt ca (và giờ duyệt) là đầu vào của lương: tháng đã chốt/đã trả thì chặn, và kiểm tháng nằm trong khoá tháng.
    return this.payroll.writeInMonth(owner.staffId, owner.workDate, (tx) => this.shifts.approve(adminId, id, times, tx), undefined, {
      recompute: false,
    });
  }

  @Post('shifts/:id/reject')
  reject(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: RejectShiftDto) {
    return this.shifts.reject(adminId, id, dto.reason);
  }

  /** Ca của tháng lương đã chốt/đã trả được bỏ qua (nằm trong `skipped`), các ca còn lại vẫn duyệt. */
  @Post('shifts/bulk-approve')
  async bulkApprove(@CurrentUser('sub') adminId: string, @Body() dto: BulkApproveDto) {
    const groups = new Map<string, { staffId: string; workDate: Date; ids: string[] }>();
    for (const o of await this.shifts.owners(dto.ids)) {
      const key = `${o.staffId}:${o.workDate.getUTCFullYear()}-${o.workDate.getUTCMonth()}`;
      const g = groups.get(key) ?? { staffId: o.staffId, workDate: o.workDate, ids: [] };
      g.ids.push(o.id);
      groups.set(key, g);
    }
    let approved = 0;
    let skipped = 0;
    for (const g of groups.values()) {
      try {
        const r = await this.payroll.writeInMonth(g.staffId, g.workDate, (tx) => this.shifts.bulkApprove(adminId, g.ids, tx), undefined, {
          recompute: false,
        });
        approved += r.approved;
      } catch (err) {
        if (!(err instanceof BadRequestException) || err.message !== PAYROLL_MONTH_LOCKED_MSG) throw err;
        skipped += g.ids.length;
      }
    }
    return { approved, skipped };
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
