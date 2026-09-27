import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { DealerService } from './dealer.service';

const CLAIM_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const;

/** Query danh sách yêu cầu nhận thưởng — khai báo `status` trong DTO (ValidationPipe forbidNonWhitelisted). */
export class ListRewardClaimsQuery extends PaginationQuery {
  @IsOptional() @IsIn(CLAIM_STATUSES) status?: (typeof CLAIM_STATUSES)[number];
}

export class ReviewRewardClaimDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RejectRewardClaimDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

/**
 * Admin xử lý yêu cầu nhận thưởng mốc đại lý (tour/quà): PENDING → APPROVED | REJECTED;
 * APPROVED → PAID (đã trao thưởng offline). Mọi chuyển trạng thái đều atomic trong DealerService.
 */
@Roles('ADMIN')
@Controller('admin/dealer-reward-claims')
export class DealerAdminController {
  constructor(private readonly dealer: DealerService) {}

  @Get()
  list(@Query() q: ListRewardClaimsQuery) {
    return this.dealer.listRewardClaims(q.status, q.page, q.limit);
  }

  @Post(':id/approve')
  approve(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ReviewRewardClaimDto) {
    return this.dealer.approveRewardClaim(adminId, id, dto.note);
  }

  @Post(':id/reject')
  reject(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: RejectRewardClaimDto) {
    return this.dealer.rejectRewardClaim(adminId, id, dto.reason);
  }

  @Post(':id/mark-paid')
  markPaid(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ReviewRewardClaimDto) {
    return this.dealer.markRewardClaimPaid(adminId, id, dto.note);
  }
}

export class ConfirmDealerPaymentDto {
  /** Mã giao dịch ngân hàng (vd FT26270…) — lưu vào ghi chú lịch sử đơn để đối soát. */
  @IsOptional() @IsString() @MaxLength(100) bankRef?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * Admin thao tác trên đơn đại lý. POST /api/admin/dealer-orders/:id/confirm-payment — xác nhận đã
 * nhận chuyển khoản cho đơn TRẢ TRƯỚC (UNPAID → PAID; `:id` nhận id hoặc mã đơn). Có ghi vết
 * order_status_history (actor ADMIN) — xem DealerService.confirmDealerOrderPayment.
 */
@Roles('ADMIN')
@Controller('admin/dealer-orders')
export class DealerOrderAdminController {
  constructor(private readonly dealer: DealerService) {}

  @Post(':id/confirm-payment')
  confirmPayment(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ConfirmDealerPaymentDto) {
    return this.dealer.confirmDealerOrderPayment(adminId, id, dto);
  }
}

export class RecordDealerCreditPaymentDto {
  @IsInt() @Min(1) amount!: number;
  /** Mã giao dịch ngân hàng (vd FT26270…) — lưu vào ghi chú sổ công nợ để đối soát. */
  @IsOptional() @IsString() @MaxLength(100) bankRef?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * A5-09 (docs/audit-2026-09/05-ctv-dealer-staff.md): admin xác nhận đã nhận chuyển khoản trả nợ
 * của MỘT đại lý (`:userId`) — nguồn DUY NHẤT được phép giảm DealerCreditLedger ngoài các luồng hệ
 * thống, thay cho việc đại lý tự bấm "Báo đã CK" trừ nợ ngay (nay chỉ còn báo, xem
 * DealerController.payment → DealerService.reportCreditPayment). Trần theo dư nợ TẠI LÚC DUYỆT,
 * atomic (Serializable) — xem DealerService.adminRecordCreditPayment.
 */
@Roles('ADMIN')
@Controller('admin/dealers')
export class DealerCreditAdminController {
  constructor(private readonly dealer: DealerService) {}

  @Get(':userId/credit-ledger')
  ledger(@Param('userId') userId: string) {
    return this.dealer.creditLedger(userId);
  }

  @Post(':userId/credit-payment')
  recordPayment(
    @CurrentUser('sub') adminId: string,
    @Param('userId') userId: string,
    @Body() dto: RecordDealerCreditPaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.dealer.adminRecordCreditPayment(adminId, userId, dto.amount, {
      note: dto.note,
      bankRef: dto.bankRef,
      idempotencyKey,
    });
  }
}
