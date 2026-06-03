import { Body, Controller, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ZalopayService } from './zalopay.service';

class CreatePaymentDto {
  @IsString() orderCode!: string;
}

class ZaloPayCallbackDto {
  @IsString() data!: string;
  @IsString() mac!: string;
}

@Controller()
export class PaymentController {
  constructor(private readonly zalopay: ZalopayService) {}

  @Post('payments/zalopay/create')
  create(@CurrentUser('sub') userId: string, @Body() dto: CreatePaymentDto) {
    return this.zalopay.createPayment(userId, dto.orderCode);
  }

  /** Webhook ZaloPay (server-to-server). */
  @Public()
  @Post('webhooks/zalopay')
  webhook(@Body() body: ZaloPayCallbackDto) {
    return this.zalopay.handleCallback(body.data, body.mac);
  }
}
