import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Số tin mỗi lần gọi khi client không nói; cũng là trần, khớp `listForUser` cũ để client cũ nhận đúng 50 tin. */
export const NOTIFICATION_PAGE_MAX = 50;

export interface NotificationFeedQuery {
  /** `sentAt` (ISO) của tin cuối trang trước: chỉ lấy tin cũ hơn mốc này. */
  before?: string;
  /** `id` của tin cuối trang trước, để các tin cùng `sentAt` không bị trùng hoặc sót khi nằm vắt qua ranh giới trang. */
  beforeId?: string;
  limit?: number;
}

/**
 * Hộp thư trong app: phân trang theo con trỏ và đếm chưa đọc. Cùng bộ lọc với `markAllRead` (tin INAPP của chính khách)
 * nên số "chưa đọc" khớp đúng những tin nút "Đọc tất cả" sẽ chạm.
 */
@Injectable()
export class NotificationFeedService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mảng tin mới nhất trước, sắp `(sentAt desc, id desc)`. `sentAt` là TIMESTAMP(3) nên mốc ISO của client khớp từng mili giây. */
  list(userId: string, q: NotificationFeedQuery) {
    const take = Math.min(Math.max(q.limit ?? NOTIFICATION_PAGE_MAX, 1), NOTIFICATION_PAGE_MAX);
    const before = q.before ? new Date(q.before) : null;
    const cursor = !before
      ? {}
      : q.beforeId
      ? { OR: [{ sentAt: { lt: before } }, { sentAt: before, id: { lt: q.beforeId } }] }
      : { sentAt: { lt: before } };
    return this.prisma.notificationLog.findMany({
      where: { userId, channel: 'INAPP', ...cursor },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notificationLog.count({ where: { userId, channel: 'INAPP', status: { not: 'READ' } } });
    return { count };
  }
}
