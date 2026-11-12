import { Module } from '@nestjs/common';
import { FaqModule } from '../faq/faq.module';
import { AdvisorStatsController } from './advisor-stats.controller';
import { AdvisorStatsService } from './advisor-stats.service';
import { AiAdvisorController } from './ai-advisor.controller';
import { AiAdvisorService } from './ai-advisor.service';
import { AnthropicClient } from './anthropic.client';
import { CopyAiService } from './copy-ai.service';
import { LlmClient } from './llm.client';
import { StoryAiService } from './story-ai.service';

@Module({
  imports: [FaqModule],
  controllers: [AiAdvisorController, AdvisorStatsController],
  providers: [AiAdvisorService, AdvisorStatsService, LlmClient, AnthropicClient, StoryAiService, CopyAiService],
  exports: [AiAdvisorService, StoryAiService, CopyAiService],
})
export class AiAdvisorModule {}
