import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

/** Phần của NotificationsService mà helper cần (khai báo cấu trúc để common/ không import ngược module). */
interface AdminNotifier {
  notify(userId: string, templateCode: string, data: Record<string, string>): Promise<void>;
}

export interface NotifyAdminsContext {
  prisma: Pick<PrismaClient, 'user'>;
  /** Có thể thiếu: nhiều test dựng service trực tiếp và NotificationsService là @Optional() ở các service gọi. */
  notifications: AdminNotifier | undefined;
  logger: Pick<Logger, 'warn'>;
}

export interface AdminNotice {
  template: string;
  /** Cụm mô tả sự việc, dùng trong log cảnh báo ("đại lý X đã chuyển khoản"). */
  subject: string;
  /** Chạy song song với truy vấn admin; chỉ dùng khi có admin để báo. */
  data: () => Promise<Record<string, string>> | Record<string, string>;
}

/** Số admin tối đa được báo một lần, đủ cho vận hành mà không quét cả bảng user. */
const MAX_ADMINS = 20;

/**
 * Báo mọi tài khoản ADMIN chưa bị khoá về một sự việc cần xử lý. Best-effort: thiếu wiring, không có
 * admin hay một admin lỗi chỉ ghi cảnh báo, không chặn việc đã ghi nhận của khách. Lỗi truy vấn
 * (admin, data) thì ném ra để nơi gọi tự bắt và ghi log theo ngữ cảnh của mình.
 */
export async function notifyAdmins(ctx: NotifyAdminsContext, notice: AdminNotice): Promise<void> {
  const { prisma, notifications, logger } = ctx;
  if (!notifications) {
    logger.warn(`NotificationsService chưa wiring — không báo được admin ${notice.subject}.`);
    return;
  }
  const [admins, data] = await Promise.all([
    prisma.user.findMany({ where: { role: 'ADMIN', isBlocked: false }, select: { id: true }, take: MAX_ADMINS }),
    (async () => notice.data())(),
  ]);
  if (admins.length === 0) {
    logger.warn(`Không có tài khoản ADMIN nào để báo ${notice.subject}.`);
    return;
  }
  const results = await Promise.allSettled(admins.map((a) => notifications.notify(a.id, notice.template, data)));
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) logger.warn(`Báo admin ${notice.subject}: lỗi ${failed}/${admins.length}.`);
}
