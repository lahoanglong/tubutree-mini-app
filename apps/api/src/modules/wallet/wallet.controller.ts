import { Body, Controller, Get, GoneException, Headers, Post, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsObject, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { WalletService } from './wallet.service';
import { RewardPointsService } from './reward-points.service';

class BankInfoDto {
  @IsString() @IsNotEmpty() @MaxLength(120) bankName!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s.-]/g, '') : value))
  @IsString()
  @Matches(/^[0-9A-Za-z]{6,20}$/, { message: 'Số tài khoản phải gồm 6–20 chữ số.' })
  accountNumber!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) accountName!: string;
}

export class WithdrawDto {
  @IsInt() @Min(1) amount!: number;
  @IsObject() @ValidateNested() @Type(() => BankInfoDto) bankInfo!: BankInfoDto;
}

@Controller()
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly rewards: RewardPointsService,
  ) {}

  @Get('me/wallet')
  get(@CurrentUser('sub') userId: string) {
    return this.wallet.getWallet(userId);
  }

  @Get('me/wallet/transactions')
  transactions(@CurrentUser('sub') userId: string, @Query() q: PaginationQuery) {
    return this.wallet.getTransactions(userId, q.page, q.limit);
  }

  @Post('wallet/withdraw')
  withdraw(
    @CurrentUser('sub') userId: string,
    @Body() dto: WithdrawDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.wallet.withdraw(userId, dto.amount, dto.bankInfo, idempotencyKey);
  }

  // PD-3 (spec 5, 7.1): hai route xu cũ trả 410 một bản phát hành, không nhận body (không 400 trước 410).
  @Post('wallet/convert-xu')
  convertXu(): Promise<never> {
    return this.wallet.convertToXu();
  }

  @Get('me/coins')
  coinsOverview(): never {
    throw new GoneException('Xu đã gộp vào Điểm Xanh. Xem số dư ở mục Điểm Xanh, thống kê giới thiệu ở /me/referral.');
  }

  /** Thống kê giới thiệu bằng Điểm Xanh (thay phần giới thiệu của GET /me/coins, PD-3 mục 5). */
  @Get('me/referral')
  referralOverview(@CurrentUser('sub') userId: string) {
    return this.rewards.getReferralOverview(userId);
  }
}
