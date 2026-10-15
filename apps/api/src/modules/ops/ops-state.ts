import type { PrismaClient } from '@prisma/client';

export const CATALOG_STATE_KEY = 'pancake.catalog';

export type CatalogRunResult = { ok: true; count: number; failed?: number } | { ok: false; error: string };

/**
 * Ghi kết quả một lượt đồng bộ danh mục Pancake vào ops_health_states (màn sức khoẻ vận hành đọc). Hàm rời, không qua
 * provider, để PancakeSyncService gọi được mà không kéo OpsModule (vòng phụ thuộc qua GomdonModule → PancakeModule).
 */
export async function recordCatalogRun(prisma: Pick<PrismaClient, 'opsHealthState'>, run: CatalogRunResult, now = new Date()) {
  const data = run.ok
    ? { lastOkAt: now, detail: { count: run.count, failed: run.failed ?? 0 } }
    : { lastErrorAt: now, lastError: run.error.slice(0, 500) };
  await prisma.opsHealthState.upsert({ where: { key: CATALOG_STATE_KEY }, create: { key: CATALOG_STATE_KEY, ...data }, update: data });
}

export const EMAIL_STATE_KEY = 'alert.email';

export type EmailDeliveryResult = { ok: true } | { ok: false; error: string };

/**
 * Lần gửi email báo động gần nhất (thành công hoặc lỗi). Tách khỏi hàng `alert` (trí nhớ chống báo lặp, ghi đè cả cụm
 * mỗi lượt cron) để lỗi SMTP không phụ thuộc việc lượt cron có lưu được hay không; lỗi cũ không bị xoá khi gửi được lại —
 * màn hình so lastErrorAt với lastOkAt.
 */
export async function recordEmailDelivery(prisma: Pick<PrismaClient, 'opsHealthState'>, run: EmailDeliveryResult, now = new Date()) {
  const data = run.ok ? { lastOkAt: now } : { lastErrorAt: now, lastError: run.error.slice(0, 500) };
  await prisma.opsHealthState.upsert({ where: { key: EMAIL_STATE_KEY }, create: { key: EMAIL_STATE_KEY, ...data }, update: data });
}
