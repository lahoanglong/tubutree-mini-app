import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { LaunchWatchService } from './launch-watch.service';
import { PurchaseFunnelService } from './purchase-funnel.service';

@Roles('ADMIN')
@Controller('admin/analytics')
export class AnalyticsAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly launchWatch: LaunchWatchService,
    private readonly purchaseFunnel: PurchaseFunnelService,
  ) {}

  /** Chỉ số tổng hợp (không có thông tin cá nhân) để theo dõi tuần đầu sau launch: phễu Đổi rác, chống gian lận, đơn thứ hai. */
  @Get('launch-watch')
  launchWatchSnapshot() {
    return this.launchWatch.getSnapshot();
  }

  /** Phễu mua theo phiên (web và Mini App) cho 72 giờ / 7 ngày / 30 ngày: chỉ số đếm, không có định danh khách. */
  @Get('purchase-funnel')
  purchaseFunnelSnapshot() {
    return this.purchaseFunnel.getSnapshot();
  }

  @Get('retention-daily')
  async retentionDaily(@Query('days') days = '30') {
    const n = Math.min(90, Math.max(1, Number(days) || 30));
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - n);
    const rows = await this.prisma.retentionDailySnapshot.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'asc' },
    });
    // Prisma Decimal (decimal.js) serialize qua JSON.stringify ra STRING (toJSON = valueOf trả
    // string), không phải number — trả thẳng rows thì FE gọi `.toFixed()` trên chuỗi sẽ crash.
    // Ép về number ở đây để khớp interface RetentionDailyRow (ordersPerBuyerMtd: number) bên FE.
    return rows.map((r) => ({ ...r, ordersPerBuyerMtd: Number(r.ordersPerBuyerMtd) }));
  }
}
