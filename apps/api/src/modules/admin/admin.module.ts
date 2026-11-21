import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './admin-users.controller';
import { ImageRegistryModule } from '../catalog/image-registry.module';
import { UserBlockService } from './user-block.service';
import { AdminEngagementController } from './admin-engagement.controller';
import { AdminEngagementService } from './admin-engagement.service';
import { AdminGameSeasonController } from './admin-game-season.controller';
import { AdminGameSeasonService } from './admin-game-season.service';
import { AdminGameQuizController } from './admin-game-quiz.controller';
import { GameQuizService } from '../game/game-quiz.service';
import { AdminGameMiniController } from './admin-game-mini.controller';
import { GameMiniAdminService } from '../game/mini/game-mini-admin.service';
import { GameMiniContentService } from '../game/mini/game-mini-content.service';
import { AdminCouponBatchController } from './admin-coupon-batch.controller';
import { AdminCouponBatchService } from './admin-coupon-batch.service';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';
import { CatalogModule } from '../catalog/catalog.module';
import { OrdersModule } from '../orders/orders.module';
import { StaffModule } from '../staff/staff.module';
import { MerchantModule } from '../merchant/merchant.module';
// Thao tác vận đơn thu gom (tạo lại / huỷ) + tình trạng tích hợp — dùng GomdonOrderService/GomdonClient
// đã export. GomdonModule không import ngược AdminModule nên không có vòng phụ thuộc.
import { GomdonModule } from '../integrations/gomdon/gomdon.module';
import { GoLiveController } from './golive/golive.controller';
import { GoLiveCockpitService } from './golive/golive-cockpit.service';
import { GoLivePilotService } from './golive/golive-pilot.service';

@Module({
  imports: [ImageRegistryModule, CatalogModule, OrdersModule, StaffModule, GomdonModule, MerchantModule],
  controllers: [AdminController, AdminUsersController, AdminEngagementController, AdminGameSeasonController, AdminGameQuizController, AdminGameMiniController, AdminCouponBatchController, AdminReportsController, GoLiveController],
  providers: [AdminService, UserBlockService, AdminEngagementService, AdminGameSeasonService, GameQuizService, GameMiniAdminService, GameMiniContentService, AdminCouponBatchService, AdminReportsService, GoLiveCockpitService, GoLivePilotService],
})
export class AdminModule {}
