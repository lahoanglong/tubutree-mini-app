import { Module } from '@nestjs/common';
import { FaqModule } from '../faq/faq.module';
import { AiAdvisorController } from './ai-advisor.controller';
import { AiAdvisorService } from './ai-advisor.service';
import { AnthropicClient } from './anthropic.client';
import { LlmClient } from './llm.client';
import { StoryAiService } from './story-ai.service';

@Module({
  imports: [FaqModule],
  controllers: [AiAdvisorController],
  providers: [AiAdvisorService, LlmClient, AnthropicClient, StoryAiService],
  exports: [AiAdvisorService, StoryAiService],
})
export class AiAdvisorModule {}
