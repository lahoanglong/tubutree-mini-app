import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Trim } from '../../common/decorators/trim.decorator';
import { PaginationQuery } from '../../common/pagination';
import { AllowStaff } from '../../common/staff-permissions';
import { ExternalClaimsAdminService } from './external-claims-admin.service';

const STATES = ['PENDING', 'REVIEW', 'HELD_NO_MEMBER', 'CREDITED', 'VOIDED', 'REVERSED', 'LAPSED'] as const;

export class ExternalClaimListQueryDto extends PaginationQuery {
  @IsOptional() @IsIn(STATES) state?: (typeof STATES)[number];
  /** Chỉ các dòng "Cần xử lý": đã cộng mà đơn đã đóng, hoặc PENDING không bao giờ tới hạn. */
  @IsOptional() @IsIn(['closed_credited', 'stale']) attention?: 'closed_credited' | 'stale';
  /** Mã đơn Pancake, mã vận đơn, id claim hoặc SĐT đầy đủ. */
  @IsOptional() @Trim() @IsString() @MaxLength(100) q?: string;
}

export class ClaimReasonDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

export class ClaimNoteDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(300) note!: string;
}

export class AttachAttemptDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(100) pancakeOrderId!: string;
  /** Bắt buộc khi mã không trùng mã trên đơn hoặc đơn nguồn UNKNOWN (chỉ ADMIN). */
  @IsOptional() @Trim() @IsString() @MaxLength(300) note?: string;
}

export class RejectAttemptDto {
  @IsOptional() @Trim() @IsString() @MaxLength(300) note?: string;
}

/**
 * Xử lý điểm đơn ngoài app. CSKH duyệt và huỷ claim chưa cộng, xử lý lần gửi mã chưa thấy đơn; KE_TOAN chỉ đọc; chỉ ADMIN đảo điểm
 * đã cộng (`@AllowStaff()` rỗng ở handler ghi đè nhóm CSKH của lớp, nên nhân viên không vào được).
 */
@Roles('ADMIN')
@AllowStaff('CSKH')
@Controller('admin/external-claims')
export class ExternalClaimsAdminController {
  constructor(private readonly admin: ExternalClaimsAdminService) {}

  @Get()
  @AllowStaff('CSKH', 'KE_TOAN')
  list(@Query() q: ExternalClaimListQueryDto) {
    return this.admin.list(q);
  }

  /** Phải đứng trước `:id` để "attempts" không bị hiểu là id. */
  @Get('attempts')
  @AllowStaff('CSKH', 'KE_TOAN')
  attempts(@Query() q: PaginationQuery) {
    return this.admin.listAttempts(q.page, q.limit);
  }

  @Post('attempts/:id/attach')
  attach(@Param('id') id: string, @Body() dto: AttachAttemptDto, @CurrentUser() user: JwtPayload) {
    return this.admin.attach(id, dto.pancakeOrderId, { id: user.sub, role: user.role }, dto.note);
  }

  @Post('attempts/:id/reject')
  rejectAttempt(@Param('id') id: string, @Body() dto: RejectAttemptDto, @CurrentUser() user: JwtPayload) {
    return this.admin.rejectAttempt(id, user.sub, dto.note);
  }

  @Get(':id')
  @AllowStaff('CSKH', 'KE_TOAN')
  detail(@Param('id') id: string) {
    return this.admin.detail(id);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.admin.approve(id, user.sub);
  }

  @Post(':id/void')
  void(@Param('id') id: string, @Body() dto: ClaimReasonDto, @CurrentUser() user: JwtPayload) {
    return this.admin.voidClaim(id, user.sub, dto.reason, false);
  }

  @Post(':id/void-and-reopen')
  voidAndReopen(@Param('id') id: string, @Body() dto: ClaimReasonDto, @CurrentUser() user: JwtPayload) {
    return this.admin.voidClaim(id, user.sub, dto.reason, true);
  }

  @Post(':id/keep-points')
  @AllowStaff()
  keepPoints(@Param('id') id: string, @Body() dto: ClaimNoteDto, @CurrentUser() user: JwtPayload) {
    return this.admin.keepPoints(id, user.sub, dto.note);
  }

  @Post(':id/reverse')
  @AllowStaff()
  reverse(@Param('id') id: string, @Body() dto: ClaimReasonDto, @CurrentUser() user: JwtPayload) {
    return this.admin.reverse(id, user.sub, dto.reason);
  }
}
