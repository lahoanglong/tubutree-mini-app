import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ZalopayService } from './zalopay.service';
import { BankTransferService } from './bank-transfer.service';

class CreatePaymentDto {
  @IsString() orderCode!: string;
}

class ZaloPayCallbackDto {
  @IsString() data!: string;
  @IsString() mac!: string;
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

  /** Webhook ZaloPay (server-to-server). */
  @Public()
  @Post('webhooks/zalopay')
  webhook(@Body() body: ZaloPayCallbackDto) {
    return this.zalopay.handleCallback(body.data, body.mac);
  }
}
