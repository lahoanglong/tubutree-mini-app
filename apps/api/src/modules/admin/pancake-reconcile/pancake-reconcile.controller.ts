import { Controller, Get, Optional, Query, Res } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AllowStaff } from '../../../common/staff-permissions';
import { formatVnDateTime } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { streamCsv } from '../admin-export';
import { AdminService } from '../admin.service';
import {
  RECONCILE_DRIFT_DEFAULT,
  RECONCILE_DRIFT_MAX,
  RECONCILE_FLAGS,
  RECONCILE_SEARCH_MAX,
  RECONCILE_VARIATION_SELECT,
  buildReport,
  flaggedRows,
  type ReconcileFlag,
  type ReconcileReport,
} from './pancake-reconcile';
import { reconcileCsvChunks } from './pancake-reconcile-csv';

export class PancakeReconcileQuery {
  /** Báo lệch khi |tồn cửa hàng − tồn tính từ Pancake| lớn hơn số này. Màn chọn từ vài mốc có sẵn. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Ngưỡng lệch phải là số nguyên.' })
  @Min(0, { message: 'Ngưỡng lệch không được âm.' })
  @Max(RECONCILE_DRIFT_MAX, { message: `Ngưỡng lệch tối đa ${RECONCILE_DRIFT_MAX}.` })
  minDrift?: number;

  /** Tìm theo SKU, tên sản phẩm hoặc tên biến thể (không phân biệt dấu). Lọc ở API để tìm được cả dòng nằm ngoài phần bảng hiện. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Từ khoá phải là chữ.' })
  @MaxLength(RECONCILE_SEARCH_MAX, { message: `Từ khoá tối đa ${RECONCILE_SEARCH_MAX} ký tự.` })
  q?: string;
}

export class PancakeReconcileExportQuery extends PancakeReconcileQuery {
  /** Chỉ xuất các dòng mang cờ này (chip đang chọn trên màn); bỏ trống = mọi dòng có cờ. */
  @IsOptional()
  @IsIn(RECONCILE_FLAGS, { message: 'Loại lệch không hợp lệ.' })
  flag?: ReconcileFlag;
}

/** "HH:mm dd/MM/yyyy" giờ VN → "yyyyMMdd-HHmm" cho tên file. */
export function reconcileFileStamp(now: Date): string {
  const [hm = '', dmy = ''] = formatVnDateTime(now).split(' ');
  const [d, m, y] = dmy.split('/');
  return `${y}${m}${d}-${hm.replace(':', '')}`;
}

/**
 * Bàn đối soát tồn kho Pancake (`/admin/doi-soat-kho`): so tồn bán được của từng biến thể kho Tubu với số Pancake báo ở lần đồng bộ gần nhất.
 * Chỉ đọc: không gọi Pancake, không sửa tồn, không trả khoá hay cấu hình tích hợp nào. ADMIN và nhân viên KHO (người kiểm kho thật).
 */
@Roles('ADMIN')
@Controller('admin/pancake-reconcile')
export class PancakeReconcileController {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly admin?: AdminService,
  ) {}

  /** Biến thể đang bán của hàng kho Tubu giao (gồm hàng đối tác "Tubu giao hộ"). Hàng đối tác tự giao không có trên Pancake. */
  private variations() {
    return this.prisma.variation.findMany({
      where: { isActive: true, product: { fulfilment: 'TUBU' } },
      select: RECONCILE_VARIATION_SELECT,
      orderBy: { sku: 'asc' },
    });
  }

  @AllowStaff('KHO')
  @Get()
  async report(@Query() q: PancakeReconcileQuery): Promise<ReconcileReport> {
    return buildReport(await this.variations(), q.minDrift ?? RECONCILE_DRIFT_DEFAULT, new Date(), undefined, q.q ?? '');
  }

  /**
   * File CSV (BOM UTF-8) của MỌI dòng có cờ khớp bộ lọc, không cắt ở trần dòng của bảng, kèm cột "Cách xử lý" theo cờ để đi đếm kho.
   * Cùng quyền với bảng (ADMIN, KHO); không có cột mã Pancake hay cấu hình tích hợp nào. Mỗi lần xuất ghi nhật ký xuất file.
   */
  @AllowStaff('KHO')
  @Get('export')
  async export(@Query() q: PancakeReconcileExportQuery, @Res() res: Response, @CurrentUser('sub') actorId?: string) {
    const minDrift = q.minDrift ?? RECONCILE_DRIFT_DEFAULT;
    const { issues } = flaggedRows(await this.variations(), minDrift, q.q ?? '');
    const rows = q.flag ? issues.filter((r) => r.flags.includes(q.flag!)) : issues;
    await streamCsv(res, `doi-soat-ton-pancake-${reconcileFileStamp(new Date())}.csv`, reconcileCsvChunks(rows), (n) =>
      this.admin?.recordExport(actorId ?? '', 'pancake-reconcile/export', { minDrift, q: q.q, flag: q.flag }, n),
    );
  }
}
