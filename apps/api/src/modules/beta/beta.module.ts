import { Module } from '@nestjs/common';
import { BetaController } from './beta.controller';
import { BetaService } from './beta.service';

@Module({
  controllers: [BetaController],
  providers: [BetaService],
  exports: [BetaService],
})
export class BetaModule {}
