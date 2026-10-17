import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { vnDateKey } from '../../common/vn-time';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminService } from './admin.service';
import { ExportOrdersQuery } from './admin.controller';
import { orderItemCsvChunks } from './admin-order-items-export';
import { streamCsv } from './admin-export';

/**
 * Báo cáo và file xuất cho kế toán/marketing (D1-04, D2-02, D1-14). Chỉ ADMIN (không @AllowStaff): số tiền, tài khoản ngân hàng
 * và thông tin thuế không dành cho nhân viên CSKH/KHO. Đặt ở controller riêng để không đụng AdminController.
 */
@Roles('ADMIN')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
  ) {}

  /** CSV theo dòng hàng của đúng tập đơn mà `GET /admin/orders/export` xuất với cùng bộ lọc. */
  @Get('order-items/export')
  async exportOrderItems(@Query() q: ExportOrdersQuery, @Res() res: Response) {
    await streamCsv(res, `dong-hang-${vnDateKey()}.csv`, orderItemCsvChunks(this.prisma, await this.admin.adminOrderWhere(q)));
  }
}
