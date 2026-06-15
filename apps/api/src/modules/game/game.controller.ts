import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GameService } from './game.service';
import { GameEconomyService } from './game-economy.service';
import { GameQuizService } from './game-quiz.service';
import { GameCommunityService } from './game-community.service';

class AnswerDto { @IsInt() @Min(0) choice!: number; }
class WaterDto { @IsInt() @Min(1) drops!: number; }

@Controller('game')
export class GameController {
  constructor(
    private readonly game: GameService,
    private readonly economy: GameEconomyService,
    private readonly quiz: GameQuizService,
    private readonly community: GameCommunityService,
  ) {}

  @Get('profile')
  profile(@CurrentUser('sub') userId: string) { return this.game.getProfile(userId); }

  @Post('check-in')
  checkIn(@CurrentUser('sub') userId: string) { return this.economy.checkIn(userId); }

  @Post('dew/collect')
  dew(@CurrentUser('sub') userId: string) { return this.economy.collectDew(userId); }

  @Post('streak-freeze/buy')
  buyFreeze(@CurrentUser('sub') userId: string) { return this.economy.buyStreakFreeze(userId); }

  @Post('spin')
  spin(@CurrentUser('sub') userId: string) { return this.game.spin(userId); }

  @Get('quiz/today')
  quizToday(@CurrentUser('sub') userId: string) { return this.quiz.getTodayQuiz(userId); }

  @Post('quiz/:id/answer')
  answer(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: AnswerDto) {
    return this.quiz.answerQuiz(userId, id, dto.choice);
  }

  @Post('tree/water')
  water(@CurrentUser('sub') userId: string, @Body() dto: WaterDto) { return this.game.waterTree(userId, dto.drops); }

  @Get('missions')
  missions(@CurrentUser('sub') userId: string) { return this.game.getMissions(userId); }

  @Get('forest')
  forest(@CurrentUser('sub') userId: string) { return this.game.getForest(userId); }

  @Get('community')
  communityState(@CurrentUser('sub') userId: string) { return this.community.getCommunityState(userId); }

  @Public()
  @Get('leaderboard')
  leaderboard() { return this.game.getLeaderboard(); }
}
