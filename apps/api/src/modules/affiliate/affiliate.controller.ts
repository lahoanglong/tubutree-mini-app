import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
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
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { clientIp } from '../../common/throttle/throttle.config';
import { CursorPageQuery } from '../../common/cursor-page-query.dto';
import { vnDateParts } from '../../common/vn-time';
import { clampTake } from '../../common/pagination';
import { AffiliateService, PERSONAL_TAX_ID_FORMAT_MESSAGE, PERSONAL_TAX_ID_PATTERN } from './affiliate.service';
import { PlaceOrderForCustomerDto, QuoteOrderForCustomerDto } from './dto/place-order-for-customer.dto';
import { RegisterAffiliateDto } from './dto/register-affiliate.dto';

const WALLET_ONLY_MESSAGE = 'Hoa hồng chỉ chuyển vào Ví Tubu để mua hàng.';

class CreateLinkDto {
  @IsIn(['PRODUCT', 'CATEGORY', 'HOMEPAGE', 'DEAL']) targetType!: string;
  @IsOptional() @IsString() targetId?: string;
}

export class PayoutDto {
  @IsInt() @Min(1) amount!: number;
  @IsIn(['BANK', 'WALLET_BALANCE', 'ZALOPAY']) method!: string;
  // Client cũ vẫn gửi bankInfo kèm method BANK: nhận để trả đúng câu "chỉ chuyển vào Ví" thay vì lỗi định dạng tài khoản.
  @IsOptional() @IsObject() bankInfo?: Record<string, unknown>;
  /** MST cá nhân hoặc số CCCD, bắt buộc khi lần chuyển bị khấu trừ thuế TNCN mà hồ sơ chưa có (SELLER-11). */
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

/** Mã ngắn của link CTV: createLink sinh 5 byte base64url (7 ký tự); chừa dư cho mã dài hơn về sau. */
export class LinkClickDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{4,32}$/) shortCode!: string;
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

  // Khách mở link CTV (web hoặc miniapp, gọi một lần mỗi phiên). Công khai vì khách mới chưa có phiên. getTracker cố định theo IP:
  // mặc định của AppThrottlerGuard đếm theo userId khi có JWT, nên một tài khoản bất kỳ gửi kèm token sẽ né được trần theo IP.
  // Chỉ ảnh hưởng con số "click" CTV thấy, không đụng tới tiền.
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30, getTracker: (req) => `ip:${clientIp(req as unknown as Request)}` } })
  @Post('click')
  @HttpCode(HttpStatus.OK)
  click(@Body() dto: LinkClickDto, @Req() req: Request) {
    return this.affiliate.recordLinkClick(dto.shortCode, clientIp(req));
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

  // Chính sách Zalo 4.5 cấm rút tiền/trả thưởng: hoa hồng chỉ đi một đường, vào Ví Tubu 1:1. Chặn ở đây (không ở service)
  // để nhánh BANK còn lại trong service phục vụ xử lý lệnh cũ và các spec thuế/từ chối; không route nào khác gọi requestPayout.
  // Idempotency-Key: chống double-tap/retry chuyển trùng lần.
  @Post('payouts')
  payout(
    @CurrentUser('sub') userId: string,
    @Body() dto: PayoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (dto.method !== 'WALLET_BALANCE') throw new BadRequestException(WALLET_ONLY_MESSAGE);
    return this.affiliate.requestPayout(userId, dto.amount, dto.method, dto.bankInfo, idempotencyKey, dto.taxId);
  }

  /** Bảng kê thu nhập hoa hồng và thuế TNCN đã khấu trừ trong năm (mặc định năm nay, giờ VN). */
  @Get('tax-statement')
  taxStatement(@CurrentUser('sub') userId: string, @Query() q: TaxStatementQuery) {
    return this.affiliate.taxStatement(userId, q.year ?? vnDateParts().year);
  }

  // Báo giá form lên đơn hộ: đúng giá sẽ tính khi tạo đơn (giờ vàng như khách tự đặt, phí giao).
  @Post('orders/quote')
  quoteOrderForCustomer(@CurrentUser('sub') userId: string, @Body() dto: QuoteOrderForCustomerDto) {
    return this.affiliate.quoteOrderForCustomer(userId, dto);
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
