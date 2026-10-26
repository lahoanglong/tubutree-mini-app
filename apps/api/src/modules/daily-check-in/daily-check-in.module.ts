import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module';
import { DailyCheckInController } from './daily-check-in.controller';
import { DailyCheckInService } from './daily-check-in.service';

@Module({
  imports: [GameModule],
  controllers: [DailyCheckInController],
  providers: [DailyCheckInService],
})
export class DailyCheckInModule {}
