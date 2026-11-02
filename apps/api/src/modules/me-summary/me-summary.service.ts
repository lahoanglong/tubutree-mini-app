import { Injectable } from '@nestjs/common';
import type { MeSummaryDTO } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { unreadInappWhere } from '../notifications/notification-feed.service';
import { ACTIVE_ORDER_STATUSES } from '../orders/order-status-groups';
import { orderCountsFromRows } from '../orders/order-counts.service';

/** Gói định kỳ khách còn giữ: khớp bộ đếm "Định kỳ" ở trang Cá nhân (ACTIVE, PAUSED). */
const OPEN_SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED'];

/**
 * Các số chỉ để hiện ở Cá nhân và thanh đáy, đọc song song bằng ba câu đếm theo `userId`. Một câu lỗi thì cả lời gọi lỗi:
 * trả 0 thay số thật sẽ làm huy hiệu và số đơn nói sai.
 */
@Injectable()
export class MeSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<MeSummaryDTO> {
    const [orderRows, unreadNotifications, activeSubscriptions] = await Promise.all([
      this.prisma.order.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
      this.prisma.notificationLog.count({ where: unreadInappWhere(userId) }),
      this.prisma.subscription.count({ where: { userId, status: { in: OPEN_SUBSCRIPTION_STATUSES } } }),
    ]);
    const active = orderRows.filter((r) => (ACTIVE_ORDER_STATUSES as readonly string[]).includes(r.status)).reduce((n, r) => n + r._count._all, 0);
    return { orders: { ...orderCountsFromRows(orderRows), active }, unreadNotifications, activeSubscriptions };
  }
}
