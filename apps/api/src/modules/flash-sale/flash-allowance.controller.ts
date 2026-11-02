import { Controller, Get, Header, Query } from '@nestjs/common';
import type { FlashAllowanceResponse } from '@tubutree/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FlashAllowanceService, parseAllowanceItemIds } from './flash-allowance.service';

// Không @Public(): JwtAuthGuard toàn app trả 401 cho khách. `userId` chỉ lấy từ JWT, không từ query.
@Controller('flash-sales/me')
export class FlashAllowanceController {
  constructor(private readonly allowances: FlashAllowanceService) {}

  /** Số theo khách nên `private, no-store`: proxy/CDN không được giữ chung bản của người này cho người khác. */
  @Header('Cache-Control', 'private, no-store')
  @Get('allowance')
  allowance(@CurrentUser('sub') userId: string, @Query('items') items?: unknown): Promise<FlashAllowanceResponse> {
    return this.allowances.forUser(userId, parseAllowanceItemIds(items));
  }
}
