import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsIn, IsInt, Min } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GameService } from './game.service';
import { GameEconomyService } from './game-economy.service';
import { GameQuizService } from './game-quiz.service';
import { GameCommunityService } from './game-community.service';
import { GameCollectionService } from './game-collection.service';
import { GameSeasonService } from './game-season.service';
import { GameGiftService } from './game-gift.service';
import { GameGardenService } from './game-garden.service';

class AnswerDto { @IsInt() @Min(0) choice!: number; }
class WaterDto { @IsInt() @Min(1) drops!: number; }
class BuySeedsDto { @IsInt() @Min(1) seeds!: number; }
class UnlockPlotDto { @IsIn(['SEEDS', 'XU']) currency!: 'SEEDS' | 'XU'; }

@Controller('game')
export class GameController {
  constructor(
    private readonly game: GameService,
    private readonly economy: GameEconomyService,
    private readonly quiz: GameQuizService,
    private readonly community: GameCommunityService,
    private readonly collection: GameCollectionService,
    private readonly season: GameSeasonService,
    private readonly gift: GameGiftService,
    private readonly garden: GameGardenService,
  ) {}

  @Get('profile')
  profile(@CurrentUser('sub') userId: string) { return this.game.getProfile(userId); }

  @Post('check-in')
  checkIn(@CurrentUser('sub') userId: string) { return this.economy.checkIn(userId); }

  @Post('dew/collect')
  dew(@CurrentUser('sub') userId: string) { return this.economy.collectDew(userId); }

  @Post('streak-freeze/buy')
  buyFreeze(@CurrentUser('sub') userId: string) { return this.economy.buyStreakFreeze(userId); }

  @Post('streak/repair')
  repairStreak(@CurrentUser('sub') userId: string) { return this.economy.repairStreak(userId); }

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

  @Post('seeds/buy')
  buySeeds(@CurrentUser('sub') userId: string, @Body() dto: BuySeedsDto) { return this.game.buySeeds(userId, dto.seeds); }

  @Post('tree/buy')
  buyTree(@CurrentUser('sub') userId: string) { return this.game.buyTree(userId); }

  @Get('missions')
  missions(@CurrentUser('sub') userId: string) { return this.game.getMissions(userId); }

  @Get('forest')
  forest(@CurrentUser('sub') userId: string) { return this.game.getForest(userId); }

  @Get('community')
  communityState(@CurrentUser('sub') userId: string) { return this.community.getCommunityState(userId); }

  @Get('collection')
  collectionCodex(@CurrentUser('sub') userId: string) { return this.collection.getCodex(userId); }

  @Public()
  @Get('season')
  activeSeason() { return this.season.getActiveSeason(); }

  @Public()
  @Get('season/leaderboard')
  seasonLeaderboard() { return this.season.getSeasonLeaderboard(); }

  @Get('garden')
  getGarden(@CurrentUser('sub') userId: string) { return this.garden.getGarden(userId); }

  @Post('garden/unlock')
  unlockPlot(@CurrentUser('sub') userId: string, @Body() dto: UnlockPlotDto) {
    return this.garden.unlockPlot(userId, dto.currency);
  }

  @Post('garden/plot/:id/water')
  waterPlot(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: WaterDto) {
    return this.garden.waterPlot(userId, id, dto.drops);
  }

  @Get('friends')
  friends(@CurrentUser('sub') userId: string) { return this.gift.getFriends(userId); }

  @Post('gift/:recipientId')
  giftWater(@CurrentUser('sub') userId: string, @Param('recipientId') recipientId: string) {
    return this.gift.giftWater(userId, recipientId);
  }

  @Public()
  @Get('leaderboard')
  leaderboard() { return this.game.getLeaderboard(); }
}
