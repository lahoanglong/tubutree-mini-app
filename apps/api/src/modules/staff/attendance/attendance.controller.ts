import { BadRequestException, Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { Env } from '../../../config/env.validation';
import { AttendanceService, type Coords } from './attendance.service';
import { resolveZaloLocation } from './zalo-location';
import { CheckinDto, HeartbeatDto } from './attendance.dto';

@ApiTags('staff-attendance')
@Roles('STAFF', 'ADMIN')
@Controller('staff/attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly config: ConfigService<Env, true>,
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
    return this.attendance.checkin(staffId, this.clientIp(req), { shiftId: dto.shiftId, ...coords });
  }

  @Post('checkout')
  checkout(@CurrentUser('sub') staffId: string) {
    return this.attendance.checkout(staffId);
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
