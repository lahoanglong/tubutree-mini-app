import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { JwtPayload } from '@tubutree/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { GoLiveCockpitService } from './golive-cockpit.service';
import { PILOT_CLEANUP_MAX, PILOT_PHONES_MAX } from './golive-pilot';
import { GoLivePilotService } from './golive-pilot.service';

/** `?phones=0901234567,0912345678`: SĐT người thử, cách nhau bằng dấu phẩy. */
export class PilotOrdersQuery {
  @IsOptional() @IsString() @MaxLength(PILOT_PHONES_MAX * 16) phones?: string;
}

export class PilotCleanupDto {
  /** Mặc định true: chỉ xem trước, không ghi gì. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
  @IsOptional() @IsString() @MaxLength(40) confirmText?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(PILOT_CLEANUP_MAX) @IsString({ each: true }) @MaxLength(40, { each: true }) codes?: string[];
  /** Đơn chỉ khớp SĐT người thử mà quản trị viên tự tick để dọn; phải nằm trong `codes`. */
  @IsOptional() @IsArray() @ArrayMaxSize(PILOT_CLEANUP_MAX) @IsString({ each: true }) @MaxLength(40, { each: true }) optInCodes?: string[];
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayMaxSize(PILOT_PHONES_MAX)
  @IsString({ each: true })
  @MaxLength(16, { each: true })
  phones?: string[];
}

const splitPhones = (raw?: string): string[] => (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Bảng kiểm Giờ G (`/admin/gio-g`). Chỉ ADMIN: thẻ hạ tầng nói khoá nào đã đặt và bàn dọn đơn thử huỷ được đơn, nên không mở cho nhóm việc nào
 * của nhân viên. Không route nào @Public: chưa đăng nhập thì JwtAuthGuard toàn app trả 401.
 */
@Roles('ADMIN')
@Controller('admin/golive')
export class GoLiveController {
  constructor(
    private readonly cockpitService: GoLiveCockpitService,
    private readonly pilot: GoLivePilotService,
  ) {}

  /** `?fresh=1` bỏ qua bộ nhớ đệm 15 giây (nút "Kiểm lại"). */
  @Get('cockpit')
  cockpit(@Query('fresh') fresh?: string) {
    return this.cockpitService.cockpit({ fresh: fresh === '1' });
  }

  @Get('pilot-orders')
  pilotOrders(@Query() q: PilotOrdersQuery) {
    return this.pilot.list(splitPhones(q.phones));
  }

  @Post('pilot-orders/cleanup')
  @HttpCode(200)
  cleanup(@CurrentUser() actor: JwtPayload, @Body() dto: PilotCleanupDto) {
    return this.pilot.cleanup(actor, dto);
  }
}
