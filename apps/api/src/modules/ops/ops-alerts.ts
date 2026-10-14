/** Ngưỡng báo động sức khoẻ vận hành — SystemConfig `ops.*` (PLATFORM-5). */
export interface OpsThresholds {
  /** Đơn còn ở kho quá số phút này mà chưa lên Pancake = đơn kẹt. */
  unsyncedMinutes: number;
  stuckOrders: number;
  webhookFailed: number;
  queueFailed1h: number;
  repeatHours: number;
}

export const OPS_THRESHOLD_KEYS: Record<keyof OpsThresholds, { key: string; fallback: number }> = {
  unsyncedMinutes: { key: 'ops.alert_unsynced_minutes', fallback: 30 },
  stuckOrders: { key: 'ops.alert_stuck_orders', fallback: 1 },
  webhookFailed: { key: 'ops.alert_webhook_failed', fallback: 1 },
  queueFailed1h: { key: 'ops.alert_queue_failed_1h', fallback: 5 },
  repeatHours: { key: 'ops.alert_repeat_hours', fallback: 6 },
};

export interface CatalogRun {
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

/** Phần của ảnh chụp sức khoẻ mà luật báo động cần. */
export interface ProblemInput {
  pancake: {
    configured: boolean;
    stuck: number;
    webhookFailed24h: number;
    /** Webhook nhận trong 24h mà quá 10 phút vẫn chưa xử lý xong (worker không chạy, Redis mất...). */
    webhookStuck: number;
    catalog: CatalogRun;
  };
  gomdon: { configured: boolean; webhookFailed24h: number; credentialsRejected: boolean };
  queues: { ok: true; items: { name: string; failedLastHour: number }[] } | { ok: false; error: string };
}

export interface OpsProblem {
  key: string;
  message: string;
}

/** Danh sách sự cố đang có, theo thứ tự cố định để so được giữa hai lượt. */
export function opsProblems(s: ProblemInput, t: OpsThresholds): OpsProblem[] {
  const out: OpsProblem[] = [];
  if (s.pancake.configured) {
    if (s.pancake.stuck >= t.stuckOrders) {
      out.push({ key: 'pancake.stuck', message: `${s.pancake.stuck} đơn quá ${t.unsyncedMinutes} phút chưa lên Pancake` });
    }
    const hooks = s.pancake.webhookFailed24h + s.pancake.webhookStuck;
    if (hooks >= t.webhookFailed) {
      out.push({ key: 'pancake.webhook', message: `${hooks} webhook Pancake lỗi hoặc chưa xử lý trong 24 giờ` });
    }
    const c = s.pancake.catalog;
    if (c.lastErrorAt && (!c.lastOkAt || c.lastErrorAt > c.lastOkAt)) {
      out.push({ key: 'pancake.catalog', message: `Đồng bộ danh mục Pancake lỗi: ${c.lastError ?? 'không rõ lỗi'}` });
    }
  }
  if (s.gomdon.configured) {
    if (s.gomdon.webhookFailed24h >= t.webhookFailed) {
      out.push({ key: 'gomdon.webhook', message: `${s.gomdon.webhookFailed24h} webhook Gomdon xử lý lỗi trong 24 giờ` });
    }
    if (s.gomdon.credentialsRejected) {
      out.push({ key: 'gomdon.credentials', message: 'Gomdon từ chối đăng nhập — khách không chọn được thu gom' });
    }
  }
  if (!s.queues.ok) {
    out.push({ key: 'queues.down', message: `Hàng đợi không phản hồi: ${s.queues.error}` });
  } else {
    for (const q of s.queues.items) {
      if (q.failedLastHour >= t.queueFailed1h) {
        out.push({ key: `queue.${q.name}`, message: `Hàng đợi ${q.name}: ${q.failedLastHour} job lỗi trong 1 giờ qua` });
      }
    }
  }
  return out;
}

export interface AlertMemory {
  keys: string[];
  alertSince: Date | null;
  alertedAt: Date | null;
}

/**
 * Báo khi có sự cố mới, nhắc lại sau `repeatHours` nếu chưa hết, báo "đã ổn" một lần khi hết hẳn. Danh sách luôn được
 * ghi nhớ lại (kể cả khi không báo) để một sự cố đã hết rồi quay lại được coi là mới.
 */
export function decideAlert(
  prev: AlertMemory | null,
  problems: OpsProblem[],
  now: Date,
  repeatHours: number,
): { send: 'ALERT' | 'RECOVERED' | null; next: AlertMemory } {
  const keys = problems.map((p) => p.key);
  if (keys.length === 0) {
    return { send: prev && prev.keys.length > 0 ? 'RECOVERED' : null, next: { keys: [], alertSince: null, alertedAt: null } };
  }
  const prevKeys = prev?.keys ?? [];
  const alertSince = prevKeys.length > 0 && prev?.alertSince ? prev.alertSince : now;
  const hasNew = keys.some((k) => !prevKeys.includes(k));
  const due = !prev?.alertedAt || now.getTime() - prev.alertedAt.getTime() >= repeatHours * 3_600_000;
  if (hasNew || due) return { send: 'ALERT', next: { keys, alertSince, alertedAt: now } };
  return { send: null, next: { keys, alertSince, alertedAt: prev?.alertedAt ?? null } };
}
