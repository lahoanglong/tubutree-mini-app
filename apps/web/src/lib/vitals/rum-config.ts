/** Cờ đo tốc độ trên máy khách (`perf.rum_enabled`) và tỉ lệ lấy mẫu (`perf.rum_sample_pct`), như `PublicConfig.perfRum`. */
export interface RumConfig {
  enabled: boolean;
  samplePct: number;
}

export const RUM_OFF: RumConfig = { enabled: false, samplePct: 0 };

const BASE = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

/** Chỉ nhận đúng `{ enabled: true, samplePct: 0–100 }`; API cũ, lỗi hay giá trị lạ đều là tắt. */
export function parseRumConfig(json: unknown): RumConfig {
  const rum = (json as { perfRum?: { enabled?: unknown; samplePct?: unknown } } | null)?.perfRum;
  const pct = rum?.samplePct;
  if (rum?.enabled !== true || typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0) return RUM_OFF;
  return { enabled: true, samplePct: Math.min(100, pct) };
}

/**
 * Đọc cờ ở máy chủ lúc dựng trang, cùng URL, cùng hạn 1 giờ và cùng header với `getPublicSupport` của chân trang (layout gốc): Next gộp hai lời
 * gọi làm một, nên không thêm request nào và hạn làm mới của trang không đổi. Cờ tắt thì trình duyệt không nhận mã đo, không gửi gì.
 */
export async function getRumConfig(): Promise<RumConfig> {
  try {
    const token = typeof window === 'undefined' ? process.env.THROTTLE_BYPASS_TOKEN : undefined;
    const next = { revalidate: 3600 };
    const res = await fetch(`${BASE}/config/public`, token ? { next, headers: { 'x-throttle-bypass': token } } : { next });
    if (!res.ok) return RUM_OFF;
    return parseRumConfig(await res.json());
  } catch {
    return RUM_OFF;
  }
}
