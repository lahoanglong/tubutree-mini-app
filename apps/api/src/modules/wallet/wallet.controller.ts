import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsObject, IsString, Min, ValidateNested } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WalletService } from './wallet.service';
import { CoinsService } from './coins.service';

class BankInfoDto {
  @IsString() @IsNotEmpty() bankName!: string;
  @IsString() @IsNotEmpty() accountNumber!: string;
  @IsString() @IsNotEmpty() accountName!: string;
}

class WithdrawDto {
  @IsInt() @Min(1) amount!: number;
  @IsObject() @ValidateNested() @Type(() => BankInfoDto) bankInfo!: BankInfoDto;
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
  withdraw(
    @CurrentUser('sub') userId: string,
    @Body() dto: WithdrawDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.wallet.withdraw(userId, dto.amount, dto.bankInfo, idempotencyKey);
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
