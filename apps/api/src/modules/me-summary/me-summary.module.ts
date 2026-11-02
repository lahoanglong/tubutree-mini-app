import { Module } from '@nestjs/common';
import { MeSummaryController } from './me-summary.controller';
import { MeSummaryService } from './me-summary.service';

@Module({
  controllers: [MeSummaryController],
  providers: [MeSummaryService],
})
export class MeSummaryModule {}
