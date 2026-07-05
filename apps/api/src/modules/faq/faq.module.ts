import { Module } from '@nestjs/common';
import { FaqService } from './faq.service';
import { FaqController } from './faq.controller';
import { FaqAdminController } from './faq-admin.controller';

@Module({
  controllers: [FaqController, FaqAdminController],
  providers: [FaqService],
  exports: [FaqService],
})
export class FaqModule {}
