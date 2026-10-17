import { createHash } from 'node:crypto';
import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { ANONYMIZED_NAME } from '../users/account-deletion.service';

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
      /** Người được mời là chính người mời (phiên khách của họ vừa gộp vào): không nêu tên. */
      hideFriend?: boolean;
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
 * Tên không phải tên người: tên phiên khách (auth.service tạo khách với 'Khách'), tên đã ẩn danh khi xoá tài khoản, và các nhãn
 * mặc định kiểu "Khách hàng" — lấy từ cuối của chúng ra "hàng", "xoá" là vô nghĩa.
 */
const PLACEHOLDER_NAMES = new Set(['Khách', 'Khách hàng', 'Khách lẻ', 'Khách Tubu', ANONYMIZED_NAME].map((n) => n.normalize('NFC').toLowerCase()));

/**
 * Tên gọi của người được mời cho tin gửi người mời: chỉ từ cuối của họ tên (tên gọi theo cách viết tên tiếng Việt), không họ,
 * không số điện thoại. Tên mặc định/ẩn danh, tên có chữ số/@ (thường là số điện thoại hay email) hoặc trống thì "bạn bè".
 */
export function maskFriendName(fullName: string | null | undefined): string {
  const words = (fullName ?? '').normalize('NFC').trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  if (!last || PLACEHOLDER_NAMES.has(words.join(' ').toLowerCase())) return FRIEND_FALLBACK;
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
export function referralDedupeKey(key: string): string {
  return `referral:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

/** Sự kiện 0 điểm (thu hồi không trừ gì và không nợ gì) không báo. */
export function isReportableNotice(n: ReferralNotice): boolean {
  if (n.kind === 'REVOKED') return n.taken > 0 || n.debt > 0;
  return n.points > 0;
}

/** Tin MILESTONE và tin thu hồi của người được mời ẩn danh không nêu tên bạn nên không cần đọc tên. */
export function noticeNamesFriend(n: ReferralNotice): n is Exclude<ReferralNotice, { kind: 'MILESTONE' }> {
  return n.kind === 'PAID' || (n.kind === 'REVOKED' && !n.hideFriend);
}

/** Mẫu và dữ liệu của tin: nguồn duy nhất cho đường gửi trực tiếp lẫn cron bù (referral-notice-reconcile). */
export function referralNoticeMessage(n: ReferralNotice, referee: { fullName: string | null } | null): { templateCode: string; data: Record<string, string> } {
  if (n.kind === 'MILESTONE') {
    return { templateCode: 'REFERRAL_MILESTONE_PAID', data: { points: fmt(n.points), count: String(n.count) } };
  }
  const friend = maskFriendName(noticeNamesFriend(n) ? referee?.fullName : null);
  if (n.kind === 'PAID') return { templateCode: 'REFERRAL_REWARD_PAID', data: { points: fmt(n.points), friend } };
  return {
    templateCode: 'REFERRAL_REWARD_REVOKED',
    data: { friend, cause: CAUSE_TEXT[n.cause], detail: revokeDetail(n.taken, n.debt), points: fmt(n.taken), debt: fmt(n.debt) },
  };
}

/**
 * Gửi tin cho người mời. CHỈ gọi sau khi tx ghi sổ đã commit. Best-effort: lỗi đọc tên hay gửi tin chỉ ghi cảnh báo, không bao
 * giờ ném (tiền đã ghi xong; cron referral-notice-reconcile gửi bù tin bị sót). Trả số tin lỗi để cron đếm.
 */
export async function sendReferralNotices(ctx: ReferralNotifyContext, notices: readonly ReferralNotice[]): Promise<number> {
  if (!ctx.notifications || notices.length === 0) return 0;
  let failed = 0;
  for (const n of notices) {
    try {
      if (!isReportableNotice(n)) continue;
      const referee = noticeNamesFriend(n) ? await ctx.prisma.user.findUnique({ where: { id: n.refereeId }, select: { fullName: true } }) : null;
      const { templateCode, data } = referralNoticeMessage(n, referee);
      await ctx.notifications.notify(n.referrerId, templateCode, data, { dedupeKey: referralDedupeKey(n.key) });
    } catch (err) {
      failed += 1;
      ctx.logger.warn(`Chưa báo được người mời ${n.referrerId} về ${n.kind} (${n.key}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return failed;
}
