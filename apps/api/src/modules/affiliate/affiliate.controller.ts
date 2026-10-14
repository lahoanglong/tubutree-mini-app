import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPageQuery } from '../../common/cursor-page-query.dto';
import { vnDateParts } from '../../common/vn-time';
import { clampTake } from '../../common/pagination';
import { AffiliateService, PERSONAL_TAX_ID_FORMAT_MESSAGE, PERSONAL_TAX_ID_PATTERN } from './affiliate.service';
import { PlaceOrderForCustomerDto } from './dto/place-order-for-customer.dto';
import { RegisterAffiliateDto } from './dto/register-affiliate.dto';

class CreateLinkDto {
  @IsIn(['PRODUCT', 'CATEGORY', 'HOMEPAGE', 'DEAL']) targetType!: string;
  @IsOptional() @IsString() targetId?: string;
}

class PayoutBankInfoDto {
  @IsString() @MinLength(2) @MaxLength(100) bankName!: string;
  @IsString() @Matches(/^\d{6,20}$/, { message: 'Số tài khoản phải gồm 6–20 chữ số.' }) accountNumber!: string;
  @IsString() @MinLength(2) @MaxLength(100) accountName!: string;
}

export class PayoutDto {
  @IsInt() @Min(1) amount!: number;
  @IsIn(['BANK', 'WALLET_BALANCE', 'ZALOPAY']) method!: string;
  // SELLER-10: rút ngân hàng bắt buộc đủ thông tin tài khoản; trước đây `{}` cũng qua và admin không biết chuyển vào đâu.
  @ValidateIf((o: PayoutDto) => o.method === 'BANK')
  @IsObject()
  @ValidateNested()
  @Type(() => PayoutBankInfoDto)
  bankInfo?: PayoutBankInfoDto;
  /** MST cá nhân hoặc số CCCD, bắt buộc khi lần rút bị khấu trừ thuế TNCN mà hồ sơ chưa có (SELLER-11). */
  @IsOptional() @IsString() @Matches(PERSONAL_TAX_ID_PATTERN, { message: PERSONAL_TAX_ID_FORMAT_MESSAGE }) taxId?: string;
}

export class TaxStatementQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year?: number;
}

class ClaimMilestoneDto {
  // Tháng VN 'YYYY-MM' — bỏ trống = tháng này; service chỉ nhận tháng này hoặc tháng trước.
  @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month?: string;
}

class TouchDto {
  @IsString() @MaxLength(64) referralCode!: string;
  @IsOptional() @IsString() @MaxLength(64) storefrontSlug?: string;
  @IsOptional() @IsIn(['ctv', 'brand']) kind?: string;
}

@Controller('affiliate')
export class AffiliateController {
  constructor(private readonly affiliate: AffiliateService) {}

  @Post('register')
  register(@CurrentUser('sub') userId: string, @Body() dto?: RegisterAffiliateDto) {
    return this.affiliate.register(userId, dto?.termsVersion);
  }

  // Ghi "chạm" giới thiệu để attribution sống affiliate.attribution_days ngày (fallback khi phiên mất).
  @Post('touch')
  touch(@CurrentUser('sub') userId: string, @Body() dto: TouchDto) {
    return this.affiliate.recordTouch(userId, dto);
  }

  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.affiliate.getMe(userId);
  }

  @Post('links')
  createLink(@CurrentUser('sub') userId: string, @Body() dto: CreateLinkDto) {
    return this.affiliate.createLink(userId, dto.targetType, dto.targetId);
  }

  @Get('links')
  links(@CurrentUser('sub') userId: string, @Query() query: CursorPageQuery) {
    return this.affiliate.listLinks(userId, { take: clampTake(query.take, 100, 200), cursor: query.cursor });
  }

  @Get('dashboard')
  dashboard(@CurrentUser('sub') userId: string) {
    return this.affiliate.dashboard(userId);
  }

  @Get('commissions')
  commissions(@CurrentUser('sub') userId: string) {
    return this.affiliate.listCommissions(userId);
  }

  @Get('payouts')
  myPayouts(@CurrentUser('sub') userId: string) {
    return this.affiliate.listMyPayouts(userId);
  }

  // Idempotency-Key: mirror wallet.withdraw / affiliate.orders — chống double-tap/retry rút tiền
  // trùng lần (header optional ở tầng type, nhưng client thực tế BẮT BUỘC gửi khi rút tiền thật).
  @Post('payouts')
  payout(
    @CurrentUser('sub') userId: string,
    @Body() dto: PayoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.affiliate.requestPayout(userId, dto.amount, dto.method, dto.bankInfo, idempotencyKey, dto.taxId);
  }

  /** Bảng kê thu nhập hoa hồng và thuế TNCN đã khấu trừ trong năm (mặc định năm nay, giờ VN). */
  @Get('tax-statement')
  taxStatement(@CurrentUser('sub') userId: string, @Query() q: TaxStatementQuery) {
    return this.affiliate.taxStatement(userId, q.year ?? vnDateParts().year);
  }

  // CTV lên đơn hộ khách (COD/chuyển khoản) → CTV hưởng hoa hồng (placedForCustomer).
  @Post('orders')
  placeOrderForCustomer(
    @CurrentUser('sub') userId: string,
    @Body() dto: PlaceOrderForCustomerDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.affiliate.placeOrderForCustomer(userId, dto, idempotencyKey);
  }

  @Get('analytics/storefronts')
  storefrontAnalytics(@CurrentUser('sub') userId: string) {
    return this.affiliate.storefrontAnalytics(userId);
  }

  @Get('analytics/products')
  productBreakdown(@CurrentUser('sub') userId: string) {
    return this.affiliate.productCommissionBreakdown(userId);
  }

  @Get('tiers')
  tiers(@CurrentUser('sub') userId: string) {
    return this.affiliate.getCtvTiers(userId);
  }

  @Get('milestones')
  milestones(@CurrentUser('sub') userId: string) {
    return this.affiliate.getMilestones(userId);
  }

  @Post('milestones/:id/claim')
  claimMilestone(
    @CurrentUser('sub') userId: string,
    @Param('id') milestoneId: string,
    @Body() dto: ClaimMilestoneDto,
  ) {
    return this.affiliate.claimMilestone(userId, milestoneId, dto?.month);
  }
}
