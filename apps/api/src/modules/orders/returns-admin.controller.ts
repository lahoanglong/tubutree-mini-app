import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { OrderReturnsService, RETURNS_TO_RECEIVE } from './order-returns.service';
import { ReturnPreviewQuery, ReviewReturnDto } from './dto/return-request.dto';

const RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', RETURNS_TO_RECEIVE] as const;
const SORT_ORDERS = ['asc', 'desc'] as const;

export class ReturnRequestsQuery extends PaginationQuery {
  // Giá trị lạ lọt xuống Prisma thành PrismaClientValidationError → 500 trần; chặn bằng enum thật.
  @IsOptional() @IsIn(RETURN_STATUSES) status?: (typeof RETURN_STATUSES)[number];
  @IsOptional() @IsIn(SORT_ORDERS) order?: (typeof SORT_ORDERS)[number];
}

/** Duyệt đổi/trả theo dòng (D3): xem số tiền tính sẵn → xác nhận → nhận hàng về (cộng kho). */
@Roles('ADMIN')
@Controller('admin/return-requests')
export class ReturnsAdminController {
  constructor(private readonly returns: OrderReturnsService) {}

  @AllowStaff('CSKH', 'KHO')
  @Get()
  list(@Query() q: ReturnRequestsQuery) {
    return this.returns.listForAdmin(q.status, q.page, q.limit, q.order);
  }

  @AllowStaff('CSKH')
  @Get(':id/preview')
  preview(@Param('id') id: string, @Query() q: ReturnPreviewQuery) {
    return this.returns.preview(id, q.shopFault === undefined ? undefined : q.shopFault === 'true');
  }

  @AllowStaff('CSKH')
  @Post(':id/review')
  review(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ReviewReturnDto) {
    return this.returns.review(adminId, id, dto);
  }

  @AllowStaff('KHO')
  @Post(':id/received')
  received(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.returns.markReceived(adminId, id);
  }
}
