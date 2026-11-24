import { Module } from '@nestjs/common';
import { RestockAlertsController } from './restock-alerts.controller';
import { RestockAlertsDispatcher } from './restock-alerts.dispatcher';
import { RestockAlertsService } from './restock-alerts.service';
import { RestockPlannerController } from './restock-planner.controller';
import { RestockPlannerService } from './restock-planner.service';

@Module({
  controllers: [RestockAlertsController, RestockPlannerController],
  providers: [RestockAlertsService, RestockAlertsDispatcher, RestockPlannerService],
})
export class RestockAlertsModule {}
