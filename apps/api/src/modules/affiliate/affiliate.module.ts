import { Global, Module } from '@nestjs/common';
import { PancakeModule } from '../integrations/pancake/pancake.module';
import { AffiliateService } from './affiliate.service';
import { AffiliateController } from './affiliate.controller';

@Global()
@Module({
  imports: [PancakeModule],
  controllers: [AffiliateController],
  providers: [AffiliateService],
  exports: [AffiliateService],
})
export class AffiliateModule {}
