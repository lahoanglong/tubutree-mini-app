import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SystemConfigService } from './system-config.service';

/**
 * Config hiển thị an toàn cho client (public) — WHITELIST rõ ràng, KHÔNG dùng getByCategory
 * để tránh lộ key nội bộ/secret. Hiện phục vụ badge freeship ở PDP.
 */
@Public()
@Controller('config')
export class SystemConfigController {
  constructor(private readonly config: SystemConfigService) {}

  @Get('public')
  async publicConfig() {
    const freeshipThreshold = await this.config.get<number>('shipping.free_threshold', 200000);
    return { freeshipThreshold };
  }
}
