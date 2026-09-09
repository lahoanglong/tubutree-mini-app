import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { OrdersModule } from '../orders/orders.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [CatalogModule, OrdersModule, StaffModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
