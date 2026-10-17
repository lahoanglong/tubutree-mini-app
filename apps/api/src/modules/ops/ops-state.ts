import type { PrismaClient } from '@prisma/client';
import type { SmtpFailureKind } from './ops-email-error';

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
/** Lỗi vĩnh viễn gần nhất (AUTH/PERMANENT) và dấu vân tay cấu hình lúc đó: cái duy nhất `blockLifted()` so với cấu hình hiện tại. */
export const EMAIL_BLOCK_KEY = 'alert.email.block';

/** Lỗi gửi kèm loại (xem ops-email-error.ts) và dấu vân tay cấu hình lúc lỗi; thiếu `kind` = không phải lỗi SMTP (cấu hình dở dang). */
export type EmailDeliveryResult =
  | { ok: true }
  | { ok: false; error: string; kind?: SmtpFailureKind; fingerprint?: string };

/**
 * Lần gửi email báo động gần nhất (thành công hoặc lỗi). Tách khỏi hàng `alert` (trí nhớ chống báo lặp, ghi đè cả cụm
 * mỗi lượt cron) để lỗi SMTP không phụ thuộc việc lượt cron có lưu được hay không; lỗi cũ không bị xoá khi gửi được lại —
 * màn hình so lastErrorAt với lastOkAt. `detail` của lỗi giữ loại lỗi để màn hình chỉ cách sửa.
 *
 * Lỗi vĩnh viễn còn được ghi riêng ở hàng `alert.email.block` (loại + dấu vân tay + giờ). Hàng đó chỉ ghi khi lỗi là
 * AUTH/PERMANENT, nên một lần gửi thử lỗi tạm thời (mạng, 4xx) dưới cấu hình mới không ghi đè được lý do cron đang chặn,
 * và hai lần ghi chạy song song (cron với nút "Gửi email thử") không giẫm lên nhau.
 */
export async function recordEmailDelivery(prisma: Pick<PrismaClient, 'opsHealthState'>, run: EmailDeliveryResult, now = new Date()) {
  if (!run.ok && (run.kind === 'AUTH' || run.kind === 'PERMANENT')) {
    const block = { lastErrorAt: now, lastError: run.error.slice(0, 500), detail: { kind: run.kind, fingerprint: run.fingerprint ?? null } };
    await prisma.opsHealthState.upsert({ where: { key: EMAIL_BLOCK_KEY }, create: { key: EMAIL_BLOCK_KEY, ...block }, update: block });
  }
  const data = run.ok
    ? { lastOkAt: now }
    : { lastErrorAt: now, lastError: run.error.slice(0, 500), detail: { kind: run.kind ?? null, fingerprint: run.fingerprint ?? null } };
  await prisma.opsHealthState.upsert({ where: { key: EMAIL_STATE_KEY }, create: { key: EMAIL_STATE_KEY, ...data }, update: data });
}

export const WEBHOOK_STATE_KEY = 'alert.webhook';

/** PERMANENT: hook từ chối hẳn (4xx trừ 408/429) nên không gửi lại; TRANSIENT: mạng, quá hạn, 408/429, 5xx — lượt kiểm sau gửi lại. */
export type WebhookFailureKind = 'PERMANENT' | 'TRANSIENT';
export type WebhookDeliveryResult = { ok: true } | { ok: false; error: string; kind: WebhookFailureKind };

/** Lần gửi webhook báo động gần nhất (thành công hoặc lỗi), cùng cách ghi với email: lỗi cũ giữ nguyên khi gửi được lại, màn hình so lastErrorAt với lastOkAt. */
export async function recordWebhookDelivery(prisma: Pick<PrismaClient, 'opsHealthState'>, run: WebhookDeliveryResult, now = new Date()) {
  const data = run.ok ? { lastOkAt: now } : { lastErrorAt: now, lastError: run.error.slice(0, 500), detail: { kind: run.kind } };
  await prisma.opsHealthState.upsert({ where: { key: WEBHOOK_STATE_KEY }, create: { key: WEBHOOK_STATE_KEY, ...data }, update: data });
}
