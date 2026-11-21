import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AllowStaff } from '../../../common/staff-permissions';
import { PrismaService } from '../../../prisma/prisma.service';
import { RECONCILE_DRIFT_DEFAULT, RECONCILE_DRIFT_MAX, RECONCILE_VARIATION_SELECT, buildReport, type ReconcileReport } from './pancake-reconcile';

export class PancakeReconcileQuery {
  /** Báo lệch khi |tồn cửa hàng − tồn tính từ Pancake| lớn hơn số này. Màn chọn từ vài mốc có sẵn. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Ngưỡng lệch phải là số nguyên.' })
  @Min(0, { message: 'Ngưỡng lệch không được âm.' })
  @Max(RECONCILE_DRIFT_MAX, { message: `Ngưỡng lệch tối đa ${RECONCILE_DRIFT_MAX}.` })
  minDrift?: number;
}

/**
 * Bàn đối soát tồn kho Pancake (`/admin/doi-soat-kho`): so tồn bán được của từng biến thể kho Tubu với số Pancake báo ở lần đồng bộ gần nhất.
 * Chỉ đọc: không gọi Pancake, không sửa tồn, không trả khoá hay cấu hình tích hợp nào. ADMIN và nhân viên KHO (người kiểm kho thật).
 */
@Roles('ADMIN')
@Controller('admin/pancake-reconcile')
export class PancakeReconcileController {
  constructor(private readonly prisma: PrismaService) {}

  @AllowStaff('KHO')
  @Get()
  async report(@Query() q: PancakeReconcileQuery): Promise<ReconcileReport> {
    // Biến thể đang bán của hàng kho Tubu giao (gồm hàng đối tác "Tubu giao hộ"). Hàng đối tác tự giao không có trên Pancake.
    const variations = await this.prisma.variation.findMany({
      where: { isActive: true, product: { fulfilment: 'TUBU' } },
      select: RECONCILE_VARIATION_SELECT,
      orderBy: { sku: 'asc' },
    });
    return buildReport(variations, q.minDrift ?? RECONCILE_DRIFT_DEFAULT, new Date());
  }
}
