import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { streamCsv } from '../admin/admin-export';
import { reconcileFileStamp } from '../admin/pancake-reconcile/pancake-reconcile.controller';
import {
  RESTOCK_SEARCH_MAX,
  RESTOCK_SUPPLIER_MAX,
  RESTOCK_TARGET_DAYS_DEFAULT,
  RESTOCK_TARGET_DAYS_OPTIONS,
  buildRestockPlan,
  comparePurchaseRows,
  plannedRows,
  type RestockPlanReport,
} from './restock-planner';
import { restockPoCsvChunks } from './restock-planner-csv';
import { RestockPlannerService } from './restock-planner.service';

/** Số lần xuất file đặt hàng mỗi phút cho một người: mỗi lần quét mọi biến thể kho Tubu và đơn 14 ngày, không cắt dòng. */
export const RESTOCK_EXPORT_PER_MINUTE = 6;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RestockPlanQuery {
  /** "Nhập đủ bán N ngày": màn chọn từ vài mốc có sẵn. */
  @IsOptional()
  @Type(() => Number)
  @IsIn(RESTOCK_TARGET_DAYS_OPTIONS, { message: `Số ngày phải là một trong ${RESTOCK_TARGET_DAYS_OPTIONS.join(', ')}.` })
  days?: number;

  /** Tìm theo SKU, tên sản phẩm, tên biến thể hoặc nhà cung cấp (không phân biệt dấu). */
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Từ khoá phải là chữ.' })
  @MaxLength(RESTOCK_SEARCH_MAX, { message: `Từ khoá tối đa ${RESTOCK_SEARCH_MAX} ký tự.` })
  q?: string;

  /** Nhà cung cấp (thương hiệu) chọn từ danh sách `suppliers` của báo cáo; bỏ trống = mọi nhà cung cấp. */
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Nhà cung cấp phải là chữ.' })
  @MaxLength(RESTOCK_SUPPLIER_MAX, { message: `Tên nhà cung cấp tối đa ${RESTOCK_SUPPLIER_MAX} ký tự.` })
  brand?: string;
}

/**
 * "Kế hoạch nhập hàng" ở `/admin/doi-soat-kho?tab=nhap-hang`: ghép tồn bán được, tốc độ bán 14 ngày và số khách đang chờ chuông báo hàng về
 * để đề xuất số nên đặt nhà cung cấp, kèm file CSV đặt hàng gom theo nhà cung cấp. Chỉ đọc: không sửa tồn, không tạo đơn nhập.
 * ADMIN và nhân viên KHO (cùng quyền với bàn đối soát tồn).
 */
@Roles('ADMIN')
@Controller('admin/restock-planner')
export class RestockPlannerController {
  private readonly logger = new Logger(RestockPlannerController.name);

  constructor(
    private readonly planner: RestockPlannerService,
    private readonly prisma: PrismaService,
  ) {}

  @AllowStaff('KHO')
  @Get()
  async report(@Query() q: RestockPlanQuery): Promise<RestockPlanReport> {
    const now = new Date();
    return buildRestockPlan(await this.planner.inputs(now), { targetDays: q.days ?? RESTOCK_TARGET_DAYS_DEFAULT, q: q.q, supplier: q.brand }, now);
  }

  /**
   * File CSV (BOM UTF-8) "Đơn đặt hàng nhà cung cấp": MỌI dòng có đề xuất > 0 khớp bộ lọc (không cắt ở trần dòng của bảng), xếp theo nhà
   * cung cấp rồi tên sản phẩm. Mỗi lần xuất ghi nhật ký xuất file như các file quản trị khác.
   */
  @AllowStaff('KHO')
  @Throttle({ default: { ttl: 60_000, limit: RESTOCK_EXPORT_PER_MINUTE } })
  @Get('export')
  async export(@Query() q: RestockPlanQuery, @Res() res: Response, @CurrentUser('sub') actorId?: string) {
    const now = new Date();
    const targetDays = q.days ?? RESTOCK_TARGET_DAYS_DEFAULT;
    const { need } = plannedRows(await this.planner.inputs(now), { targetDays, q: q.q, supplier: q.brand });
    const rows = [...need].sort(comparePurchaseRows);
    await streamCsv(res, `dat-hang-nha-cung-cap-${reconcileFileStamp(now)}.csv`, restockPoCsvChunks(rows), (n) =>
      this.recordExport(actorId ?? '', { days: targetDays, q: q.q, brand: q.brand }, n),
    );
  }

  /** Cùng sổ và cùng dạng với AdminService.recordExport. Gọi sau khi file đã gửi đi nên lỗi chỉ được log, không ném ra. */
  private async recordExport(actorId: string, filters: Record<string, unknown>, rowCount: number): Promise<void> {
    const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    try {
      await this.prisma.adminExportLog.create({ data: { actorId, route: 'restock-planner/export', filters: clean as Prisma.InputJsonObject, rowCount } });
    } catch (err) {
      this.logger.error(`Không ghi được nhật ký xuất restock-planner/export của ${actorId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
