import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AffiliateService } from './affiliate.service';
import type { PlaceOrderForCustomerDto } from './dto/place-order-for-customer.dto';

class CreateLinkDto {
  @IsIn(['PRODUCT', 'CATEGORY', 'HOMEPAGE', 'DEAL']) targetType!: string;
  @IsOptional() @IsString() targetId?: string;
}

class PayoutDto {
  @IsInt() @Min(1) amount!: number;
  @IsIn(['BANK', 'WALLET_BALANCE', 'ZALOPAY']) method!: string;
  @IsOptional() @IsObject() bankInfo?: object;
}

class TouchDto {
  @IsString() referralCode!: string;
  @IsOptional() @IsString() storefrontSlug?: string;
  @IsOptional() @IsIn(['ctv', 'brand']) kind?: string;
}

@Controller('affiliate')
export class AffiliateController {
  constructor(private readonly affiliate: AffiliateService) {}

  @Post('register')
  register(@CurrentUser('sub') userId: string) {
    return this.affiliate.register(userId);
  }

  // Ghi "chạm" giới thiệu để attribution sống 3 ngày (fallback khi phiên mất).
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
  links(@CurrentUser('sub') userId: string) {
    return this.affiliate.listLinks(userId);
  }

  @Get('dashboard')
  dashboard(@CurrentUser('sub') userId: string) {
    return this.affiliate.dashboard(userId);
  }

  @Get('commissions')
  commissions(@CurrentUser('sub') userId: string) {
    return this.affiliate.listCommissions(userId);
  }

  @Post('payouts')
  payout(@CurrentUser('sub') userId: string, @Body() dto: PayoutDto) {
    return this.affiliate.requestPayout(userId, dto.amount, dto.method, dto.bankInfo);
  }

  // CTV lên đơn hộ khách (COD/chuyển khoản) → CTV hưởng hoa hồng (placedForCustomer).
  @Post('orders')
  placeOrderForCustomer(@CurrentUser('sub') userId: string, @Body() dto: PlaceOrderForCustomerDto) {
    return this.affiliate.placeOrderForCustomer(userId, dto);
  }

  @Get('analytics/storefronts')
  storefrontAnalytics(@CurrentUser('sub') userId: string) {
    return this.affiliate.storefrontAnalytics(userId);
  }

  @Get('analytics/products')
  productBreakdown(@CurrentUser('sub') userId: string) {
    return this.affiliate.productCommissionBreakdown(userId);
  }
}
