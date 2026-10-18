import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import type { JwtPayload } from '@tubutree/shared-types';
import { maskPhoneKeepLast3, maskPhoneLikeRuns } from '../../common/mask-pii';
import { seesFullOrderPhones } from '../admin/order-actor-transitions';
import { CustomerRefundsService } from './customer-refunds.service';

/**
 * Người không thấy SĐT khách đầy đủ (Kế toán đơn thuần) chỉ nhận 3 số cuối ở `phone` và ở dãy giống SĐT trong ghi chú;
 * tài khoản ngân hàng giữ nguyên vì cần để chuyển tiền. Thiếu `viewer` thì che (an toàn).
 */
function forViewer<T>(row: T, viewer: JwtPayload | undefined): T {
  if (viewer && seesFullOrderPhones(viewer)) return row;
  const r = row as { phone?: string | null; adminNote?: string | null } | null;
  if (!r || typeof r !== 'object') return row;
  return {
    ...r,
    ...(r.phone ? { phone: maskPhoneKeepLast3(r.phone) } : {}),
    ...(r.adminNote ? { adminNote: maskPhoneLikeRuns(r.adminNote) } : {}),
  } as T;
}

/** OPEN = mọi khoản còn việc (chờ đối soát, chờ chuyển khoản, đang chuyển khoản) — cùng tập với thẻ "Hoàn tiền khách". */
const CUSTOMER_REFUND_STATUSES = ['OPEN', 'UNVERIFIED', 'PENDING', 'PROCESSING', 'COMPLETED', 'DISMISSED'] as const;
const CUSTOMER_REFUND_KINDS = ['END_CUSTOMER', 'CANCEL', 'RETURN', 'LATE_PAYMENT', 'OVERPAYMENT'] as const;

export class ListCustomerRefundsQuery extends PaginationQuery {
  @IsOptional() @IsIn(CUSTOMER_REFUND_STATUSES) status?: (typeof CUSTOMER_REFUND_STATUSES)[number];
  @IsOptional() @IsIn(CUSTOMER_REFUND_KINDS) kind?: (typeof CUSTOMER_REFUND_KINDS)[number];
}

/** Admin khác người đang chuyển khoản phải chọn tiếp quản tường minh kèm lý do (ghi vào lịch sử đơn). */
export class TakeOverRefundDto {
  @IsOptional() @IsBoolean() takeOver?: boolean;
  @IsOptional() @IsString() @MaxLength(300) takeOverReason?: string;
}

export class MarkCustomerRefundPaidDto extends TakeOverRefundDto {
  /** Mã giao dịch ngân hàng — bằng chứng đã chuyển, khách thấy trong thông báo. */
  @IsString() @MinLength(1) @MaxLength(100) bankRef!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** Tài khoản khách gửi qua kênh khác khi khoản chưa có tài khoản nhận. */
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) accountName?: string;
}

export class ClaimCustomerRefundDto {
  /** Tài khoản khách gửi qua kênh khác khi khoản chưa có tài khoản nhận. */
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) accountName?: string;
}

/** "Xác nhận tiền dư": số dư thực nhận trên sao kê (mặc định số Pancake báo; service chặn vượt số đó). */
export class VerifyOverpaymentDto {
  @IsOptional() @IsInt() @Min(1) amount?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** "Không phải tiền dư": lý do bắt buộc (lưu vào khoản và lịch sử đơn). */
export class DismissOverpaymentDto {
  @IsString() @MinLength(5) @MaxLength(300) reason!: string;
}

@Roles('ADMIN')
@AllowStaff('KE_TOAN')
@Controller('admin/customer-refunds')
export class CustomerRefundsAdminController {
  constructor(private readonly refunds: CustomerRefundsService) {}

  @Get()
  async list(@Query() q: ListCustomerRefundsQuery, @CurrentUser() viewer: JwtPayload) {
    const res = await this.refunds.list(q.status, q.page, q.limit, q.kind);
    return { ...res, data: res.data.map((r) => forViewer(r, viewer)) };
  }

  /** "Bắt đầu chuyển khoản" (khoản sang Đang chuyển khoản): khoá nơi nhận trước khi admin chuyển tiền (khách không đổi sang Ví được nữa). */
  @Post(':id/claim')
  async claim(
    @CurrentUser('sub') adminId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body() dto: ClaimCustomerRefundDto,
    @CurrentUser() viewer?: JwtPayload,
  ) {
    return forViewer(await this.refunds.claim(adminId, id, { ...dto, byStaff: role !== 'ADMIN' }), viewer);
  }

  /** Trả khoản về hàng chờ khi chưa chuyển được (khách lại đổi được nơi nhận). */
  @Post(':id/release')
  async release(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: TakeOverRefundDto, @CurrentUser() viewer?: JwtPayload) {
    return forViewer(await this.refunds.release(adminId, id, dto), viewer);
  }

  /** Khoản dư Pancake báo đã đối chiếu sao kê: thành khoản chờ chuyển khoản, khách được báo để chọn nơi nhận. */
  @Post(':id/verify')
  async verify(
    @CurrentUser('sub') adminId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body() dto: VerifyOverpaymentDto,
    @CurrentUser() viewer?: JwtPayload,
  ) {
    return forViewer(await this.refunds.verifyOverpayment(adminId, id, { ...dto, byStaff: role !== 'ADMIN' }), viewer);
  }

  /** Khoản dư Pancake báo nhưng sao kê không có: đóng khoản, không báo khách. */
  @Post(':id/dismiss')
  async dismiss(
    @CurrentUser('sub') adminId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body() dto: DismissOverpaymentDto,
    @CurrentUser() viewer?: JwtPayload,
  ) {
    return forViewer(await this.refunds.dismissOverpayment(adminId, id, { ...dto, byStaff: role !== 'ADMIN' }), viewer);
  }

  @Post(':id/mark-paid')
  async markPaid(
    @CurrentUser('sub') adminId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body() dto: MarkCustomerRefundPaidDto,
    @CurrentUser() viewer?: JwtPayload,
  ) {
    return forViewer(await this.refunds.markPaid(adminId, id, { ...dto, byStaff: role !== 'ADMIN' }), viewer);
  }
}
