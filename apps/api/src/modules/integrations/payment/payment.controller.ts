import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ZalopayService } from './zalopay.service';
import { BankTransferService } from './bank-transfer.service';

class CreatePaymentDto {
  @IsString() orderCode!: string;
}

@Controller()
export class PaymentController {
  constructor(
    private readonly zalopay: ZalopayService,
    private readonly bankTransfer: BankTransferService,
  ) {}

  @Post('payments/zalopay/create')
  create(@CurrentUser('sub') userId: string, @Body() dto: CreatePaymentDto) {
    return this.zalopay.createPayment(userId, dto.orderCode);
  }

  /** VietQR chuyển khoản cho đơn BANK_TRANSFER (Pancake đối soát → webhook lật PAID). */
  @Get('payments/bank-qr/:code')
  bankQr(@CurrentUser('sub') userId: string, @Param('code') code: string) {
    return this.bankTransfer.getBankQr(code, userId);
  }

  /**
   * Webhook ZaloPay (server-to-server). MAC (key2) đã chặn giả mạo → bỏ qua rate limit. Body là object thường (không DTO):
   * ValidationPipe toàn cục chặn trường lạ, mà ZaloPay gửi kèm `type` và có thể thêm trường khác — bị 400 là mất callback.
   */
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('webhooks/zalopay')
  webhook(@Body() body: Record<string, unknown>) {
    const { data, mac, type } = body ?? {};
    if (typeof data !== 'string' || typeof mac !== 'string') {
      throw new BadRequestException('Callback ZaloPay thiếu data hoặc mac.');
    }
    return this.zalopay.handleCallback(data, mac, type === undefined || type === null ? undefined : Number(type));
  }
}
