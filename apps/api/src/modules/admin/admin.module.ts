import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { OrdersModule } from '../orders/orders.module';
import { StaffModule } from '../staff/staff.module';
// Thao tác vận đơn thu gom (tạo lại / huỷ) + tình trạng tích hợp — dùng GomdonOrderService/GomdonClient
// đã export. GomdonModule không import ngược AdminModule nên không có vòng phụ thuộc.
import { GomdonModule } from '../integrations/gomdon/gomdon.module';

@Module({
  imports: [CatalogModule, OrdersModule, StaffModule, GomdonModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
