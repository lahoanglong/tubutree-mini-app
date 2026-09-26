import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

/** Template in-app gửi admin (seed: nt-ops-gomdon). */
export const GOMDON_ALERT_TEMPLATE = 'OPS_GOMDON_ALERT';
const MAX_RECIPIENTS = 20;

/**
 * Báo vận hành/CSKH khi vận đơn thu gom cần người xử lý (tạo lỗi, không rõ đã tạo chưa, Gomdon huỷ/
 * hoàn/giao thất bại, huỷ vận đơn không được...). Kênh: log error (luôn có) + thông báo in-app tới
 * tài khoản ADMIN qua NotificationsService (cùng cơ chế thông báo đang dùng). Best-effort: lỗi gửi
 * báo động KHÔNG được làm hỏng luồng nghiệp vụ gọi nó.
 *
 * KHÔNG tự hoàn tiền / tự huỷ đơn ở đây — chỉ báo để người quyết định.
 */
@Injectable()
export class GomdonAlertService {
  private readonly logger = new Logger(GomdonAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async alert(orderCode: string, message: string): Promise<void> {
    this.logger.error(`[GOMDON CẦN XỬ LÝ] Đơn ${orderCode}: ${message}`);
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
        take: MAX_RECIPIENTS,
      });
      for (const a of admins) {
        await this.notifications
          .notify(a.id, GOMDON_ALERT_TEMPLATE, { order_code: orderCode, message })
          .catch((err) =>
            this.logger.warn(`Gửi báo động Gomdon tới admin ${a.id} lỗi: ${err instanceof Error ? err.message : err}`),
          );
      }
    } catch (err) {
      this.logger.warn(`Không gửi được báo động Gomdon cho đơn ${orderCode}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
