import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DealerService } from './dealer.service';
import { ApplyDealerDto, DealerOrderDto } from './dto/dealer.dto';

class CreditPaymentDto {
  @IsInt() @Min(1) amount!: number;
  @IsOptional() @IsString() note?: string;
}

@Controller('dealer')
export class DealerController {
  constructor(private readonly dealer: DealerService) {}

  @Post('apply')
  apply(@CurrentUser('sub') userId: string, @Body() dto: ApplyDealerDto) {
    return this.dealer.apply(userId, dto);
  }

  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.dealer.getMe(userId);
  }

  @Get('pricelist')
  pricelist(@CurrentUser('sub') userId: string) {
    return this.dealer.pricelist(userId);
  }

  @Post('orders')
  placeOrder(@CurrentUser('sub') userId: string, @Body() dto: DealerOrderDto) {
    return this.dealer.placeOrder(userId, dto);
  }

  @Get('orders')
  orders(@CurrentUser('sub') userId: string) {
    return this.dealer.listOrders(userId);
  }

  @Get('credit-ledger')
  ledger(@CurrentUser('sub') userId: string) {
    return this.dealer.creditLedger(userId);
  }

  @Post('credit-payment')
  payment(@CurrentUser('sub') userId: string, @Body() dto: CreditPaymentDto) {
    return this.dealer.creditPayment(userId, dto.amount, dto.note);
  }
}
