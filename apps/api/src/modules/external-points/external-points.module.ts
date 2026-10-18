import { Module } from '@nestjs/common';
import { ExternalOrdersAdminController } from './external-orders-admin.controller';
import { ExternalOrdersAdminService } from './external-orders-admin.service';

@Module({
  controllers: [ExternalOrdersAdminController],
  providers: [ExternalOrdersAdminService],
})
export class ExternalPointsModule {}
