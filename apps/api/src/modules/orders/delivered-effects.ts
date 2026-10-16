import type { Prisma } from '@prisma/client';

/** Đường chính chạy việc sau giao ngay trong request lật DELIVERED; trước mốc này cron không đụng để không chạy chồng lên nó. */
export const DELIVERED_EFFECTS_GRACE_MINUTES = 10;
/** Cron chỉ tự sửa đơn giao trong chừng này ngày; cũ hơn mà vẫn chưa xong thì để người xử lý (Sức khoẻ hệ thống vẫn đếm). */
export const DELIVERED_EFFECTS_WINDOW_DAYS = 14;

/** Đơn đã giao quá thời gian chờ mà chưa có mốc xong việc sau giao (cộng điểm, khoá hoa hồng, thưởng giới thiệu). */
export function deliveredEffectsPendingWhere(now: Date): Prisma.OrderWhereInput {
  return {
    status: 'DELIVERED',
    deliveredEffectsAt: null,
    deliveredAt: { lt: new Date(now.getTime() - DELIVERED_EFFECTS_GRACE_MINUTES * 60_000) },
  };
}

/** Phần cron tự sửa: như trên, giới hạn trong cửa sổ ngày. */
export function deliveredEffectsResyncWhere(now: Date): Prisma.OrderWhereInput {
  return {
    status: 'DELIVERED',
    deliveredEffectsAt: null,
    deliveredAt: {
      lt: new Date(now.getTime() - DELIVERED_EFFECTS_GRACE_MINUTES * 60_000),
      gte: new Date(now.getTime() - DELIVERED_EFFECTS_WINDOW_DAYS * 86_400_000),
    },
  };
}
