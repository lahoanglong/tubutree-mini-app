import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { SystemConfigService } from './system-config.service';
import { buildPublicConfig } from './public-config';

/**
 * Config hiển thị an toàn cho client (public) — WHITELIST rõ ràng, KHÔNG dùng getByCategory
 * để tránh lộ key nội bộ/secret. Hiện phục vụ badge freeship ở PDP.
 */
@Public()
@Controller('config')
export class SystemConfigController {
  constructor(private readonly config: SystemConfigService) {}

  @Get('public')
  @PublicCache('STATIC')
  /** Tham số nghiệp vụ FE cần để hiển thị đúng; xem buildPublicConfig. */
  publicConfig() {
    return buildPublicConfig(this.config);
  }
}
