import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CashbackService } from './cashback.service';

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
  constructor(private readonly cashback: CashbackService) {}

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
  postback(@Body() dto: PostbackDto) {
    return this.cashback.handlePostback(dto);
  }
}
