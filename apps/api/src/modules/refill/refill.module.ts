import { Module } from '@nestjs/common';
import { RefillController } from './refill.controller';
import { RefillService } from './refill.service';

@Module({
  controllers: [RefillController],
  providers: [RefillService],
  exports: [RefillService],
})
export class RefillModule {}
