import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GameService } from './game.service';

class AnswerDto {
  @IsInt() @Min(0) choice!: number;
}
class WaterDto {
  @IsInt() @Min(1) drops!: number;
}

@Controller('game')
export class GameController {
  constructor(private readonly game: GameService) {}

  @Get('profile')
  profile(@CurrentUser('sub') userId: string) {
    return this.game.getProfile(userId);
  }

  @Post('check-in')
  checkIn(@CurrentUser('sub') userId: string) {
    return this.game.checkIn(userId);
  }

  @Post('spin')
  spin(@CurrentUser('sub') userId: string) {
    return this.game.spin(userId);
  }

  @Get('quiz/today')
  quizToday(@CurrentUser('sub') userId: string) {
    return this.game.getTodayQuiz(userId);
  }

  @Post('quiz/:id/answer')
  answer(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: AnswerDto) {
    return this.game.answerQuiz(userId, id, dto.choice);
  }

  @Post('tree/water')
  water(@CurrentUser('sub') userId: string, @Body() dto: WaterDto) {
    return this.game.waterTree(userId, dto.drops);
  }

  @Get('missions')
  missions(@CurrentUser('sub') userId: string) {
    return this.game.getMissions(userId);
  }

  @Public()
  @Get('leaderboard')
  leaderboard() {
    return this.game.getLeaderboard();
  }
}
