import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { OrderReturnsService, RETURNS_TO_RECEIVE } from './order-returns.service';
import type { JwtPayload } from '@tubutree/shared-types';
import { ReturnPreviewQuery, ReviewReturnDto } from './dto/return-request.dto';

const RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', RETURNS_TO_RECEIVE] as const;
const SORT_ORDERS = ['asc', 'desc'] as const;

export class ReturnRequestsQuery extends PaginationQuery {
  // Giá trị lạ lọt xuống Prisma thành PrismaClientValidationError → 500 trần; chặn bằng enum thật.
  @IsOptional() @IsIn(RETURN_STATUSES) status?: (typeof RETURN_STATUSES)[number];
  @IsOptional() @IsIn(SORT_ORDERS) order?: (typeof SORT_ORDERS)[number];
  /** Mã đơn, SĐT hoặc tên khách. */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

/** Tài khoản nhận hoàn của khách chỉ cần cho người duyệt hoàn (ADMIN/CSKH); KHO chỉ nhận hàng về nên không thấy. */
const BANK_FIELDS = ['bankName', 'bankAccountNo', 'bankAccountName'] as const;
function forViewer<T>(row: T, viewer: JwtPayload | undefined): T {
  const sees = !viewer || viewer.role !== 'STAFF' || !!viewer.staffPermissions?.includes('CSKH');
  if (sees || !row || typeof row !== 'object') return row;
  const copy = { ...(row as Record<string, unknown>) };
  for (const f of BANK_FIELDS) delete copy[f];
  return copy as T;
}

/** Duyệt đổi/trả theo dòng (D3): xem số tiền tính sẵn → xác nhận → nhận hàng về (cộng kho). */
@Roles('ADMIN')
@Controller('admin/return-requests')
export class ReturnsAdminController {
  constructor(private readonly returns: OrderReturnsService) {}

  @AllowStaff('CSKH', 'KHO')
  @Get()
  async list(@Query() q: ReturnRequestsQuery, @CurrentUser() viewer?: JwtPayload) {
    const res = await this.returns.listForAdmin(q.status, q.page, q.limit, q.order, q.q);
    return { ...res, data: res.data.map((r) => forViewer(r, viewer)) };
  }

  @AllowStaff('CSKH')
  @Get(':id/preview')
  preview(@Param('id') id: string, @Query() q: ReturnPreviewQuery) {
    return this.returns.preview(id, q.shopFault === undefined ? undefined : q.shopFault === 'true');
  }

  @AllowStaff('CSKH')
  @Post(':id/review')
  review(@CurrentUser('sub') adminId: string, @CurrentUser('role') role: string, @Param('id') id: string, @Body() dto: ReviewReturnDto) {
    return this.returns.review(adminId, id, dto, { byStaff: role !== 'ADMIN' });
  }

  @AllowStaff('KHO')
  @Post(':id/received')
  async received(@CurrentUser('sub') adminId: string, @Param('id') id: string, @CurrentUser() viewer?: JwtPayload) {
    return forViewer(await this.returns.markReceived(adminId, id), viewer);
  }
}
