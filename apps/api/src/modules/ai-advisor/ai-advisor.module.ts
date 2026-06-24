import { Module } from '@nestjs/common';
import { AiAdvisorController } from './ai-advisor.controller';
import { AiAdvisorService } from './ai-advisor.service';
import { LlmClient } from './llm.client';

@Module({
  controllers: [AiAdvisorController],
  providers: [AiAdvisorService, LlmClient],
  exports: [AiAdvisorService],
})
export class AiAdvisorModule {}
