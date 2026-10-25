import { Controller, Get, GoneException, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { WalletService } from './wallet.service';
import { RewardPointsService } from './reward-points.service';

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

  // Chính sách Zalo 4.5 cấm rút tiền: route giữ lại trả 410 (không nhận body, không 400 trước 410) để client cũ nhận câu đọc được.
  @Post('wallet/withdraw')
  withdraw(): never {
    throw new GoneException('Ví Tubu chỉ dùng để trả tiền hàng, không rút ra ngoài.');
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
