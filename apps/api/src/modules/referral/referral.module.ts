import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module';
import { GreenCardController } from './green-card.controller';
import { GreenCardService } from './green-card.service';

/**
 * Vòng giới thiệu bạn bè: thẻ thành tích Sổ tay Xanh kèm link mời. Thưởng đơn đầu nằm cạnh thưởng đơn thứ 2 ở
 * RewardPointsService (wallet) để đường giao đơn không thêm phụ thuộc; luật của nó ở first-order-reward.ts trong thư mục này.
 */
@Module({
  imports: [GameModule],
  controllers: [GreenCardController],
  providers: [GreenCardService],
})
export class ReferralModule {}
