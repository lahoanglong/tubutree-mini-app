import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

/** Template in-app gửi admin (seed: nt-ops-gomdon). */
export const GOMDON_ALERT_TEMPLATE = 'OPS_GOMDON_ALERT';
/** Cùng kênh, lời tin cho việc phía Pancake (seed: nt-ops-pancake) — "Vận đơn thu gom" sai ngữ cảnh với đơn thường. */
export const PANCAKE_ALERT_TEMPLATE = 'OPS_PANCAKE_ALERT';
const MAX_RECIPIENTS = 20;

/**
 * Nhóm việc của báo động mà hệ thống tự đóng được khi chính nó xử lý xong — để hàng đợi "Cần xử lý thu gom" không
 * giữ những ô đỏ đã hết hiệu lực (R2-GOMDON-3). Báo động không có nhóm chỉ người đóng.
 */
export const GOMDON_ALERT_KIND = {
  /** Chưa có vận đơn sống: cần tạo tay / kiểm tra Gomdon. Đóng khi hệ thống gắn được vận đơn. */
  WAYBILL_NEEDED: 'WAYBILL_NEEDED',
  /** Đơn Pancake chưa mang mã vận đơn Gomdon: cần ghi tay. Đóng khi hệ thống ghi được mã vào Pancake. */
  WAYBILL_NOTE: 'WAYBILL_NOTE',
  /** Đơn đã huỷ còn vận đơn có thể sống: cần huỷ tay. Đóng khi hệ thống huỷ được vận đơn. */
  CANCEL_NEEDED: 'CANCEL_NEEDED',
} as const;
export type GomdonAlertKind = (typeof GOMDON_ALERT_KIND)[keyof typeof GOMDON_ALERT_KIND];

/**
 * Báo vận hành/CSKH khi vận đơn thu gom cần người xử lý (tạo lỗi, không rõ đã tạo chưa, Gomdon huỷ/
 * hoàn/giao thất bại, huỷ vận đơn không được, giao trùng vận đơn...). Kênh:
 *  - log error (luôn có);
 *  - bảng gomdon_alerts gắn đơn: web admin hiện báo động ở chi tiết đơn và giữ đơn trong hàng đợi "Cần xử lý
 *    thu gom" tới khi có người đánh dấu đã xử lý (admin-order-filter.ts). Trước đây chỉ có thông báo in-app trên
 *    mini app — web admin không thấy, và đơn giao trùng vận đơn còn rơi khỏi hàng đợi;
 *  - thông báo in-app tới tài khoản ADMIN qua NotificationsService.
 * Best-effort: lỗi lưu/gửi báo động KHÔNG được làm hỏng luồng nghiệp vụ gọi nó.
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

  async alert(orderCode: string, message: string, template: string = GOMDON_ALERT_TEMPLATE, kind?: GomdonAlertKind): Promise<void> {
    const source = template === PANCAKE_ALERT_TEMPLATE ? 'PANCAKE' : 'GOMDON';
    this.logger.error(`[${source} CẦN XỬ LÝ] Đơn ${orderCode}: ${message}`);
    try {
      const order = await this.prisma.order.findUnique({ where: { code: orderCode }, select: { id: true } });
      if (order) {
        // Cùng nội dung còn mở (job chạy lại, webhook gửi lại, API khởi động lại) → không báo lặp. Khoá theo đơn
        // để hai worker báo cùng lúc không cùng thấy "chưa có" rồi cùng tạo.
        const created = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gomdon-alert:${order.id}`}))`;
          const open = await tx.gomdonAlert.findFirst({
            where: { orderId: order.id, message, resolvedAt: null },
            select: { id: true },
          });
          if (open) return false;
          await tx.gomdonAlert.create({ data: { orderId: order.id, message, ...(kind ? { kind } : {}) } });
          return true;
        });
        if (!created) return;
      }
    } catch (err) {
      this.logger.warn(`Không lưu được báo động Gomdon cho đơn ${orderCode}: ${err instanceof Error ? err.message : err}`);
    }
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
        take: MAX_RECIPIENTS,
      });
      for (const a of admins) {
        await this.notifications
          .notify(a.id, template, { order_code: orderCode, message })
          .catch((err) =>
            this.logger.warn(`Gửi báo động Gomdon tới admin ${a.id} lỗi: ${err instanceof Error ? err.message : err}`),
          );
      }
    } catch (err) {
      this.logger.warn(`Không gửi được báo động Gomdon cho đơn ${orderCode}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Admin đánh dấu một báo động đã xử lý. false = không có / đã được đóng trước đó. */
  async resolve(alertId: string, actorId: string): Promise<boolean> {
    const r = await this.prisma.gomdonAlert.updateMany({
      where: { id: alertId, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: actorId },
    });
    return r.count > 0;
  }

  /** Đóng mọi báo động đang mở của đơn (admin "Đã xử lý tay"). */
  async resolveOpenForOrder(orderId: string, actorId?: string): Promise<number> {
    const r = await this.prisma.gomdonAlert.updateMany({
      where: { orderId, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: actorId ?? null },
    });
    return r.count;
  }

  /** Hệ thống tự xử lý xong một nhóm việc → đóng báo động đang mở thuộc nhóm đó (người đóng = hệ thống). */
  async resolveKinds(orderId: string, kinds: readonly GomdonAlertKind[]): Promise<number> {
    const r = await this.prisma.gomdonAlert.updateMany({
      where: { orderId, resolvedAt: null, kind: { in: [...kinds] } },
      data: { resolvedAt: new Date(), resolvedById: null },
    });
    return r.count;
  }
}
