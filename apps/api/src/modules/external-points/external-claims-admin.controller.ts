import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Trim } from '../../common/decorators/trim.decorator';
import { PaginationQuery } from '../../common/pagination';
import { AllowStaff } from '../../common/staff-permissions';
import { ExternalClaimsAdminService } from './external-claims-admin.service';
import { FUNNEL_PERIODS } from './external-claims-funnel';
import { ExternalClaimsNoPhoneBatchService, NO_PHONE_BATCH_MAX } from './external-claims-no-phone-batch.service';
import { ExternalClaimsStaleBatchService, STALE_BATCH_MAX } from './external-claims-stale-batch.service';

const STATES = ['PENDING', 'REVIEW', 'HELD_NO_MEMBER', 'CREDITED', 'VOIDED', 'REVERSED', 'LAPSED'] as const;

export class ExternalClaimListQueryDto extends PaginationQuery {
  @IsOptional() @IsIn(STATES) state?: (typeof STATES)[number];
  /** SCAN = đơn sàn khách nhập mã; PHONE = đơn chat/điện thoại tự cộng theo SĐT. */
  @IsOptional() @IsIn(['SCAN', 'PHONE']) kind?: 'SCAN' | 'PHONE';
  /** Chỉ các dòng "Cần xử lý": đã cộng mà đơn đã đóng hoặc hoàn một phần, hoặc PENDING không bao giờ tới hạn. */
  @IsOptional() @IsIn(['closed_credited', 'stale', 'partial_refund']) attention?: 'closed_credited' | 'stale' | 'partial_refund';
  /** Mã đơn Pancake, mã vận đơn, id claim hoặc SĐT đầy đủ. */
  @IsOptional() @Trim() @IsString() @MaxLength(100) q?: string;
}

export class ExternalClaimFunnelQueryDto {
  /** Bỏ trống = 30 ngày. */
  @IsOptional() @IsIn([...FUNNEL_PERIODS]) period?: (typeof FUNNEL_PERIODS)[number];
}

export class ClaimReasonDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

export class ApproveClaimDto {
  /** Bắt buộc khi claim chờ vì "SĐT xác minh đã cũ" và mốc đó vẫn cũ lúc duyệt. */
  @IsOptional() @Trim() @IsString() @MaxLength(300) note?: string;
}

export class ClaimNoteDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(300) note!: string;
}

export class AttachAttemptDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(100) pancakeOrderId!: string;
  /** Bắt buộc khi mã không trùng mã trên đơn hoặc đơn nguồn UNKNOWN (chỉ ADMIN). */
  @IsOptional() @Trim() @IsString() @MaxLength(300) note?: string;
}

export class StaleBatchDto {
  /** Mặc định true: chỉ xem trước, không duyệt gì. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
  /** Lượt thật: đúng danh sách claim vừa xem trước. */
  @IsOptional() @IsArray() @ArrayMaxSize(STALE_BATCH_MAX) @IsString({ each: true }) @MaxLength(40, { each: true }) claimIds?: string[];
}

export class NoPhoneBatchDto {
  /** Mặc định true: chỉ xem trước, không duyệt gì. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
  /** Lượt thật: đúng danh sách claim vừa xem trước. */
  @IsOptional() @IsArray() @ArrayMaxSize(NO_PHONE_BATCH_MAX) @IsString({ each: true }) @MaxLength(40, { each: true }) claimIds?: string[];
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
  constructor(
    private readonly admin: ExternalClaimsAdminService,
    private readonly staleBatch: ExternalClaimsStaleBatchService,
    private readonly noPhoneBatch: ExternalClaimsNoPhoneBatchService,
  ) {}

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

  /** Phễu đơn sàn → điểm → mua lại, chỉ số đếm. Phải đứng trước `:id` để "funnel" không bị hiểu là id. */
  @Get('funnel')
  @AllowStaff('CSKH', 'KE_TOAN')
  funnel(@Query() q: ExternalClaimFunnelQueryDto) {
    return this.admin.funnel(q.period ?? '30d');
  }

  @Post('attempts/:id/attach')
  attach(@Param('id') id: string, @Body() dto: AttachAttemptDto, @CurrentUser() user: JwtPayload) {
    return this.admin.attach(id, dto.pancakeOrderId, { id: user.sub, role: user.role }, dto.note);
  }

  @Post('attempts/:id/reject')
  rejectAttempt(@Param('id') id: string, @Body() dto: RejectAttemptDto, @CurrentUser() user: JwtPayload) {
    return this.admin.rejectAttempt(id, user.sub, dto.note);
  }

  /** Duyệt nhanh claim đơn chat chỉ vướng "SĐT xác minh đã cũ" của thành viên đã nhận đơn app (CSKH bấm, không tự chạy). */
  @Post('stale-phone-batch')
  @HttpCode(200)
  staleBatchApprove(@Body() dto: StaleBatchDto, @CurrentUser() user: JwtPayload) {
    return this.staleBatch.run(user.sub, dto);
  }

  /** Duyệt nhanh claim đơn Lazada chỉ vướng "đơn không có SĐT để đối chiếu" của thành viên đã xác minh và là khách quen (CSKH bấm, không tự chạy). */
  @Post('no-phone-batch')
  @HttpCode(200)
  noPhoneBatchApprove(@Body() dto: NoPhoneBatchDto, @CurrentUser() user: JwtPayload) {
    return this.noPhoneBatch.run(user.sub, dto);
  }

  @Get(':id')
  @AllowStaff('CSKH', 'KE_TOAN')
  detail(@Param('id') id: string) {
    return this.admin.detail(id);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveClaimDto, @CurrentUser() user: JwtPayload) {
    return this.admin.approve(id, user.sub, new Date(), dto.note);
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
