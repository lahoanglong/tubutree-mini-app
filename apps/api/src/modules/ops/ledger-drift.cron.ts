import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CRON_TZ } from '../../common/cron-tz';
import { formatPoints } from '../../common/format-points';
import { formatVndText } from '../../common/format-vnd';
import { notifyAdmins } from '../../common/notify-admins';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';
import { NotificationsService } from '../notifications/notifications.service';
import { diffPointsBalances, findPointsLotDrift } from '../loyalty/points-reconcile';
import { findWalletLedgerDrift } from '../wallet/wallet-reconcile';

/**
 * Mỗi đêm so số dư Điểm Xanh (từng lô) và Ví Tubu của mọi khách với sổ cái của chúng. Chỉ ĐỌC và báo: lệch điểm sửa bằng
 * `reconcile:points`, lệch Ví phải tra nguyên nhân rồi ghi dòng ADJUST (đặt thẳng số dư = tổng sổ có thể xoá tiền của khách).
 *
 * Log chỉ ghi SỐ khách lệch, không id hay số dư riêng của ai; danh sách chi tiết lấy bằng lệnh reconcile.
 */
@Injectable()
export class LedgerDriftCron {
  private readonly logger = new Logger(LedgerDriftCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // 04:30 giờ VN: sau cron hết hạn điểm (01:00), tính hạng (03:15) và hoàn tất đơn ban đêm, trước giờ khách vào app.
  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 30 4 * * *', { name: 'ops.ledger-drift', timeZone: CRON_TZ })
  @TrackCron()
  async handleCron(): Promise<void> {
    if (this.running) {
      markCronSkipped('RUNNING');
      return;
    }
    this.running = true;
    try {
      await this.check();
    } catch (err) {
      this.logger.error(`Kiểm lệch sổ điểm/Ví lỗi: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.running = false;
    }
  }

  private async check(): Promise<void> {
    const [pointsRows, wallet] = await Promise.all([findPointsLotDrift(this.prisma), findWalletLedgerDrift(this.prisma)]);
    const points = diffPointsBalances(pointsRows);
    const pointsUsers = new Set(points.corrections.map((c) => c.userId)).size;
    const adminParts: string[] = [];

    if (pointsUsers > 0) {
      const line = `Điểm Xanh: ${pointsUsers} khách lệch số dư so với sổ điểm (tổng lệch ${formatPoints(points.totalAbsDrift)} điểm).`;
      this.logger.error(`Lệch sổ cái. ${line} Chạy pnpm --filter @tubutree/api reconcile:points để xem chi tiết.`);
      adminParts.push(line);
    }
    if (wallet.affectedCount > 0) {
      const line = `Ví Tubu: ${wallet.affectedCount} khách lệch số dư so với sổ ví (tổng lệch ${formatVndText(wallet.totalAbsDrift)}).`;
      this.logger.error(`Lệch sổ cái. ${line} Chạy pnpm --filter @tubutree/api reconcile:wallet để xem chi tiết; Ví không tự sửa.`);
      adminParts.push(line);
    }
    if (adminParts.length === 0) return;
    // Admin đọc tin trong app, không chạy được lệnh dev: tên lệnh chỉ nằm ở log lỗi cho người trực.
    const summary = `${adminParts.join(' ')} Báo đội kỹ thuật đối soát${wallet.affectedCount > 0 ? '; Ví không tự sửa' : ''}.`;

    await notifyAdmins(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      { template: 'OPS_HEALTH_ALERT', subject: 'lệch sổ điểm/Ví', data: () => ({ title: 'Sổ cái lệch số dư', summary }) },
    ).catch((e: unknown) => this.logger.warn(`Báo admin lệch sổ lỗi: ${e instanceof Error ? e.message : e}`));
  }
}
