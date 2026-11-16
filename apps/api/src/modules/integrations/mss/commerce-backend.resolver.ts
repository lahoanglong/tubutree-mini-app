import { Inject, Injectable, Optional } from '@nestjs/common';
import { PancakeDirectBackend } from '../pancake/pancake-direct.backend';
import { CommerceBackendUnavailableError, DEFAULT_BACKEND_ROUTE, MSS_COMMERCE_BACKEND, type BackendRoute, type CommerceBackend } from './commerce-backend';
import { MssHealthService } from './mss-health.service';

/**
 * Bộ chọn đường cho đơn. Hai câu hỏi tách bạch:
 * - `routeForNewOrder()`: lúc tạo đơn, ghi tuyến nào vào `orders.backendRoute`. Chỉ ra `MSS` khi đã có hiện thực MSS trong bản
 *   build, cờ `mss.order_push_enabled` bật, đủ biến và MSS công bố năng lực `orders`. Wave này không đăng ký hiện thực MSS nên luôn
 *   ra `PANCAKE_DIRECT` (không đọc cờ).
 * - `resolveBackend(order)`: đơn đã có tuyến thì đi đúng tuyến đó, KHÔNG xét cờ (lật cờ không làm đơn cũ đổi đường).
 */
@Injectable()
export class CommerceBackendResolver {
  constructor(
    private readonly pancakeDirect: PancakeDirectBackend,
    @Optional() private readonly health?: MssHealthService,
    @Optional() @Inject(MSS_COMMERCE_BACKEND) private readonly mss?: CommerceBackend,
  ) {}

  async routeForNewOrder(): Promise<BackendRoute> {
    if (!this.mss || !this.health) return DEFAULT_BACKEND_ROUTE;
    return (await this.health.assertCapability('orderPush')) ? 'MSS' : DEFAULT_BACKEND_ROUTE;
  }

  resolveBackend(order: { backendRoute: string }): CommerceBackend {
    switch (order.backendRoute) {
      case 'PANCAKE_DIRECT':
        return this.pancakeDirect;
      case 'MSS':
        if (this.mss) return this.mss;
        throw new CommerceBackendUnavailableError('MSS');
      default:
        // Cột có CHECK ở DB; giá trị lạ chỉ tới từ dữ liệu giả hay đọc thiếu cột. Không đoán là Pancake: đơn có thể bị đẩy hai đường.
        throw new CommerceBackendUnavailableError(String(order.backendRoute));
    }
  }
}
