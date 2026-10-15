/** Ngưỡng báo động sức khoẻ vận hành — SystemConfig `ops.*` (PLATFORM-5). */
export interface OpsThresholds {
  /** Đơn còn ở kho quá số phút này mà chưa lên Pancake = đơn kẹt. */
  unsyncedMinutes: number;
  stuckOrders: number;
  webhookFailed: number;
  queueFailed1h: number;
  repeatHours: number;
  /** Đơn thu gom đã thanh toán được mà quá số phút này chưa có vận đơn Gomdon = tạo vận đơn đang lỗi kéo dài. */
  gomdonBacklogMinutes: number;
}

export const OPS_THRESHOLD_KEYS: Record<keyof OpsThresholds, { key: string; fallback: number }> = {
  unsyncedMinutes: { key: 'ops.alert_unsynced_minutes', fallback: 30 },
  stuckOrders: { key: 'ops.alert_stuck_orders', fallback: 1 },
  webhookFailed: { key: 'ops.alert_webhook_failed', fallback: 1 },
  queueFailed1h: { key: 'ops.alert_queue_failed_1h', fallback: 5 },
  repeatHours: { key: 'ops.alert_repeat_hours', fallback: 6 },
  gomdonBacklogMinutes: { key: 'ops.alert_gomdon_backlog_minutes', fallback: 15 },
};

export interface CatalogRun {
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

/** Phần của ảnh chụp sức khoẻ mà luật báo động cần. `*Refs` = mã đơn (hoặc #id Pancake) của vài việc cũ nhất. */
export interface ProblemInput {
  pancake: {
    configured: boolean;
    stuck: number;
    stuckRefs: string[];
    /** Webhook lỗi CHƯA ai xử lý, không giới hạn tuổi: quá 24 giờ cron thôi chạy lại nhưng đơn vẫn sai trạng thái. */
    webhookFailedOpen: number;
    /** Webhook nhận rồi mà quá 10 phút vẫn chưa xử lý xong (worker không chạy, Redis mất...). */
    webhookStuck: number;
    webhookRefs: string[];
    /** Đơn trong hàng đợi "Cần xử lý Pancake" (huỷ chưa tới Pancake, nguy cơ thu COD lần nữa...). */
    attention: number;
    attentionRefs: string[];
    catalog: CatalogRun;
  };
  gomdon: {
    configured: boolean;
    webhookFailedOpen: number;
    webhookRefs: string[];
    credentialsRejected: boolean;
    backlog: number;
    backlogRefs: string[];
    /** Hàng đợi "Cần xử lý thu gom": NEEDS_MANUAL_CHECK/FAILED, Gomdon hoàn/huỷ, huỷ vận đơn lỗi, báo động Gomdon chưa đóng. */
    attention: number;
    attentionRefs: string[];
  };
  queues: { ok: true; items: { name: string; failedLastHour: number }[] } | { ok: false; error: string };
}

/** Việc cho người trong một sự cố: số việc + mã đơn của vài việc cũ nhất — để biết lúc nào có việc MỚI. */
export type OpsWorkItems = {
  count: number;
  refs: string[];
};

export interface OpsProblem {
  key: string;
  message: string;
  /**
   * Chỉ có ở hàng việc cho người (cần xử lý Pancake / thu gom): mỗi việc mới là một đơn phải có người làm, nên được báo ngay
   * thay vì gộp vào lần nhắc lại sau `repeatHours`. Sự cố hạ tầng (đơn kẹt, webhook, hàng đợi) không có — số tăng dần trong
   * lúc sự cố là chuyện đương nhiên, báo lại mỗi lượt chỉ là spam.
   */
  items?: OpsWorkItems;
}

const REFS_SHOWN = 5;

/** ": TUBU1, TUBU2 và 3 việc khác" — rỗng khi không có mã nào. */
export function refList(refs: string[], total: number): string {
  const shown = refs.slice(0, REFS_SHOWN);
  if (shown.length === 0) return '';
  const more = Math.max(total, refs.length) - shown.length;
  return `: ${shown.join(', ')}${more > 0 ? ` và ${more} việc khác` : ''}`;
}

/** Danh sách sự cố đang có, theo thứ tự cố định để so được giữa hai lượt. */
export function opsProblems(s: ProblemInput, t: OpsThresholds): OpsProblem[] {
  const out: OpsProblem[] = [];
  if (s.pancake.configured) {
    if (s.pancake.stuck >= t.stuckOrders) {
      out.push({
        key: 'pancake.stuck',
        message: `${s.pancake.stuck} đơn quá ${t.unsyncedMinutes} phút chưa lên Pancake${refList(s.pancake.stuckRefs, s.pancake.stuck)}`,
      });
    }
    const hooks = s.pancake.webhookFailedOpen + s.pancake.webhookStuck;
    if (hooks >= t.webhookFailed) {
      out.push({
        key: 'pancake.webhook',
        message: `${hooks} webhook Pancake lỗi hoặc kẹt chưa xử lý${refList(s.pancake.webhookRefs, hooks)} — chạy lại hoặc đánh dấu đã xử lý ở Sức khoẻ hệ thống`,
      });
    }
    if (s.pancake.attention > 0) {
      out.push({
        key: 'pancake.attention',
        message: `${s.pancake.attention} đơn cần xử lý tay trên Pancake${refList(s.pancake.attentionRefs, s.pancake.attention)}`,
        items: { count: s.pancake.attention, refs: s.pancake.attentionRefs },
      });
    }
    const c = s.pancake.catalog;
    if (c.lastErrorAt && (!c.lastOkAt || c.lastErrorAt > c.lastOkAt)) {
      out.push({ key: 'pancake.catalog', message: `Đồng bộ danh mục Pancake lỗi: ${c.lastError ?? 'không rõ lỗi'}` });
    }
  }
  if (s.gomdon.configured) {
    if (s.gomdon.webhookFailedOpen >= t.webhookFailed) {
      out.push({
        key: 'gomdon.webhook',
        message: `${s.gomdon.webhookFailedOpen} webhook Gomdon lỗi chưa xử lý${refList(s.gomdon.webhookRefs, s.gomdon.webhookFailedOpen)}`,
      });
    }
    if (s.gomdon.credentialsRejected) {
      out.push({ key: 'gomdon.credentials', message: 'Gomdon từ chối đăng nhập — khách không chọn được thu gom' });
    }
    if (s.gomdon.backlog > 0) {
      out.push({
        key: 'gomdon.backlog',
        message: `${s.gomdon.backlog} đơn thu gom quá ${t.gomdonBacklogMinutes} phút chưa tạo được vận đơn Gomdon${refList(s.gomdon.backlogRefs, s.gomdon.backlog)}`,
      });
    }
    if (s.gomdon.attention > 0) {
      out.push({
        key: 'gomdon.attention',
        message:
          `${s.gomdon.attention} đơn thu gom cần xử lý tay (tra vận đơn trên Gomdon, tạo vận đơn tay, báo động chưa đóng)` +
          refList(s.gomdon.attentionRefs, s.gomdon.attention),
        items: { count: s.gomdon.attention, refs: s.gomdon.attentionRefs },
      });
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
  /** Số việc + mã đơn đã biết của từng hàng việc cho người (OpsProblem.items) ở lượt trước. */
  tracked?: Record<string, OpsWorkItems>;
}

/** Hàng việc có việc mới so với lượt trước: thêm việc, hoặc số giữ nguyên mà có mã đơn chưa từng thấy (một xong, một mới). */
function hasNewWork(p: OpsProblem, prev: OpsWorkItems | undefined): boolean {
  if (!p.items || !prev) return false;
  if (p.items.count > prev.count) return true;
  return p.items.count >= prev.count && p.items.refs.some((r) => !prev.refs.includes(r));
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
  const hasNew = keys.some((k) => !prevKeys.includes(k)) || problems.some((p) => hasNewWork(p, prev?.tracked?.[p.key]));
  const due = !prev?.alertedAt || now.getTime() - prev.alertedAt.getTime() >= repeatHours * 3_600_000;
  const work = problems.filter((p) => p.items);
  const tracked = work.length > 0 ? Object.fromEntries(work.map((p) => [p.key, p.items!])) : undefined;
  if (hasNew || due) return { send: 'ALERT', next: { keys, alertSince, alertedAt: now, tracked } };
  return { send: null, next: { keys, alertSince, alertedAt: prev?.alertedAt ?? null, tracked } };
}

export interface AlertMessage {
  status: 'ALERT' | 'RECOVERED';
  title: string;
  summary: string;
  problems: OpsProblem[];
  generatedAt: string;
}

/** Chat hook chỉ nhận đúng định dạng tin nhắn của nó: Google Chat từ chối trường lạ, Slack đọc `text`. */
const CHAT_HOSTS = ['hooks.slack.com', 'chat.googleapis.com'];

export function alertText(m: AlertMessage): string {
  const lines = m.status === 'ALERT' ? m.problems.map((p) => `• ${p.message}`) : [m.summary];
  return [`*${m.title}*`, ...lines].join('\n');
}

/**
 * Thân POST tới OPS_ALERT_WEBHOOK_URL. Slack/Google Chat: chỉ `{text}`. Hook khác (n8n, Zapier...): đủ trường máy đọc
 * được, kèm `text` để kênh nào chỉ hiển thị trường đó vẫn đọc được.
 */
export function alertWebhookBody(url: string, m: AlertMessage): Record<string, unknown> {
  const text = alertText(m);
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    /* URL đã qua env.validation; sai thì gửi dạng chung */
  }
  if (CHAT_HOSTS.includes(host)) return { text };
  return { text, ...m };
}
