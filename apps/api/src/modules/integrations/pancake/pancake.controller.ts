import { Controller, Post } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { PancakeSyncService } from './pancake-sync.service';

@Controller('admin/pancake')
export class PancakeController {
  constructor(private readonly sync: PancakeSyncService) {}

  /** Trigger đồng bộ catalog thủ công (admin). */
  @Roles('ADMIN')
  @Post('sync')
  async runSync() {
    const count = await this.sync.syncProducts();
    return { synced: count };
  }
}
