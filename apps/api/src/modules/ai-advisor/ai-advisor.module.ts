import { Module } from '@nestjs/common';
import { FaqModule } from '../faq/faq.module';
import { AiAdvisorController } from './ai-advisor.controller';
import { AiAdvisorService } from './ai-advisor.service';
import { LlmClient } from './llm.client';

@Module({
  imports: [FaqModule],
  controllers: [AiAdvisorController],
  providers: [AiAdvisorService, LlmClient],
  exports: [AiAdvisorService],
})
export class AiAdvisorModule {}
