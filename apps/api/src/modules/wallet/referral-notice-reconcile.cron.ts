import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CRON_TZ } from '../../common/cron-tz';
import { NotificationsService } from '../notifications/notifications.service';
import { isReportableNotice, referralDedupeKey, sendReferralNotices, type ReferralNotice } from './referral-notify';
import { referralNoticeFromLedger, REFERRAL_NOTICE_REASON_PREFIXES, type ReferralLedgerRow } from './referral-notice-ledger';
import { MILESTONE_PREFIX } from './referral-reward';

const PAGE = 50;
const MAX_PER_TICK = 200;
const WINDOW_MS = 3 * 864e5;
// Đường trực tiếp gửi tin ngay sau commit: dòng sổ trẻ hơn mức này có thể chỉ đang chờ chính nó, nên chưa coi là sót.
const MIN_AGE_MS = 5 * 60_000;
const LOCK_KEY = 'cron:wallet.referral_notice_reconcile';
// Migration seed các mẫu REFERRAL_*: sự kiện trước lúc nó chạy xong thì chưa từng có đường báo nào, không phải tin "bị sót".
const TEMPLATES_MIGRATION = '20261017000100_r12_referral_notification_templates';

type Cursor = { createdAt: Date; id: string };

export type ReferralNoticeReconcileResult =
  | { skipped: 'RUNNING' | 'LOCKED' }
  | { scanned: number; missing: number; sent: number; failed: number; skippedNotices: number; wrapped: boolean };

/**
 * Gửi bù tin báo người mời (REFERRAL_REWARD_PAID / MILESTONE_PAID / REWARD_REVOKED) bị sót vì tiến trình chết giữa lúc commit sổ
 * điểm và lúc gửi (sendReferralNotices chỉ best-effort). Quét dòng sổ điểm khoá tin tạo trong WINDOW_MS và đã quá MIN_AGE_MS,
 * dựng lại tin từ sổ (referral-notice-ledger) rồi gửi qua ĐÚNG đường cũ: dedupeKey theo (khách, dòng sổ) nên dòng đã có tin,
 * hai lượt chạy chồng hay đường trực tiếp chạy lại đều không gửi trùng. Không ghi gì vào sổ/tx tiền.
 *
 * Tin đã có trong notification_logs thì coi là đã gửi. Khách chỉ đánh dấu đã đọc được chứ không xoá tin, và nhật ký tin chỉ bị
 * dọn sau retention.notification_logs_days (tối thiểu 30 ngày, lâu hơn cửa sổ 3 ngày) nên tin đã gửi không bao giờ "mất" để bị
 * gửi lại.
 */
@Injectable()
export class ReferralNoticeReconcileCron {
  private readonly logger = new Logger(ReferralNoticeReconcileCron.name);
  private running = false;
  private cursor: Cursor | null = null;
  private liveSince: Date | null = null;
  private failClosedSince: Date | null = null;
  private readonly warnedAmbiguous = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    // Optional như RewardPointsService: test dựng tay không có NotificationsService thì không có gì để gửi.
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 */10 * * * *', { name: 'wallet.referral-notice-reconcile', timeZone: CRON_TZ })
  async handleCron(): Promise<void> {
    try {
      const res = await this.reconcile();
      if ('scanned' in res && (res.missing > 0 || res.failed > 0)) {
        this.logger.log(
          `Gửi bù tin giới thiệu: quét ${res.scanned} dòng sổ, thiếu tin ${res.missing}, đã gửi ${res.sent}, lỗi ${res.failed}, bỏ qua ${res.skippedNotices}.`,
        );
      }
    } catch (err) {
      this.logger.error(`Cron gửi bù tin giới thiệu lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
  }

  async reconcile(now: Date = new Date()): Promise<ReferralNoticeReconcileResult> {
    if (this.running) return { skipped: 'RUNNING' };
    this.running = true;
    try {
      // Khoá advisory theo transaction giữ suốt lượt chạy: hai replica cùng lên lịch thì chỉ một bên quét. Việc gửi chạy trên
      // kết nối khác — tx này chỉ để giữ khoá.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS "locked"`;
          if (!row?.locked) return { skipped: 'LOCKED' as const };
          return this.sweep(now);
        },
        { maxWait: 10_000, timeout: 5 * 60_000 },
      );
    } finally {
      this.running = false;
    }
  }

  /** Một lượt quét KHÔNG giữ khoá cron (test chạy hai lượt song song để chứng minh dedupeKey đủ chặn trùng). */
  async sweep(now: Date): Promise<{ scanned: number; missing: number; sent: number; failed: number; skippedNotices: number; wrapped: boolean }> {
    const windowStart = new Date(now.getTime() - WINDOW_MS);
    const liveSince = await this.templatesLiveSince(now);
    const from = liveSince > windowStart ? liveSince : windowStart;
    const to = new Date(now.getTime() - MIN_AGE_MS);
    const out = { scanned: 0, missing: 0, sent: 0, failed: 0, skippedNotices: 0, wrapped: false };
    let after = this.cursor;
    try {
      while (out.scanned < MAX_PER_TICK) {
        const take = Math.min(PAGE, MAX_PER_TICK - out.scanned);
        const page = await this.prisma.pointsTransaction.findMany({
          where: {
            refType: 'REFERRAL',
            createdAt: { gte: from, lte: to },
            OR: REFERRAL_NOTICE_REASON_PREFIXES.map((p) => ({ reason: { startsWith: p } })),
            ...(after && { AND: [{ OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] }] }),
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take,
          select: { id: true, userId: true, delta: true, reason: true, refId: true, createdAt: true },
        });
        out.scanned += page.length;
        const batch = await this.reconcilePage(page);
        out.missing += batch.missing;
        out.sent += batch.sent;
        out.failed += batch.failed;
        out.skippedNotices += batch.skippedNotices;
        const last = page[page.length - 1];
        if (page.length < take || !last) {
          after = null;
          out.wrapped = true;
          break;
        }
        after = { createdAt: last.createdAt, id: last.id };
      }
    } finally {
      this.cursor = after;
    }
    return out;
  }

  /**
   * Mốc dưới của lượt quét: lúc migration mẫu tin chạy xong (notification_templates không có cột ngày tạo), để lần triển khai
   * đầu không gửi dồn tin cho sự kiện của 3 ngày trước, vốn chưa từng có đường báo. Đọc lỗi hoặc không có dòng migration thành
   * công thì ĐÓNG: mốc = lúc lượt quét đầu tiên của tiến trình này (chỉ dòng sổ tạo sau đó mới được gửi bù), ghi cảnh báo một
   * lần; lần sau vẫn thử đọc lại nên có dòng migration là tự hết đóng.
   */
  private async templatesLiveSince(now: Date): Promise<Date> {
    if (this.liveSince) return this.liveSince;
    try {
      const rows = await this.prisma.$queryRaw<{ finishedAt: Date | null }[]>`
        SELECT max("finished_at") AS "finishedAt" FROM "_prisma_migrations"
         WHERE "migration_name" = ${TEMPLATES_MIGRATION} AND "rolled_back_at" IS NULL AND "finished_at" IS NOT NULL`;
      const at = rows[0]?.finishedAt;
      if (at) {
        this.liveSince = at;
        return at;
      }
    } catch (err) {
      this.logger.warn(`Không đọc được mốc migration ${TEMPLATES_MIGRATION}: ${err instanceof Error ? err.message : err}`);
    }
    if (!this.failClosedSince) {
      this.failClosedSince = now;
      this.logger.warn(`Không có mốc migration ${TEMPLATES_MIGRATION}: chỉ gửi bù tin cho dòng sổ tạo sau ${now.toISOString()}.`);
    }
    return this.failClosedSince;
  }

  private async reconcilePage(page: ReferralLedgerRow[]): Promise<{ missing: number; sent: number; failed: number; skippedNotices: number }> {
    const res = { missing: 0, sent: 0, failed: 0, skippedNotices: 0 };
    if (page.length === 0 || !this.notifications) return res;
    const delivered = await this.deliveredKeys(page);
    const notices: ReferralNotice[] = [];
    for (const row of page) {
      if (delivered.has(row.id)) continue;
      try {
        const notice = await referralNoticeFromLedger(this.prisma, row);
        if (notice === 'AMBIGUOUS') this.warnAmbiguousOnce(row);
        // Dòng không có tin riêng (đã gộp vào tin khác, tin 0 điểm, bỏ qua có chủ đích) không phải tin sót.
        if (notice === null || typeof notice === 'string' || !isReportableNotice(notice)) {
          res.skippedNotices += 1;
          continue;
        }
        res.missing += 1;
        notices.push(notice);
      } catch (err) {
        res.missing += 1;
        res.failed += 1;
        this.logger.error(`Dựng lại tin giới thiệu cho dòng sổ ${row.id} (${row.reason}) lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (notices.length > 0) {
      const failed = await sendReferralNotices({ prisma: this.prisma, notifications: this.notifications, logger: this.logger }, notices);
      res.failed += failed;
      res.sent += notices.length - failed;
    }
    return res;
  }

  private warnAmbiguousOnce(row: ReferralLedgerRow): void {
    if (this.warnedAmbiguous.has(row.id)) return;
    if (this.warnedAmbiguous.size >= 1000) this.warnedAmbiguous.clear();
    this.warnedAmbiguous.add(row.id);
    this.logger.warn(`Không dựng lại được tin thu hồi giới thiệu cho dòng sổ ${row.id} (${row.reason}): nhiều dòng thu hồi cùng một sự kiện; bỏ qua.`);
  }

  /**
   * Id các dòng sổ đã có tin, đúng phép kiểm của NotificationsService.notify (cùng khách, cùng dedupeKey, INAPP). Gộp khách chuyển
   * dòng sổ sang tài khoản đích mà không chuyển nhật ký tin, nên tin đã gửi cho khách (user.mergedIntoId = chủ dòng sổ) cũng tính
   * là đã gửi; khoá mốc bị đổi tên khi gộp (mang id đích, đời mới) nên với mốc so thêm theo số mốc đã báo cho khách đó.
   */
  private async deliveredKeys(page: ReferralLedgerRow[]): Promise<Set<string>> {
    const owners = [...new Set(page.map((r) => r.userId))];
    const guests = await this.prisma.user.findMany({ where: { mergedIntoId: { in: owners } }, select: { id: true, mergedIntoId: true } });
    const guestsOf = new Map<string, string[]>();
    for (const g of guests) guestsOf.set(g.mergedIntoId!, [...(guestsOf.get(g.mergedIntoId!) ?? []), g.id]);
    const userIds = [...new Set([...owners, ...guests.map((g) => g.id)])];
    const keys = [...new Set(page.map((r) => referralDedupeKey(r.reason)))];
    const earliest = page.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), page[0]!.createdAt);
    const since = new Date(earliest.getTime() - 60_000);
    // Tin chỉ có thể gửi sau dòng sổ của nó nên chặn sentAt cho truy vấn đi theo index (userId, sentAt).
    const rows = await this.prisma.$queryRaw<{ userId: string; key: string | null; template: string; count: string | null }[]>(Prisma.sql`
      SELECT "userId", "payload"->>'dedupeKey' AS "key", "templateCode" AS "template", "payload"->'data'->>'count' AS "count"
        FROM "notification_logs"
       WHERE "channel" = 'INAPP'
         AND "userId" = ANY(${userIds}::text[])
         AND "sentAt" >= ${since}
         AND ("payload"->>'dedupeKey' = ANY(${keys}::text[]) OR "templateCode" = 'REFERRAL_MILESTONE_PAID')`);
    const byKey = new Set(rows.filter((r) => r.key).map((r) => `${r.userId}|${r.key}`));
    const milestonesTold = new Set(rows.filter((r) => r.template === 'REFERRAL_MILESTONE_PAID').map((r) => `${r.userId}|${r.count}`));
    const delivered = new Set<string>();
    for (const row of page) {
      const key = referralDedupeKey(row.reason);
      const guestIds = guestsOf.get(row.userId) ?? [];
      if ([row.userId, ...guestIds].some((u) => byKey.has(`${u}|${key}`))) delivered.add(row.id);
      else if (row.reason.startsWith(MILESTONE_PREFIX)) {
        const count = row.reason.slice(row.reason.lastIndexOf(':') + 1).split('#')[0];
        if (guestIds.some((u) => milestonesTold.has(`${u}|${count}`))) delivered.add(row.id);
      }
    }
    return delivered;
  }
}
