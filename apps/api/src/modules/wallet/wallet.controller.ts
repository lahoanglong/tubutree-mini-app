import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsInt, IsObject, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WalletService } from './wallet.service';

class WithdrawDto {
  @IsInt() @Min(1) amount!: number;
  @IsObject() bankInfo!: object;
}

@Controller()
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('me/wallet')
  get(@CurrentUser('sub') userId: string) {
    return this.wallet.getWallet(userId);
  }

  @Post('wallet/withdraw')
  withdraw(@CurrentUser('sub') userId: string, @Body() dto: WithdrawDto) {
    return this.wallet.withdraw(userId, dto.amount, dto.bankInfo);
  }
}
