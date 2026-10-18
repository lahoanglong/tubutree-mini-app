import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Trim } from '../../common/decorators/trim.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AllowStaff } from '../../common/staff-permissions';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationQuery } from '../../common/pagination';
import { MerchantFulfilmentService } from './merchant-fulfilment.service';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';

export class CreateMerchantPayoutDto {
  @IsString() @IsNotEmpty() storefrontId!: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  /** Tổng bảng kê admin vừa xem (âm khi đối tác nộp lại); lệch với tổng lúc lập thì từ chối. */
  @IsOptional() @IsInt() expectedTotal?: number;
}

class MarkMerchantPayoutPaidDto {
  @IsString() @IsNotEmpty() @MaxLength(100) bankRef!: string;
}

/** Lý do huỷ phiếu gửi nguyên văn cho gian hàng. */
export class CancelMerchantPayoutDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Cần nhập lý do huỷ phiếu để báo gian hàng.' })
  @MaxLength(300)
  reason!: string;
}

/** Cùng trần với khoá merchant.commission_pct (system-config): phí theo % là phân số 0–0,5. */
export class MerchantStoreTermsDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(0.5) commissionPct?: number | null;
  @OptionalNotNull() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(0.5) consignmentFeePct?: number;
  @OptionalNotNull() @IsInt() @Min(0) @Max(1_000_000) consignmentFeeFixed?: number;
}

class MerchantPayoutListQuery extends PaginationQuery {
  @IsOptional() @IsString() storefrontId?: string;
  /** PENDING = phiếu chờ chuyển cho đối tác hoặc chờ đối tác nộp lại. */
  @IsOptional() @IsIn(['PENDING', 'PAID', 'CANCELLED']) status?: 'PENDING' | 'PAID' | 'CANCELLED';
}

/** Admin: giám sát đơn đối tác tự giao và đối soát (docs/2026-10-14-merchant-fulfilment-design.md mục 7, 8). */
@Controller('admin/merchant-fulfilment')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class MerchantAdminController {
  constructor(private readonly fulfilment: MerchantFulfilmentService) {}

  @AllowStaff('KE_TOAN')
  @Get('overview')
  overview() {
    return this.fulfilment.adminOverview();
  }

  @AllowStaff('KE_TOAN')
  @Get('statements/:storefrontId')
  statement(@Param('storefrontId') storefrontId: string) {
    return this.fulfilment.adminStatement(storefrontId);
  }

  @Patch('stores/:storefrontId/terms')
  updateTerms(@CurrentUser('sub') adminId: string, @Param('storefrontId') storefrontId: string, @Body() dto: MerchantStoreTermsDto) {
    return this.fulfilment.updateStoreTerms(adminId, storefrontId, dto);
  }

  @Post('links/:id/confirm-consignment')
  confirmConsignment(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.fulfilment.confirmConsignment(adminId, id);
  }

  @AllowStaff('KE_TOAN')
  @Get('payouts')
  payouts(@Query() q: MerchantPayoutListQuery) {
    return this.fulfilment.listPayouts(q.storefrontId, q.page, q.limit, q.status);
  }

  @AllowStaff('KE_TOAN')
  @Post('payouts')
  createPayout(@CurrentUser('sub') adminId: string, @Body() dto: CreateMerchantPayoutDto) {
    return this.fulfilment.createPayout(adminId, dto.storefrontId, dto.note, dto.expectedTotal);
  }

  @AllowStaff('KE_TOAN')
  @Post('payouts/:id/paid')
  markPaid(
    @CurrentUser('sub') adminId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body() dto: MarkMerchantPayoutPaidDto,
  ) {
    return this.fulfilment.markPayoutPaid(adminId, id, dto.bankRef, { byStaff: role === 'STAFF' });
  }

  @AllowStaff('KE_TOAN')
  @Post('payouts/:id/cancel')
  cancelPayout(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: CancelMerchantPayoutDto) {
    return this.fulfilment.cancelPayout(adminId, id, dto.reason);
  }
}

export class SetStorePartnerDto {
  @IsBoolean() isPartner!: boolean;
}

/** Admin: cờ đối tác của gian hàng CTV (đại lý giữ gian hàng CTV) — bật lại hoặc gỡ cờ còn sót sau khi chủ thôi làm đại lý. */
@Controller('admin/storefronts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class StorefrontPartnerAdminController {
  constructor(private readonly fulfilment: MerchantFulfilmentService) {}

  @Post(':id/partner')
  setPartner(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: SetStorePartnerDto) {
    return this.fulfilment.setStorePartner(adminId, id, dto.isPartner);
  }
}
