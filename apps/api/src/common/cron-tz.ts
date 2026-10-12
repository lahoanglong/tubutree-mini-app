/**
 * Múi giờ chuẩn cho mọi @Cron. Container không đặt TZ nên nếu thiếu `timeZone`, cron chạy theo UTC
 * (vd '0 3 * * *' thành 10:00 giờ VN). Test tĩnh cron-timezone.spec.ts bắt buộc mọi @Cron có timeZone.
 */
export const CRON_TZ = 'Asia/Ho_Chi_Minh';
