import { Module } from '@nestjs/common';
import { PancakeClient } from './pancake.client';
import { PancakeSyncHooks } from './pancake-sync-hooks';
import { GomdonAlertService } from '../gomdon/gomdon-alert.service';
import { GeoService } from './geo.service';

/**
 * PancakeClient + móc nối Tubu → Pancake cho OrdersModule/thanh toán. Không import OrdersModule/PancakeModule (chúng
 * import module này) để không vòng. GomdonAlertService chỉ cần PrismaService + NotificationsService (@Global). GeoService (danh mục địa giới, chỉ
 * cần PancakeClient) ở đây để OrdersModule kiểm phường thuộc tỉnh khi khách tự sửa địa chỉ đơn; PancakeModule xuất lại module này nên mọi nơi
 * dùng chung một bản (một đệm danh mục).
 */
@Module({
  providers: [PancakeClient, PancakeSyncHooks, GomdonAlertService, GeoService],
  exports: [PancakeClient, PancakeSyncHooks, GeoService],
})
export class PancakeSyncHooksModule {}
