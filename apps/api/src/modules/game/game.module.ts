import { Module } from '@nestjs/common';
import { GameController } from './game.controller';
import { GameService } from './game.service';
import { GameEconomyService } from './game-economy.service';
import { GameQuizService } from './game-quiz.service';

@Module({
  controllers: [GameController],
  providers: [GameService, GameEconomyService, GameQuizService],
  exports: [GameService],
})
export class GameModule {}
