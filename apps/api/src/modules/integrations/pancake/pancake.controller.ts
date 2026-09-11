import { Controller, Post, Query } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PancakeSyncService } from './pancake-sync.service';

@Controller('admin/pancake')
export class PancakeController {
  constructor(private readonly sync: PancakeSyncService) {}

  /**
   * Trigger đồng bộ catalog thủ công (admin).
   *
   * `?withStock=1` để GHI ĐÈ tồn kho theo số của Pancake. Mặc định KHÔNG ghi, vì lượt quét không
   * có mốc `updatedSince` đụng toàn bộ catalog và sẽ hồi sinh hàng vừa bán hết cục bộ. Nhưng khi
   * tồn kho local đã lệch thật (sự cố webhook, sửa tay nhầm) thì đây là đường sửa DUY NHẤT trong
   * app — không có cờ này thì chỉ còn cách chạy SQL.
   */
  @Roles('ADMIN')
  @Post('sync')
  async runSync(@Query('withStock') withStock?: string) {
    const overwriteStock = withStock === '1' || withStock === 'true';
    const count = await this.sync.syncProducts(undefined, { forceStock: overwriteStock });
    return { synced: count, stockOverwritten: overwriteStock };
  }
}
