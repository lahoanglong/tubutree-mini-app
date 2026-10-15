import { Module } from '@nestjs/common';
import { PancakeClient } from './pancake.client';
import { PancakeSyncHooks } from './pancake-sync-hooks';
import { GomdonAlertService } from '../gomdon/gomdon-alert.service';

/**
 * PancakeClient + móc nối Tubu → Pancake cho OrdersModule/thanh toán. Không import OrdersModule/PancakeModule (chúng
 * import module này) để không vòng. GomdonAlertService chỉ cần PrismaService + NotificationsService (@Global).
 */
@Module({
  providers: [PancakeClient, PancakeSyncHooks, GomdonAlertService],
  exports: [PancakeClient, PancakeSyncHooks],
})
export class PancakeSyncHooksModule {}
