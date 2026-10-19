import { BadRequestException, Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { Env } from '../../../config/env.validation';
import { DateRangeQuery } from '../dto/staff-query.dto';
import { parseDateRange } from '../date-range';
import { AttendanceService, type Coords } from './attendance.service';
import { PayrollService } from '../payroll/payroll.service';
import { resolveZaloLocation } from './zalo-location';
import { CheckinDto, CheckoutDto, HeartbeatDto } from './attendance.dto';

@ApiTags('staff-attendance')
@Roles('STAFF', 'ADMIN')
@Controller('staff/attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly config: ConfigService<Env, true>,
    private readonly payroll: PayrollService,
  ) {}

  @Get('status')
  status(@CurrentUser('sub') staffId: string) {
    return this.attendance.status(staffId);
  }

  @Post('checkin')
  async checkin(
    @CurrentUser('sub') staffId: string,
    @Body() dto: CheckinDto,
    @Req() req: Request,
  ) {
    const coords = await this.resolveCoords(dto);
    const ip = this.clientIp(req);
    const owner = await this.attendance.shiftOwner(dto.shiftId);
    // Phiên mới vào tháng đã chốt/đã trả thì net không bao giờ gồm giờ công đó: chặn trước khi tạo phiên. Kiểm tháng và tạo
    // phiên cùng khoá tháng, nên "Đã chi" không chen vào giữa. Ca của người khác vẫn bị checkin() trả 404 như cũ.
    return this.payroll.writeInMonth(
      staffId,
      owner.workDate,
      (tx) => this.attendance.checkin(staffId, ip, { shiftId: dto.shiftId, ...coords }, tx),
      'Tháng lương đã chốt/đã trả — nhờ quản lý mở lại tháng trước khi chấm công.',
      { recompute: false },
    );
  }

  @Post('checkout')
  checkout(@CurrentUser('sub') staffId: string, @Body() dto: CheckoutDto) {
    return this.attendance.checkout(staffId, dto.at ? new Date(dto.at) : undefined);
  }

  @Get('history')
  history(@CurrentUser('sub') staffId: string, @Query() query: DateRangeQuery) {
    const { f, t } = parseDateRange(query.from, query.to);
    return this.attendance.history(staffId, f, t);
  }

  @Post('heartbeat')
  async heartbeat(
    @CurrentUser('sub') staffId: string,
    @Body() dto: HeartbeatDto,
    @Req() req: Request,
  ) {
    const coords = await this.resolveCoords(dto);
    return this.attendance.heartbeat(staffId, this.clientIp(req), coords);
  }

  private clientIp(req: Request): string {
    // Express trust proxy=1 (prod) → req.ip là IP thật sau Caddy.
    return req.ip ?? '';
  }

  private async resolveCoords(dto: CheckinDto | HeartbeatDto): Promise<Coords> {
    if (dto.locationToken && dto.zaloAccessToken) {
      const secret = this.config.get('ZALO_APP_SECRET', { infer: true });
      const c = await resolveZaloLocation(secret, dto.locationToken, dto.zaloAccessToken);
      if (c) return c;
    }
    if (typeof dto.lat === 'number' && typeof dto.lng === 'number') {
      return { lat: dto.lat, lng: dto.lng };
    }
    throw new BadRequestException('Không lấy được vị trí. Vui lòng bật GPS và thử lại.');
  }
}
