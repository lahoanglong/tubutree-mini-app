import { Module } from '@nestjs/common';
import { GameController } from './game.controller';
import { GameService } from './game.service';
import { GameEconomyService } from './game-economy.service';
import { GameQuizService } from './game-quiz.service';
import { GameReminderService } from './game-reminder.service';
import { GameCommunityService } from './game-community.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [GameController],
  providers: [
    GameService,
    GameEconomyService,
    GameQuizService,
    GameReminderService,
    GameCommunityService,
  ],
  exports: [GameService],
})
export class GameModule {}
