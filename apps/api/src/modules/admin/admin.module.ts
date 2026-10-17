import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './admin-users.controller';
import { UserBlockService } from './user-block.service';
import { AdminEngagementController } from './admin-engagement.controller';
import { AdminEngagementService } from './admin-engagement.service';
import { AdminReportsController } from './admin-reports.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { OrdersModule } from '../orders/orders.module';
import { StaffModule } from '../staff/staff.module';
import { MerchantModule } from '../merchant/merchant.module';
// Thao tác vận đơn thu gom (tạo lại / huỷ) + tình trạng tích hợp — dùng GomdonOrderService/GomdonClient
// đã export. GomdonModule không import ngược AdminModule nên không có vòng phụ thuộc.
import { GomdonModule } from '../integrations/gomdon/gomdon.module';

@Module({
  imports: [CatalogModule, OrdersModule, StaffModule, GomdonModule, MerchantModule],
  controllers: [AdminController, AdminUsersController, AdminEngagementController, AdminReportsController],
  providers: [AdminService, UserBlockService, AdminEngagementService],
})
export class AdminModule {}
