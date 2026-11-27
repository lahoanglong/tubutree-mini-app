import { BadRequestException } from '@nestjs/common';
import type { ExternalClaimFunnel, ExternalClaimFunnelPeriod } from '@tubutree/shared-types';
import type { PrismaService } from '../../prisma/prisma.service';
import { GMV_ORDER_SQL } from '../admin/admin-revenue';
import { PHONE_MISMATCH_REVIEW_REASON } from './external-claim.rules';

export const FUNNEL_PERIODS = ['7d', '30d', '90d'] as const satisfies readonly ExternalClaimFunnelPeriod[];

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Record<ExternalClaimFunnelPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** Cùng mức bảng phễu mua: bấm đổi kỳ hay làm mới liên tục không dồn truy vấn quét `analytics_events` và `orders` vào DB. */
export const FUNNEL_CACHE_TTL_MS = 60_000;

export function isFunnelPeriod(v: unknown): v is ExternalClaimFunnelPeriod {
  return typeof v === 'string' && (FUNNEL_PERIODS as readonly string[]).includes(v);
}

/** [from, to) tính lùi đúng N × 24 giờ từ `now`, không cắt theo ngày VN: kỳ trượt, giống `brandSalesRange` 7/30/90 ngày. */
export function funnelRange(period: ExternalClaimFunnelPeriod, now: Date): { from: Date; to: Date } {
  if (!isFunnelPeriod(period)) throw new BadRequestException('Kỳ của phễu chỉ nhận 7d, 30d hoặc 90d.');
  return { from: new Date(now.getTime() - PERIOD_DAYS[period] * DAY_MS), to: now };
}

type Count = number | bigint | null | undefined;
const num = (v: Count): number => (v == null ? 0 : Number(v));
/** Cột thời gian là `timestamp(3)` lưu giờ UTC không múi: so với chuỗi ISO ép `::timestamp`, không phụ thuộc múi giờ phiên DB. */
const ts = (d: Date): string => d.toISOString();

interface SubmissionRow {
  total: Count;
  scan: Count;
  typed: Count;
}

interface CreatedRow {
  matched: Count;
  pending_claims: Count;
  pending_points: Count;
  phone_review: Count;
}

interface CreditedRow {
  credited_claims: Count;
  credited_points: Count;
  credited_users: Count;
  conv_users: Count;
  conv_orders: Count;
  conv_gmv: Count;
}

interface AttemptRow {
  unmatched: Count;
  phone_rejected: Count;
}

/**
 * Phễu đơn sàn → Điểm Xanh → mua lại trên app trong [from, to), chỉ claim SCAN (đơn chat PHONE không phải luồng quét thẻ trong hộp).
 * Bốn truy vấn đọc song song: `analytics_events` đi theo index `[eventName, occurredAt]`; bảng claim và bảng lượt gửi mã nhỏ (sổ sự
 * kiện claim dò theo `[claimId, createdAt]`); đơn dò theo `orders [userId, createdAt]` của đúng nhóm khách đã được cộng.
 *
 * - Lượt gửi đọc từ `ext_claim_submitted`.
 * - Từ chối vì SĐT lệch đọc từ `external_claim_attempts` (`REJECTED_PHONE_MISMATCH`): lúc gửi mã và lúc cron ghép lại đều ghi kết quả này,
 *   còn sự kiện `ext_claim_submitted` chỉ có ở lúc gửi.
 * - Chờ duyệt vì SĐT lệch: claim từng vào REVIEW với câu SĐT lệch, đọc từ sổ `external_claim_events` (chỉ thêm dòng). Duyệt xoá
 *   `reviewReason` của claim, nên chỉ đọc cột đó thì claim đã duyệt và đã cộng rơi khỏi số đếm.
 * - Chưa thấy đơn: đếm theo MÃ gửi trong kỳ mà tới giờ chưa lượt nào của mã đó tìm thấy đơn (không theo lượt: khách gửi lại sau khi
 *   lượt chờ hết hạn, hay người thứ hai gửi cùng mã, không đếm thêm).
 * - Khách quay lại mua: gộp tài khoản theo `users.mergedIntoId` (một bước, như báo cáo nguồn khách). Đơn của tài khoản đã gộp vẫn tính
 *   cho tài khoản đích. Chỉ đơn lẻ Mini App/web đặt SAU lần cộng đầu trong kỳ và trước `to`, trạng thái GMV (`GMV_ORDER_SQL`: đang chạy
 *   hoặc đã giao, không gồm đơn thử đã dọn), nên đơn đại lý, đơn chưa rõ nền tảng, đơn chờ thanh toán, huỷ, hoàn không tính.
 */
export async function loadExternalClaimFunnel(
  prisma: Pick<PrismaService, '$queryRaw'>,
  period: ExternalClaimFunnelPeriod,
  now: Date,
): Promise<ExternalClaimFunnel> {
  const { from, to } = funnelRange(period, now);
  const f = ts(from);
  const t = ts(to);

  const [submissions, created, credited, attempts] = await Promise.all([
    prisma.$queryRaw<SubmissionRow[]>`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE e.props->>'via' = 'scan') AS scan,
             count(*) FILTER (WHERE e.props->>'via' = 'typed') AS typed
        FROM "analytics_events" e
       WHERE e."eventName" = 'ext_claim_submitted'
         AND e."occurredAt" >= ${f}::timestamp
         AND e."occurredAt" < ${t}::timestamp`,
    prisma.$queryRaw<CreatedRow[]>`
      SELECT count(DISTINCT c."externalOrderId") AS matched,
             count(*) FILTER (WHERE c.state IN ('PENDING', 'REVIEW')) AS pending_claims,
             COALESCE(sum(c.points) FILTER (WHERE c.state IN ('PENDING', 'REVIEW')), 0) AS pending_points,
             count(*) FILTER (
               WHERE strpos(COALESCE(c."reviewReason", ''), ${PHONE_MISMATCH_REVIEW_REASON}) > 0
                  OR EXISTS (
                    SELECT 1 FROM "external_claim_events" ev
                     WHERE ev."claimId" = c.id
                       AND ev."toState" = 'REVIEW'
                       AND strpos(COALESCE(ev.note, ''), ${PHONE_MISMATCH_REVIEW_REASON}) > 0
                  )
             ) AS phone_review
        FROM "external_points_claims" c
       WHERE c.kind = 'SCAN'
         AND c."createdAt" >= ${f}::timestamp
         AND c."createdAt" < ${t}::timestamp`,
    prisma.$queryRaw<CreditedRow[]>`
      WITH credited AS (
        SELECT COALESCE(u."mergedIntoId", c."userId") AS uid, c."creditedAt" AS at, c.points
          FROM "external_points_claims" c
          LEFT JOIN "users" u ON u.id = c."userId"
         WHERE c.kind = 'SCAN'
           AND c.state = 'CREDITED'
           AND c."userId" IS NOT NULL
           AND c."creditedAt" >= ${f}::timestamp
           AND c."creditedAt" < ${t}::timestamp
      ), cohort AS (
        SELECT uid, min(at) AS first_credit FROM credited GROUP BY uid
      ), members AS (
        SELECT k.uid AS member_id, k.uid, k.first_credit FROM cohort k
        UNION
        SELECT u.id AS member_id, k.uid, k.first_credit FROM "users" u JOIN cohort k ON u."mergedIntoId" = k.uid
      ), conv AS (
        SELECT m.uid, o.id, o.total
          FROM members m
          JOIN "orders" o ON o."userId" = m.member_id
         WHERE o."createdAt" > m.first_credit
           AND o."createdAt" < ${t}::timestamp
           AND o.type = 'RETAIL'
           AND o.platform IN ('miniapp', 'web')
           AND ${GMV_ORDER_SQL}
      )
      SELECT (SELECT count(*) FROM credited) AS credited_claims,
             (SELECT COALESCE(sum(points), 0) FROM credited) AS credited_points,
             (SELECT count(*) FROM cohort) AS credited_users,
             (SELECT count(DISTINCT uid) FROM conv) AS conv_users,
             (SELECT count(*) FROM conv) AS conv_orders,
             (SELECT COALESCE(sum(total), 0) FROM conv) AS conv_gmv`,
    prisma.$queryRaw<AttemptRow[]>`
      WITH att AS (
        SELECT a.code, a.result, a."externalOrderId"
          FROM "external_claim_attempts" a
         WHERE a."createdAt" >= ${f}::timestamp
           AND a."createdAt" < ${t}::timestamp
      ), codes AS (
        SELECT att.code
          FROM att
         GROUP BY att.code
        HAVING bool_or(att.result IN ('UNMATCHED', 'NOT_FOUND') AND att."externalOrderId" IS NULL)
           AND NOT bool_or(att.result = 'MATCHED' OR att."externalOrderId" IS NOT NULL)
      )
      SELECT (SELECT count(*) FROM codes) AS unmatched,
             (SELECT count(*) FROM att WHERE att.result = 'REJECTED_PHONE_MISMATCH') AS phone_rejected`,
  ]);

  const s = submissions[0];
  const c = created[0];
  const k = credited[0];
  const creditedUsers = num(k?.credited_users);
  const convUsers = num(k?.conv_users);
  return {
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    submissions: { total: num(s?.total), scan: num(s?.scan), typed: num(s?.typed) },
    matchedOrders: num(c?.matched),
    phoneMismatch: { rejected: num(attempts[0]?.phone_rejected), review: num(c?.phone_review) },
    unmatched: num(attempts[0]?.unmatched),
    pending: { claims: num(c?.pending_claims), points: num(c?.pending_points) },
    credited: { claims: num(k?.credited_claims), points: num(k?.credited_points), users: creditedUsers },
    converted: {
      users: convUsers,
      orders: num(k?.conv_orders),
      gmv: num(k?.conv_gmv),
      rate: creditedUsers > 0 ? Math.round((convUsers / creditedUsers) * 10_000) / 10_000 : 0,
    },
  };
}

/**
 * Bộ nhớ đệm theo từng kỳ, sống cùng service (một bản mỗi tiến trình API). Lời hứa đang chạy được dùng lại, nên nhiều người mở tab cùng
 * lúc chỉ chạy một lượt truy vấn; lượt lỗi bị bỏ khỏi bộ đệm để lần sau tính lại. `now` lùi về trước lúc đã lưu cũng coi là hết hạn.
 */
export class ExternalClaimFunnelCache {
  private readonly entries = new Map<ExternalClaimFunnelPeriod, { at: number; value: Promise<ExternalClaimFunnel> }>();

  constructor(private readonly ttlMs: number = FUNNEL_CACHE_TTL_MS) {}

  get(period: ExternalClaimFunnelPeriod, now: Date, compute: () => Promise<ExternalClaimFunnel>): Promise<ExternalClaimFunnel> {
    const hit = this.entries.get(period);
    const age = hit ? now.getTime() - hit.at : -1;
    if (hit && age >= 0 && age < this.ttlMs) return hit.value;
    const entry = { at: now.getTime(), value: compute() };
    this.entries.set(period, entry);
    entry.value.catch(() => {
      if (this.entries.get(period) === entry) this.entries.delete(period);
    });
    return entry.value;
  }
}
