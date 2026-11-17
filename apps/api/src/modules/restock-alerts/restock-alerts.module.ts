import { Module } from '@nestjs/common';
import { RestockAlertsController } from './restock-alerts.controller';
import { RestockAlertsDispatcher } from './restock-alerts.dispatcher';
import { RestockAlertsService } from './restock-alerts.service';

@Module({
  controllers: [RestockAlertsController],
  providers: [RestockAlertsService, RestockAlertsDispatcher],
})
export class RestockAlertsModule {}
