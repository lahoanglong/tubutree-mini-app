import { Controller, Get, Param, Query } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Trim } from '../../common/decorators/trim.decorator';
import { PaginationQuery } from '../../common/pagination';
import { AllowStaff } from '../../common/staff-permissions';
import { ExternalOrdersAdminService } from './external-orders-admin.service';

export class ExternalOrderListQueryDto extends PaginationQuery {
  /** Mã đơn Pancake, mã vận đơn, mã đơn sàn hoặc SĐT đầy đủ. */
  @IsOptional() @Trim() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['MARKETPLACE', 'CHAT', 'UNKNOWN']) source?: 'MARKETPLACE' | 'CHAT' | 'UNKNOWN';
  @IsOptional() @IsIn(['OPEN', 'DELIVERED', 'RETURNING', 'RETURNED', 'CANCELLED', 'PARTIAL_RETURN', 'DELETED']) status?:
    | 'OPEN'
    | 'DELIVERED'
    | 'RETURNING'
    | 'RETURNED'
    | 'CANCELLED'
    | 'PARTIAL_RETURN'
    | 'DELETED';
}

/** Màn "Đơn ngoài app" (chỉ đọc). CSKH xem được để tra đơn cho khách; payload thô chỉ ADMIN. */
@Roles('ADMIN')
@AllowStaff('CSKH')
@Controller('admin/external-orders')
export class ExternalOrdersAdminController {
  constructor(private readonly orders: ExternalOrdersAdminService) {}

  @Get()
  list(@Query() q: ExternalOrderListQueryDto) {
    return this.orders.list(q);
  }

  /** Phải đứng trước `:id` để "sources" không bị hiểu là id. */
  @Get('sources')
  sources() {
    return this.orders.sources();
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.orders.detail(id, user.role === 'ADMIN');
  }
}
