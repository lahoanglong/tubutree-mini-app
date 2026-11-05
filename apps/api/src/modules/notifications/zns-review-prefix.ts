/**
 * Tiền tố cột `error` của log ZNS đã được cron quét log kẹt xét và để lại chờ đối soát tay: cron bỏ qua log có tiền tố này ở các lượt sau,
 * còn go-live:check đếm chúng. Tách file nhỏ để config/go-live dùng được mà không kéo cả NotificationsService.
 */
export const ZNS_REVIEW_PREFIX = 'Chờ đối soát tay: ';
