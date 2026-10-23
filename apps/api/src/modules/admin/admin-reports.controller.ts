import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsOptional } from 'class-validator';
import type { CustomerRefundKind, CustomerRefundStatus, PayoutStatus } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { vnDateKey } from '../../common/vn-time';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '@tubutree/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { seesFullOrderPhones } from './order-actor-transitions';
import { AdminService } from './admin.service';
import { ExportOrdersQuery } from './admin.controller';
import { orderItemCsvChunks } from './admin-order-items-export';
import { streamCsv } from './admin-export';
import { AdminReportsService } from './admin-reports.service';
import { IsCalendarDate } from '../../common/calendar-date';
import { EXPORT_MAX_DAYS, resolveReportRange } from './report-range';
import { payoutCsvChunks, payoutExportWhere, pitCsvChunks, refundCsvChunks, refundExportWhere } from './admin-finance-export';

/** Khoảng ngày giờ VN, tính cả hai đầu. Thiếu thì lấy 30 ngày gần nhất (resolveReportRange). */
export class ReportRangeQuery {
  @IsOptional() @IsCalendarDate() from?: string;
  @IsOptional() @IsCalendarDate() to?: string;
}

const PAYOUT_STATUSES = ['REQUESTED', 'APPROVED', 'PAID', 'REJECTED'] as const;
const REFUND_STATUSES = ['OPEN', 'UNVERIFIED', 'PENDING', 'PROCESSING', 'COMPLETED', 'DISMISSED'] as const;
const REFUND_KINDS = ['END_CUSTOMER', 'CANCEL', 'RETURN', 'LATE_PAYMENT', 'OVERPAYMENT'] as const;

export class PayoutExportQuery extends ReportRangeQuery {
  @IsOptional() @IsIn(PAYOUT_STATUSES) status?: PayoutStatus;
}

export class RefundExportQuery extends ReportRangeQuery {
  /** OPEN = mọi khoản còn việc (cùng tập với thẻ "Hoàn tiền khách"). */
  @IsOptional() @IsIn(REFUND_STATUSES) status?: 'OPEN' | CustomerRefundStatus;
  @IsOptional() @IsIn(REFUND_KINDS) kind?: CustomerRefundKind;
}

/**
 * Báo cáo và file xuất cho kế toán/marketing (D1-04, D2-02, D1-14). Doanh thu và file tài chính (số tiền, tài khoản ngân hàng,
 * thông tin thuế) chỉ ADMIN và KE_TOAN; marketing chỉ đọc bảng nguồn khách. CSKH/KHO không vào. Đặt ở controller riêng để không
 * đụng AdminController.
 */
@Roles('ADMIN')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    private readonly reports: AdminReportsService,
  ) {}

  /** Doanh thu theo ngày × kênh trong khoảng ngày (tối đa 366 ngày) và các số KPI của khoảng đó. */
  @AllowStaff('KE_TOAN')
  @Get('revenue')
  revenue(@Query() q: ReportRangeQuery) {
    return this.reports.revenueReport(q);
  }

  /** Khách mới theo nguồn chạm đầu × tuần: đơn đầu, đơn hai trong 30 ngày, doanh thu (tối đa 180 ngày, mặc định 30 ngày). */
  @AllowStaff('MARKETING')
  @Get('sources')
  sources(@Query() q: ReportRangeQuery) {
    return this.reports.sourceReport(q);
  }

  /** CSV theo dòng hàng của đúng tập đơn mà `GET /admin/orders/export` xuất với cùng bộ lọc. */
  @AllowStaff('KE_TOAN')
  @Get('order-items/export')
  async exportOrderItems(@Query() q: ExportOrdersQuery, @Res() res: Response, @CurrentUser('role') role?: string) {
    // Cùng quy ước với GET /admin/orders/export: không phải ADMIN thì tìm SĐT phải gõ đủ số.
    const where = await this.admin.adminOrderWhere(q, { exactPhoneOnly: role !== 'ADMIN' });
    await streamCsv(res, `dong-hang-${vnDateKey()}.csv`, orderItemCsvChunks(this.prisma, where));
  }

  /** Khấu trừ TNCN của CTV theo người nhận, lệnh đã chi trong khoảng ngày chi (tối đa 366 ngày). */
  @AllowStaff('KE_TOAN')
  @Get('exports/tax')
  async exportTax(@Query() q: ReportRangeQuery, @Res() res: Response) {
    const range = resolveReportRange(q.from, q.to, { maxDays: EXPORT_MAX_DAYS });
    await streamCsv(res, `thue-tncn-ctv-${range.from}-${range.to}.csv`, pitCsvChunks(this.prisma, range));
  }

  /** Lệnh rút tiền (hoa hồng CTV và Ví Tubu) theo ngày yêu cầu, lọc trạng thái nếu có. */
  @AllowStaff('KE_TOAN')
  @Get('exports/payouts')
  async exportPayouts(@Query() q: PayoutExportQuery, @Res() res: Response) {
    const range = resolveReportRange(q.from, q.to, { maxDays: EXPORT_MAX_DAYS });
    await streamCsv(res, `lenh-rut-tien-${range.from}-${range.to}.csv`, payoutCsvChunks(this.prisma, payoutExportWhere(range, q.status)));
  }

  /** Khoản hoàn tiền khách theo ngày tạo khoản hoàn, lọc trạng thái/loại nếu có. */
  @AllowStaff('KE_TOAN')
  @Get('exports/refunds')
  async exportRefunds(@Query() q: RefundExportQuery, @Res() res: Response, @CurrentUser() viewer: JwtPayload) {
    const range = resolveReportRange(q.from, q.to, { maxDays: EXPORT_MAX_DAYS });
    await streamCsv(res, `hoan-tien-khach-${range.from}-${range.to}.csv`, refundCsvChunks(this.prisma, refundExportWhere(range, q.status, q.kind), { maskPhones: !seesFullOrderPhones(viewer) }));
  }
}
