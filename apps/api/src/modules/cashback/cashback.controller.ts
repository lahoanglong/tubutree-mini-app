import { Body, Controller, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CashbackService } from './cashback.service';
import type { Env } from '../../config/env.validation';

class ClickDto {
  @IsString() merchantId!: string;
  @IsOptional() @IsString() productUrl?: string;
}

class PostbackDto {
  @IsString() utm_content!: string;
  @IsString() order_id!: string;
  @IsInt() amount!: number;
  @IsInt() commission!: number;
  @IsString() status!: 'pending' | 'approved' | 'rejected';
}

@Controller()
export class CashbackController {
  private readonly webhookSecret: string;

  constructor(
    private readonly cashback: CashbackService,
    config: ConfigService<Env, true>,
  ) {
    this.webhookSecret = config.get('ACCESSTRADE_WEBHOOK_SECRET', { infer: true });
  }

  @Public()
  @Get('cashback/merchants')
  merchants() {
    return this.cashback.listMerchants();
  }

  @Post('cashback/click')
  click(@CurrentUser('sub') userId: string, @Body() dto: ClickDto) {
    return this.cashback.createClick(userId, dto.merchantId, dto.productUrl);
  }

  @Get('cashback/transactions')
  transactions(@CurrentUser('sub') userId: string) {
    return this.cashback.listTransactions(userId);
  }

  @Public()
  @Post('webhooks/accesstrade')
  postback(@Body() dto: PostbackDto, @Headers('x-accesstrade-token') token?: string) {
    // Verify shared-secret để chống tự forge postback (tự duyệt cashback giả).
    // Gate theo config: chưa cấu hình secret (dev) → bỏ qua, có cấu hình → bắt buộc khớp.
    if (this.webhookSecret && !this.tokenMatches(token)) {
      throw new UnauthorizedException('Token webhook Accesstrade không hợp lệ.');
    }
    return this.cashback.handlePostback(dto);
  }

  /** So token chống timing-attack (độ dài khác → false ngay, không ném). */
  private tokenMatches(token?: string): boolean {
    if (!token) return false;
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(this.webhookSecret, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
