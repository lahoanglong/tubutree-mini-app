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
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [NotificationsModule, WalletModule],
  controllers: [GameController],
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
  ],
  exports: [GameService],
})
export class GameModule {}
