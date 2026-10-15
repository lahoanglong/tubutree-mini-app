import { Module } from '@nestjs/common';
import { RefillController } from './refill.controller';
import { RefillLocationsAdminController } from './refill-locations-admin.controller';
import { RefillLocationsService } from './refill-locations.service';
import { RefillService } from './refill.service';

@Module({
  controllers: [RefillController, RefillLocationsAdminController],
  providers: [RefillService, RefillLocationsService],
  exports: [RefillService],
})
export class RefillModule {}
