import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { AffiliateService } from './affiliate.service';

const PAYOUT_STATUSES = ['REQUESTED', 'APPROVED', 'PAID', 'REJECTED'] as const;

/** Query danh sách Payout — khai báo `status` trong DTO (ValidationPipe forbidNonWhitelisted). */
export class ListPayoutsQuery extends PaginationQuery {
  @IsOptional() @IsIn(PAYOUT_STATUSES) status?: (typeof PAYOUT_STATUSES)[number];
}

export class ReviewPayoutDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RejectPayoutDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class MarkPayoutPaidDto {
  /** Mã giao dịch ngân hàng (vd FT26270…) — lưu vào Payout.bankRef để đối soát. */
  @IsOptional() @IsString() @MaxLength(100) bankRef?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * Admin xử lý hàng đợi Payout (rút hoa hồng CTV / Ví Tubu về ngân hàng): REQUESTED → APPROVED |
 * REJECTED; APPROVED → PAID. Trước đây (P0 A5-08 = A6-05) Payout REQUESTED không có
 * endpoint/màn admin nào xử lý — tiền bị trừ khỏi số dư CTV (hoặc commission bị khoá) rồi
 * "biến mất" khỏi mọi hàng đợi. Từ chối tự động hoàn tiền/commission (xem AffiliateService.rejectPayout).
 * Mọi chuyển trạng thái atomic trong AffiliateService (mirror dealer-admin.controller.ts).
 */
@Roles('ADMIN')
@Controller('admin/payouts')
export class PayoutAdminController {
  constructor(private readonly affiliate: AffiliateService) {}

  @Get()
  list(@Query() q: ListPayoutsQuery) {
    return this.affiliate.listPayouts(q.status, q.page, q.limit);
  }

  @Post(':id/approve')
  approve(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ReviewPayoutDto) {
    return this.affiliate.approvePayout(adminId, id, dto.note);
  }

  @Post(':id/reject')
  reject(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: RejectPayoutDto) {
    return this.affiliate.rejectPayout(adminId, id, dto.reason);
  }

  @Post(':id/mark-paid')
  markPaid(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: MarkPayoutPaidDto) {
    return this.affiliate.markPayoutPaid(adminId, id, dto);
  }
}
