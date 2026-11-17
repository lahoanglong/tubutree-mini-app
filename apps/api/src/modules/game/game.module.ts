import { Module } from '@nestjs/common';
import { GameController } from './game.controller';
import { GameService } from './game.service';
import { GameEconomyService } from './game-economy.service';
import { GameQuizService } from './game-quiz.service';
import { GameReminderService } from './game-reminder.service';
import { GameCommunityService } from './game-community.service';
import { GameCollectionService } from './game-collection.service';
import { GameSeasonService } from './game-season.service';
import { GameGiftService } from './game-gift.service';
import { GameGardenService } from './game-garden.service';
import { GameOrderWaterService } from './game-order-water.service';
import { SeasonPassService } from './season-pass.service';
import { GameArcadeService } from './game-arcade.service';
import { GameMiniController } from './mini/game-mini.controller';
import { GameMiniService } from './mini/game-mini.service';
import { GameMiniContentService } from './mini/game-mini-content.service';
import { GameMiniRewardService } from './mini/game-mini-reward.service';
import { EngagementController } from './missions/engagement.controller';
import { DailyMissionsService } from './missions/daily-missions.service';
import { BadgesService } from './missions/badges.service';
import { DailyCheckInService } from '../daily-check-in/daily-check-in.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { FeedModule } from '../feed/feed.module';

@Module({
  imports: [NotificationsModule, WalletModule, FeedModule],
  controllers: [GameController, GameMiniController, EngagementController],
  providers: [
    GameService,
    GameEconomyService,
    GameQuizService,
    GameReminderService,
    GameCommunityService,
    GameCollectionService,
    GameSeasonService,
    GameGiftService,
    GameGardenService,
    GameOrderWaterService,
    SeasonPassService,
    GameArcadeService,
    GameMiniService,
    GameMiniContentService,
    GameMiniRewardService,
    DailyMissionsService,
    BadgesService,
    // Đố Xanh xong là điểm danh: dùng lại đúng luồng điểm danh gộp (không trạng thái, phụ thuộc đều có trong module này hoặc global).
    DailyCheckInService,
  ],
  exports: [GameService, GameEconomyService, GameOrderWaterService],
})
export class GameModule {}
