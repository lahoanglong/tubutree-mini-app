import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsInt, IsObject, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WalletService } from './wallet.service';
import { CoinsService } from './coins.service';

class WithdrawDto {
  @IsInt() @Min(1) amount!: number;
  @IsObject() bankInfo!: object;
}

class ConvertXuDto {
  @IsInt() @Min(1) amount!: number; // số tiền VND từ Ví muốn đổi sang TubuXu
}

@Controller()
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly coins: CoinsService,
  ) {}

  @Get('me/wallet')
  get(@CurrentUser('sub') userId: string) {
    return this.wallet.getWallet(userId);
  }

  @Post('wallet/withdraw')
  withdraw(@CurrentUser('sub') userId: string, @Body() dto: WithdrawDto) {
    return this.wallet.withdraw(userId, dto.amount, dto.bankInfo);
  }

  @Post('wallet/convert-xu')
  convertXu(@CurrentUser('sub') userId: string, @Body() dto: ConvertXuDto) {
    return this.wallet.convertToXu(userId, dto.amount);
  }

  @Get('me/coins')
  coinsOverview(@CurrentUser('sub') userId: string) {
    return this.coins.getOverview(userId);
  }
}
