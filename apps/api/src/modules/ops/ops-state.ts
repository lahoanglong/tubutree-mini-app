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
