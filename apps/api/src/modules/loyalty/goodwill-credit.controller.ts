import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { GOODWILL_MAX_PER_GRANT, GOODWILL_REASON_MAX, GOODWILL_REASON_MIN, type GoodwillKind } from '@tubutree/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Trim } from '../../common/decorators/trim.decorator';
import { requireIdempotencyKey } from '../../common/idempotency-key';
import { GoodwillCreditService } from './goodwill-credit.service';

export class GoodwillCreditDto {
  @IsIn(['POINTS', 'WALLET'], { message: 'Chọn tặng Điểm Xanh hoặc tiền vào Ví Tubu.' })
  kind!: GoodwillKind;

  @IsInt({ message: 'Số tặng phải là số nguyên.' })
  @Min(1, { message: 'Số tặng phải lớn hơn 0.' })
  @Max(GOODWILL_MAX_PER_GRANT, { message: 'Mỗi lần tặng tối đa 200.000.' })
  amount!: number;

  /** Lý do nội bộ (ai thấy: quản trị viên ở hồ sơ khách và admin_audit_logs). Khách không thấy. */
  @Trim()
  @IsString()
  @MinLength(GOODWILL_REASON_MIN, { message: `Lý do cần ít nhất ${GOODWILL_REASON_MIN} ký tự.` })
  @MaxLength(GOODWILL_REASON_MAX, { message: `Lý do tối đa ${GOODWILL_REASON_MAX} ký tự.` })
  reason!: string;

  /** Mã đơn liên quan (tuỳ chọn); phải là đơn của chính khách này. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40, { message: 'Mã đơn không hợp lệ.' })
  @Matches(/^[A-Za-z0-9_-]*$/, { message: 'Mã đơn không hợp lệ.' })
  orderCode?: string;
}

/**
 * Tặng thiện chí Điểm Xanh / Ví Tubu từ hồ sơ khách. Chỉ ADMIN: không có @AllowStaff nên nhân viên (kể cả CSKH) nhận 403 từ RolesGuard.
 */
@ApiTags('admin-users')
@Roles('ADMIN')
@Controller('admin/users')
export class GoodwillCreditController {
  constructor(private readonly goodwill: GoodwillCreditService) {}

  @Get(':id/goodwill-credits')
  list(@CurrentUser('sub') viewerId: string, @Param('id') id: string) {
    return this.goodwill.list(viewerId, id);
  }

  /** Header `Idempotency-Key` bắt buộc (8–128 ký tự): gửi lại cùng khoá trả đúng kết quả cũ, không ghi sổ lần hai. */
  @Post(':id/goodwill-credits')
  @HttpCode(HttpStatus.OK)
  grant(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: GoodwillCreditDto, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.goodwill.grant(adminId, id, dto, requireIdempotencyKey(idempotencyKey));
  }
}
