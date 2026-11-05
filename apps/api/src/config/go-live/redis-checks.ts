import {
  QUEUE_GOMDON_EVENTS,
  QUEUE_GOMDON_PUSH,
  QUEUE_NOTIFICATIONS,
  QUEUE_NOTIFICATIONS_INAPP_RETRY,
  QUEUE_PANCAKE_EVENTS,
  QUEUE_PANCAKE_PUSH,
  QUEUE_SUPPORT_CHAT_FORWARD,
  QUEUE_SUPPORT_CHAT_NOTIFY,
  QUEUE_ZALO_OA_EVENTS,
} from '../../jobs/queues';
import { isPushFailureSettled, PUSH_ERROR_KIND } from '../../modules/integrations/pancake/pancake-push-error';
import { fail, pass, warn, type CheckResult, type GoLivePhase } from './types';

const G_REDIS = 'Redis';
const G_QUEUE = 'Hàng đợi BullMQ';

export const EXPECTED_QUEUES = [
  QUEUE_PANCAKE_PUSH,
  QUEUE_PANCAKE_EVENTS,
  QUEUE_GOMDON_PUSH,
  QUEUE_GOMDON_EVENTS,
  QUEUE_NOTIFICATIONS,
  QUEUE_NOTIFICATIONS_INAPP_RETRY,
  QUEUE_ZALO_OA_EVENTS,
  QUEUE_SUPPORT_CHAT_FORWARD,
  QUEUE_SUPPORT_CHAT_NOTIFY,
] as const;

const QUEUES_TITLE = `Đủ ${EXPECTED_QUEUES.length} hàng đợi truy cập được`;

/**
 * Job lỗi của hàng pancake-push đối chiếu với đơn trong DB: đơn đã lên Pancake/huỷ/giao thì dấu lỗi chỉ chờ dọn, không phải việc treo.
 * `unexamined` = job lỗi vượt số đã đọc: coi như còn mở (không biết thì không bỏ qua).
 */
export interface PancakeFailedJobs {
  settled: number;
  open: { code: string; reason: string }[];
  unexamined: number;
}

export interface QueueSnapshot {
  name: string;
  ok: boolean;
  error?: string;
  counts?: { waiting: number; active: number; delayed: number; failed: number };
  /** Chỉ có ở pancake-push khi đọc được cả job lỗi lẫn DB; thiếu thì dùng `counts.failed` như các hàng khác. */
  pancakeFailed?: PancakeFailedJobs;
}

const FAILED_REASON_VI: Record<string, string> = {
  [PUSH_ERROR_KIND.CONFIG]: 'khoá API Pancake sai/hết hạn',
  [PUSH_ERROR_KIND.DATA]: 'thiếu dữ liệu đơn',
  [PUSH_ERROR_KIND.CONFIG_RECHECK]: 'khoá API vừa đẩy được đơn khác, chờ thử lại',
  [PUSH_ERROR_KIND.REJECTED]: 'Pancake từ chối dữ liệu đơn',
  [PUSH_ERROR_KIND.TRANSIENT]: 'Pancake tạm lỗi',
};

export interface FailedJobRef {
  name: string;
  orderId: string | null;
}
export interface FailedOrderRef {
  id: string;
  code: string;
  status: string;
  pancakeOrderId: string | null;
  pancakeErrorKind: string | null;
}

/**
 * Gộp job lỗi của pancake-push với đơn: job push của đơn đã có kết cục là "đã xử lý, chờ dọn"; job push của đơn còn mở, và job
 * thanh toán/huỷ (kết cục nằm ở cột khác, chưa đối chiếu) là việc còn mở.
 */
export function summarizePancakeFailed(jobs: FailedJobRef[], orders: FailedOrderRef[], totalFailed: number): PancakeFailedJobs {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const out: PancakeFailedJobs = { settled: 0, open: [], unexamined: Math.max(0, totalFailed - jobs.length) };
  for (const j of jobs) {
    const o = j.orderId ? byId.get(j.orderId) : undefined;
    if (j.name === 'push' && isPushFailureSettled(o ?? null)) {
      out.settled += 1;
      continue;
    }
    const code = o?.code ?? j.orderId ?? '(không rõ đơn)';
    const reason = j.name !== 'push' ? 'lệnh thanh toán/huỷ lỗi' : (FAILED_REASON_VI[o?.pancakeErrorKind ?? ''] ?? 'lỗi chưa phân loại');
    out.open.push({ code, reason });
  }
  return out;
}

/** Ảnh chụp chỉ-đọc của Redis; null nghĩa là lệnh CONFIG không đọc được. */
export interface RedisSnapshot {
  reachable: boolean;
  error?: string;
  dbIndex: number;
  maxmemoryPolicy: string | null;
  maxmemoryBytes: number | null;
  appendonly: string | null;
  queues: QueueSnapshot[];
}

const BACKLOG_WAITING = 50;

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)}MB`;

export function evaluateRedis(s: RedisSnapshot, phase: GoLivePhase = 'post-deploy'): CheckResult[] {
  if (!s.reachable) {
    return [
      fail(G_REDIS, 'redis.reachable', 'Redis kết nối được', s.error ?? 'không kết nối được', 'Kiểm container redis đang chạy và REDIS_URL (compose: redis://redis:6379).'),
      fail(G_QUEUE, 'queues.reachable', QUEUES_TITLE, 'không kiểm được vì Redis không kết nối', 'Sửa Redis trước.'),
    ];
  }
  const out: CheckResult[] = [pass(G_REDIS, 'redis.reachable', 'Redis kết nối được', `PING ổn, dùng DB số ${s.dbIndex}`)];

  const policyTitle = 'maxmemory-policy = noeviction';
  if (s.maxmemoryPolicy === null) {
    out.push(warn(G_REDIS, 'redis.policy', policyTitle, 'không đọc được (lệnh CONFIG bị tắt?)', 'Chạy tay: `docker compose -f docker-compose.vietnix.yml exec redis redis-cli config get maxmemory-policy`.'));
  } else if (s.maxmemoryPolicy === 'noeviction') {
    out.push(pass(G_REDIS, 'redis.policy', policyTitle, 'noeviction'));
  } else if (phase === 'pre-deploy') {
    out.push(
      warn(
        G_REDIS,
        'redis.policy',
        policyTitle,
        `đang là ${s.maxmemoryPolicy}`,
        'Bình thường trước deploy khi compose cũ còn đặt allkeys-lru: runbook mục 5 bước 5 tạo lại redis bằng compose mới (noeviction), và sau deploy dòng này phải PASS. Đổi ngay không cần khởi động lại: `docker compose -f docker-compose.vietnix.yml exec -T redis redis-cli config set maxmemory-policy noeviction`.',
      ),
    );
  } else {
    out.push(
      fail(
        G_REDIS,
        'redis.policy',
        policyTitle,
        `đang là ${s.maxmemoryPolicy}`,
        'Redis đang được phép xoá job chờ để lấy chỗ: đơn có thể không tới Pancake mà không ai biết. Tạo lại container: `docker compose -f docker-compose.vietnix.yml up -d redis` (compose đã đặt noeviction).',
      ),
    );
  }

  if (s.maxmemoryBytes === null) {
    out.push(warn(G_REDIS, 'redis.maxmemory', 'Trần bộ nhớ Redis', 'không đọc được', 'Chạy tay: `redis-cli config get maxmemory`.'));
  } else if (s.maxmemoryBytes === 0) {
    out.push(warn(G_REDIS, 'redis.maxmemory', 'Trần bộ nhớ Redis', 'không giới hạn', 'VPS dùng chung với ChoDeli: đặt --maxmemory 150mb như docker-compose.vietnix.yml để Redis không ăn hết RAM.'));
  } else {
    out.push(pass(G_REDIS, 'redis.maxmemory', 'Trần bộ nhớ Redis', mb(s.maxmemoryBytes)));
  }

  if (s.appendonly === null) {
    out.push(warn(G_REDIS, 'redis.persistence', 'Redis lưu xuống đĩa (appendonly)', 'không đọc được', 'Chạy tay: `redis-cli config get appendonly`.'));
  } else if (s.appendonly === 'yes') {
    out.push(pass(G_REDIS, 'redis.persistence', 'Redis lưu xuống đĩa (appendonly)', 'yes'));
  } else {
    out.push(warn(G_REDIS, 'redis.persistence', 'Redis lưu xuống đĩa (appendonly)', `đang là ${s.appendonly}`, 'Khởi động lại Redis sẽ mất job đang chờ retry; compose đặt --appendonly yes.'));
  }

  out.push(
    s.dbIndex === 0
      ? pass(G_REDIS, 'redis.db_index', 'Chỉ số DB Redis', '0')
      : warn(G_REDIS, 'redis.db_index', 'Chỉ số DB Redis', `${s.dbIndex}`, 'Compose dùng DB 0. Khác 0 thì kiểm không có công cụ nào khác (monitor, bull-board) trỏ vào DB khác.'),
  );

  const byName = new Map(s.queues.map((q) => [q.name, q]));
  const broken = EXPECTED_QUEUES.filter((n) => !byName.get(n)?.ok);
  out.push(
    broken.length === 0
      ? pass(G_QUEUE, 'queues.reachable', QUEUES_TITLE, EXPECTED_QUEUES.join(', '))
      : fail(G_QUEUE, 'queues.reachable', QUEUES_TITLE, `không đọc được: ${broken.join(', ')}`, 'Xem log api (docker compose logs api); thường là Redis hết bộ nhớ hoặc kết nối bị ngắt.'),
  );

  // Job lỗi của đơn đã có kết cục (pancake-push) không tính là còn treo: báo PASS kèm số "chờ dọn".
  const failedOpen = (q: QueueSnapshot) => (q.pancakeFailed ? q.pancakeFailed.open.length + q.pancakeFailed.unexamined : (q.counts?.failed ?? 0));
  const noisy = s.queues.filter((q) => q.ok && q.counts && (failedOpen(q) > 0 || q.counts.waiting > BACKLOG_WAITING));
  const settled = s.queues.reduce((n, q) => n + (q.pancakeFailed?.settled ?? 0), 0);
  const settledNote = settled > 0 ? `; pancake-push: ${settled} job lỗi của đơn đã xử lý, chờ dọn` : '';
  if (noisy.length === 0) {
    out.push(pass(G_QUEUE, 'queues.backlog', 'Hàng đợi không ứ, không job lỗi', `failed = 0, waiting không quá 50 ở mọi hàng${settledNote}`));
  } else {
    const detail =
      noisy
        .map((q) => {
          const pf = q.pancakeFailed;
          if (!pf) return `${q.name}: failed ${q.counts?.failed}, waiting ${q.counts?.waiting}`;
          const shown = pf.open.slice(0, 5).map((o) => `${o.code} (${o.reason})`);
          const more = pf.open.length - shown.length + pf.unexamined;
          const list = [...shown, ...(more > 0 ? [`và ${more} đơn khác`] : [])].join(', ');
          return `${q.name}: failed ${failedOpen(q)} còn cần xử lý${list ? `: ${list}` : ''}, waiting ${q.counts?.waiting}`;
        })
        .join('; ') + settledNote;
    out.push(warn(G_QUEUE, 'queues.backlog', 'Hàng đợi không ứ, không job lỗi', detail, 'Mở Quản trị, Sức khoẻ hệ thống để xem nguyên nhân từng hàng; job lỗi cũ có thể tồn từ lúc thử, quyết định có xử lý hay bỏ. Đơn Pancake lỗi: xem lý do trong ngoặc, sửa rồi bấm "Đẩy lại Pancake" ở chi tiết đơn.'));
  }
  return out;
}
