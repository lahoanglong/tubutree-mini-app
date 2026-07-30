import { Body, Controller, Get, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsOptional, IsString } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CashbackService } from './cashback.service';
import type { CashbackProviderRegistry } from './providers/cashback-provider.registry';

class ClickDto {
  @IsString() merchantId!: string;
  @IsOptional() @IsString() productUrl?: string;
}

@Controller()
export class CashbackController {
  constructor(
    private readonly cashback: CashbackService,
    private readonly registry: CashbackProviderRegistry,
  ) {}

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

  /** Webhook postback generic theo provider. Verify + parse do provider tự lo. */
  @Public()
  @SkipThrottle()
  @Post('webhooks/cashback/:provider')
  async webhook(
    @Param('provider') providerKey: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const provider = this.registry.get(providerKey); // key lạ → NotFoundException
    if (!provider.verifyWebhook(headers, body)) {
      throw new UnauthorizedException('Webhook cashback không hợp lệ.');
    }
    const event = provider.parseWebhook(body);
    if (!event) return { ok: false };
    return this.cashback.ingest(event, provider.key);
  }

  /** Alias tương thích ngược (deprecated) — trỏ vào provider accesstrade. */
  @Public()
  @SkipThrottle()
  @Post('webhooks/accesstrade')
  accesstradeWebhook(
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    return this.webhook('accesstrade', body, headers);
  }
}
