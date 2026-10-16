import { createHash } from 'node:crypto';
import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

/**
 * Tin báo NGƯỜI MỜI về một dòng sổ thưởng giới thiệu vừa commit. `key` = reason của dòng sổ chính của sự kiện (duy nhất nhờ
 * partial unique index theo reason), nên cùng dòng sổ chỉ cho đúng một tin dù luồng cấp/thu hồi chạy lại.
 */
export type ReferralNotice =
  | { kind: 'PAID'; referrerId: string; refereeId: string; points: number; key: string }
  | { kind: 'MILESTONE'; referrerId: string; count: number; points: number; key: string }
  | {
      kind: 'REVOKED';
      referrerId: string;
      refereeId: string;
      /** Điểm thực trừ (gồm mốc thưởng thêm bị thu cùng lúc). */
      taken: number;
      /** Phần không trừ được vì số dư không đủ (đã ghi REFERRAL_DEBT). */
      debt: number;
      cause: 'RETURN' | 'PARTIAL_RETURN' | 'MERGE';
      key: string;
    };

interface ReferralNotifier {
  notify(userId: string, templateCode: string, data: Record<string, string>, opts?: { dedupeKey?: string }): Promise<void>;
}

export interface ReferralNotifyContext {
  prisma: Pick<PrismaClient, 'user'>;
  /** Có thể thiếu ở test dựng service bằng tay. */
  notifications: ReferralNotifier | undefined;
  logger: Pick<Logger, 'warn'>;
}

const FRIEND_FALLBACK = 'bạn bè';

/**
 * Tên gọi của người được mời cho tin gửi người mời: chỉ từ cuối của họ tên (tên gọi theo cách viết tên tiếng Việt), không họ,
 * không số điện thoại. Tên khách mặc định, tên có chữ số/@ (thường là số điện thoại hay email) hoặc trống thì "bạn bè".
 */
export function maskFriendName(fullName: string | null | undefined): string {
  const words = (fullName ?? '').normalize('NFC').trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  if (!last || (words.length === 1 && last.toLowerCase() === 'khách')) return FRIEND_FALLBACK;
  if (/[\d@]/.test(last) || last.length > 20) return FRIEND_FALLBACK;
  return last;
}

const CAUSE_TEXT: Record<'RETURN' | 'PARTIAL_RETURN' | 'MERGE', string> = {
  RETURN: 'đơn hàng của bạn ấy đã được trả lại',
  PARTIAL_RETURN: 'một phần đơn hàng của bạn ấy đã được trả lại',
  MERGE: 'liên kết giới thiệu không còn hợp lệ sau khi gộp tài khoản',
};

const fmt = (n: number) => n.toLocaleString('vi-VN');

export function revokeDetail(taken: number, debt: number): string {
  if (taken > 0 && debt > 0) {
    return `đã trừ ${fmt(taken)} Điểm Xanh; số dư không đủ nên còn thiếu ${fmt(debt)} điểm, Tubu Tree đã ghi nhận phần này`;
  }
  if (taken > 0) return `đã trừ ${fmt(taken)} Điểm Xanh`;
  return `số dư Điểm Xanh không đủ nên chưa trừ được, còn thiếu ${fmt(debt)} điểm, Tubu Tree đã ghi nhận phần này`;
}

/** Khoá chống gửi trùng: băm để payload tin (khách đọc được qua /notifications) không mang id người được mời. */
function dedupeKey(key: string): string {
  return `referral:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

/**
 * Gửi tin cho người mời. CHỈ gọi sau khi tx ghi sổ đã commit. Best-effort: lỗi đọc tên hay gửi tin chỉ ghi cảnh báo, không bao
 * giờ ném (tiền đã ghi xong). Sự kiện 0 điểm (thu hồi không trừ gì và không nợ gì) không báo.
 */
export async function sendReferralNotices(ctx: ReferralNotifyContext, notices: readonly ReferralNotice[]): Promise<void> {
  if (!ctx.notifications || notices.length === 0) return;
  for (const n of notices) {
    try {
      if (n.kind === 'MILESTONE') {
        if (!(n.points > 0)) continue;
        await ctx.notifications.notify(
          n.referrerId,
          'REFERRAL_MILESTONE_PAID',
          { points: fmt(n.points), count: String(n.count) },
          { dedupeKey: dedupeKey(n.key) },
        );
        continue;
      }
      if (n.kind === 'PAID' ? !(n.points > 0) : !(n.taken > 0 || n.debt > 0)) continue;
      const referee = await ctx.prisma.user.findUnique({ where: { id: n.refereeId }, select: { fullName: true } });
      const friend = maskFriendName(referee?.fullName);
      if (n.kind === 'PAID') {
        await ctx.notifications.notify(
          n.referrerId,
          'REFERRAL_REWARD_PAID',
          { points: fmt(n.points), friend },
          { dedupeKey: dedupeKey(n.key) },
        );
      } else {
        await ctx.notifications.notify(
          n.referrerId,
          'REFERRAL_REWARD_REVOKED',
          { friend, cause: CAUSE_TEXT[n.cause], detail: revokeDetail(n.taken, n.debt), points: fmt(n.taken), debt: fmt(n.debt) },
          { dedupeKey: dedupeKey(n.key) },
        );
      }
    } catch (err) {
      ctx.logger.warn(`Chưa báo được người mời ${n.referrerId} về ${n.kind} (${n.key}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
