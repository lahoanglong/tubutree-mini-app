import { Module } from '@nestjs/common';
import { CashbackService } from './cashback.service';
import { CashbackController } from './cashback.controller';

@Module({
  controllers: [CashbackController],
  providers: [CashbackService],
})
export class CashbackModule {}
