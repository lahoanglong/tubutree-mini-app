import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationQuery } from '../../common/pagination';
import { MerchantFulfilmentService } from './merchant-fulfilment.service';

export class CreateMerchantPayoutDto {
  @IsString() @IsNotEmpty() storefrontId!: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  /** Tổng bảng kê admin vừa xem (âm khi đối tác nộp lại); lệch với tổng lúc lập thì từ chối. */
  @IsOptional() @IsInt() expectedTotal?: number;
}

class MarkMerchantPayoutPaidDto {
  @IsString() @IsNotEmpty() @MaxLength(100) bankRef!: string;
}

/** Cùng trần với khoá merchant.commission_pct (system-config): phí theo % là phân số 0–0,5. */
export class MerchantStoreTermsDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(0.5) commissionPct?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(0.5) consignmentFeePct?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) consignmentFeeFixed?: number;
}

class MerchantPayoutListQuery extends PaginationQuery {
  @IsOptional() @IsString() storefrontId?: string;
}

/** Admin: giám sát đơn đối tác tự giao và đối soát (docs/2026-10-14-merchant-fulfilment-design.md mục 7, 8). */
@Controller('admin/merchant-fulfilment')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class MerchantAdminController {
  constructor(private readonly fulfilment: MerchantFulfilmentService) {}

  @Get('overview')
  overview() {
    return this.fulfilment.adminOverview();
  }

  @Get('statements/:storefrontId')
  statement(@Param('storefrontId') storefrontId: string) {
    return this.fulfilment.statementFor(storefrontId);
  }

  @Patch('stores/:storefrontId/terms')
  updateTerms(@CurrentUser('sub') adminId: string, @Param('storefrontId') storefrontId: string, @Body() dto: MerchantStoreTermsDto) {
    return this.fulfilment.updateStoreTerms(adminId, storefrontId, dto);
  }

  @Post('links/:id/confirm-consignment')
  confirmConsignment(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.fulfilment.confirmConsignment(adminId, id);
  }

  @Get('payouts')
  payouts(@Query() q: MerchantPayoutListQuery) {
    return this.fulfilment.listPayouts(q.storefrontId, q.page, q.limit);
  }

  @Post('payouts')
  createPayout(@CurrentUser('sub') adminId: string, @Body() dto: CreateMerchantPayoutDto) {
    return this.fulfilment.createPayout(adminId, dto.storefrontId, dto.note, dto.expectedTotal);
  }

  @Post('payouts/:id/paid')
  markPaid(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: MarkMerchantPayoutPaidDto) {
    return this.fulfilment.markPayoutPaid(adminId, id, dto.bankRef);
  }

  @Post('payouts/:id/cancel')
  cancelPayout(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.fulfilment.cancelPayout(adminId, id);
  }
}
