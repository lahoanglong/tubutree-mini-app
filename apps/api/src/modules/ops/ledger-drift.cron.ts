import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CRON_TZ } from '../../common/cron-tz';
import { formatPoints } from '../../common/format-points';
import { formatVndText } from '../../common/format-vnd';
import { notifyAdmins } from '../../common/notify-admins';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { diffPointsBalances, findPointsLotDrift } from '../loyalty/points-reconcile';
import { findWalletLedgerDrift } from '../wallet/wallet-reconcile';
import { findLinkStatsDrift } from '../affiliate/affiliate-link-ledger.service';
import { LINK_RECOMPUTE_HINT } from '../affiliate/affiliate-link-stats';
import { commissionHoldDays, countGuestCommissionsAwaitingPayment } from '../affiliate/guest-commission-settlement';
import { OPS_NOTICE_MAX, OPS_WHERE, opsAlertLine } from './ops-alert-line';

const LEDGER_TITLE = 'Sổ cái lệch số dư';
/** Tiêu đề khi chỉ có số liệu CTV cần xem (số link, hoa hồng đơn khách chưa thu tiền): không phải lệch tiền trong Ví hay điểm. */
const CTV_TITLE = 'Đối soát CTV';
const DAY_MS = 864e5;

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
    @Optional() private readonly config?: SystemConfigService,
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

  private async guestCommissionsAwaitingPayment(): Promise<{ count: number; holdDays: number }> {
    const holdDays = await commissionHoldDays(this.config);
    const count = await countGuestCommissionsAwaitingPayment(this.prisma, new Date(Date.now() - holdDays * DAY_MS));
    return { count, holdDays };
  }

  private async check(): Promise<void> {
    // Lỗi đọc số link CTV (chỉ là số liệu hiển thị) không được chặn báo lệch sổ điểm/Ví.
    const links = findLinkStatsDrift(this.prisma).catch((e: unknown) => {
      this.logger.warn(`Kiểm lệch số link CTV lỗi: ${e instanceof Error ? e.message : e}`);
      return [];
    });
    const awaiting = this.guestCommissionsAwaitingPayment().catch((e: unknown) => {
      this.logger.warn(`Đếm hoa hồng đơn khách chưa thu tiền lỗi: ${e instanceof Error ? e.message : e}`);
      return { count: 0, holdDays: 0 };
    });
    const [pointsRows, wallet, linkDrift, guestAwaiting] = await Promise.all([
      findPointsLotDrift(this.prisma),
      findWalletLedgerDrift(this.prisma),
      links,
      awaiting,
    ]);
    const points = diffPointsBalances(pointsRows);
    const pointsUsers = new Set(points.corrections.map((c) => c.userId)).size;
    const parts: string[] = [];

    if (pointsUsers > 0) {
      const line = `Điểm Xanh: ${pointsUsers} khách lệch số dư so với sổ điểm (tổng lệch ${formatPoints(points.totalAbsDrift)} điểm).`;
      this.logger.error(`Lệch sổ cái. ${line} Chạy pnpm --filter @tubutree/api reconcile:points để xem chi tiết.`);
      parts.push(`Điểm Xanh ${pointsUsers} khách (${formatPoints(points.totalAbsDrift)} điểm)`);
    }
    if (wallet.affectedCount > 0) {
      const line = `Ví Tubu: ${wallet.affectedCount} khách lệch số dư so với sổ ví (tổng lệch ${formatVndText(wallet.totalAbsDrift)}).`;
      this.logger.error(`Lệch sổ cái. ${line} Chạy pnpm --filter @tubutree/api reconcile:wallet để xem chi tiết; Ví không tự sửa.`);
      parts.push(`Ví Tubu ${wallet.affectedCount} khách (${formatVndText(wallet.totalAbsDrift)})`);
    }
    // Số đơn/doanh số link CTV (affiliate_links) lệch sổ hoa hồng hoặc chạm trần int4: chỉ là số liệu hiển thị, không phải tiền, nên log warn.
    const linkFix = linkDrift.filter((d) => d.changed).length;
    const linkCap = linkDrift.filter((d) => d.saturated).length;
    if (linkFix > 0 || linkCap > 0) {
      const detail = [linkFix > 0 ? `${linkFix} link lệch số đơn/doanh số` : '', linkCap > 0 ? `${linkCap} link chạm trần int4` : ''].filter(Boolean).join(', ');
      this.logger.warn(`Link CTV: ${detail} so với sổ hoa hồng. Tính lại: ${LINK_RECOMPUTE_HINT}.`);
      parts.push(`Link CTV ${detail}`);
    }
    // Hoa hồng đơn khách vãng lai đã giao, quá hạn giữ mà đơn chưa thu tiền: không tự chốt (guest-commission-settlement.ts), CTV chỉ thấy
    // "Chốt sau khi đơn thanh toán xong". Admin đối soát tiền đơn hoặc huỷ hoa hồng.
    if (guestAwaiting.count > 0) {
      this.logger.warn(
        `Hoa hồng CTV: ${guestAwaiting.count} khoản của đơn khách đã giao, quá ${guestAwaiting.holdDays} ngày giữ mà đơn chưa thu tiền nên chưa chốt. Đối soát tiền đơn hoặc huỷ hoa hồng.`,
      );
      parts.push(`Hoa hồng CTV ${guestAwaiting.count} khoản đơn khách đã giao mà chưa thu tiền`);
    }
    if (parts.length === 0) return;
    const moneyDrift = pointsUsers > 0 || wallet.affectedCount > 0;
    const title = moneyDrift ? LEDGER_TITLE : CTV_TITLE;
    // Admin đọc tin trong app, không chạy được lệnh dev: tên lệnh chỉ nằm ở log lỗi cho người trực.
    const summary = opsAlertLine({
      name: moneyDrift ? 'Sổ điểm/Ví lệch số dư' : 'Số liệu CTV cần đối soát',
      detail: parts.join('; '),
      where: `${OPS_WHERE.tech} đối soát${wallet.affectedCount > 0 ? ', Ví không tự sửa' : ''}`,
      max: OPS_NOTICE_MAX - title.length - 2,
    });

    await notifyAdmins(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      { template: 'OPS_HEALTH_ALERT', subject: moneyDrift ? 'lệch sổ điểm/Ví' : 'đối soát CTV', data: () => ({ title, summary }) },
    ).catch((e: unknown) => this.logger.warn(`Báo admin lệch sổ lỗi: ${e instanceof Error ? e.message : e}`));
  }
}
