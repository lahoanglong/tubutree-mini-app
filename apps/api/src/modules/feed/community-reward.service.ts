import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RewardPointsService } from '../wallet/reward-points.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { startOfVnDay } from '../../common/vn-time';

const MAX_REWARD_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryableTxError(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string } } | null;
  return e?.code === 'P2034' || e?.code === '40001' || e?.code === '40P01' || e?.meta?.code === '40001' || e?.meta?.code === '40P01';
}

/**
 * Thưởng Điểm Xanh cho hoạt động cộng đồng (PD-3, trước đây là TubuXu). Idempotent qua reason +
 * partial unique index (reason WHERE refType='COMMUNITY') ở sổ điểm, và RewardPointsService kiểm thêm
 * dòng cùng reason ở sổ xu cũ. Chỉ thưởng khi bài PUBLISHED (caller đảm bảo).
 *
 * Mức mặc định theo OQ-6: đăng bài 1 điểm (≤ 1/ngày), trả lời 0 (0,1 điểm không biểu diễn được),
 * hay nhất 1 điểm (≤ 3/ngày).
 */
@Injectable()
export class CommunityRewardService {
  private readonly logger = new Logger(CommunityRewardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rewards: RewardPointsService,
    private readonly config: SystemConfigService,
  ) {}

  /** Số điểm thưởng từ config; 0, âm, lẻ hay sai kiểu (admin gõ nhầm) = tắt thưởng đó. */
  private async rewardPoints(key: string, fallback: number): Promise<number> {
    const v = await this.config.get<number>(key, fallback);
    return Number.isInteger(v) && v > 0 ? v : 0;
  }

  /**
   * Đếm-rồi-cấp thưởng với trần số lần/ngày, dùng chung cho rewardPost/rewardAnswer/rewardBestAnswer.
   * Khoá dòng users của người nhận (FOR NO KEY UPDATE: không xung đột với KEY SHARE của dòng sổ có FK
   * tới users, nên không deadlock với các tx đang chèn) rồi đếm + cấp ở READ COMMITTED: cùng một người
   * bị tuần tự hoá nên không thể cùng đọc chung 1 todayCount rồi cùng lọt qua trần, còn NGƯỜI KHÁC NHAU
   * không chặn nhau (Serializable trước đây ném P2034 chéo giữa các người dùng và việc nuốt lỗi làm mất
   * thưởng của người không hề spam). Hạn điểm đọc TRƯỚC tx (đọc config trong tx xin thêm một kết nối pool).
   * Đếm cả sổ xu cũ: thưởng bằng xu trong ngày deploy vẫn tính vào trần ngày đó.
   * Lỗi tạm (deadlock 40P01 / tuần tự hoá 40001/P2034) thì thử lại; hết lượt thử thì log cảnh báo.
   */
  private async rewardWithDailyCap(
    userId: string,
    reasonPrefix: string,
    refId: string,
    points: number,
    cap: number,
  ): Promise<void> {
    const since = startOfVnDay();
    const expiresAt = await this.rewards.expiresAt();
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
          const where = { userId, refType: 'COMMUNITY', reason: { startsWith: `${reasonPrefix}:` }, createdAt: { gte: since } };
          const [coinToday, pointsToday] = await Promise.all([
            tx.coinTransaction.count({ where }),
            tx.pointsTransaction.count({ where }),
          ]);
          if (coinToday + pointsToday >= cap) return;
          await this.rewards.grant(userId, points, `${reasonPrefix}:${refId}`, 'COMMUNITY', refId, tx, expiresAt);
        });
        return;
      } catch (err) {
        if (!isRetryableTxError(err)) throw err;
        if (attempt >= MAX_REWARD_ATTEMPTS) {
          this.logger.warn(`Bỏ thưởng ${reasonPrefix}:${refId} user=${userId} sau ${attempt} lần xung đột giao dịch: ${(err as Error).message}`);
          return;
        }
        await sleep(20 * attempt + Math.random() * 40);
      }
    }
  }

  /** Thưởng khi bài được đăng công khai. Trần số lần/ngày để chống spam (xem rewardWithDailyCap). */
  async rewardPost(userId: string, postId: string): Promise<void> {
    const points = await this.rewardPoints('community.post_reward_points', 1);
    if (points <= 0) return;
    const cap = await this.config.get<number>('community.daily_post_reward_cap', 1);
    await this.rewardWithDailyCap(userId, 'COMMUNITY_POST', postId, points, cap);
  }

  /**
   * Thưởng người trả lời (không thưởng khi tự trả lời bài của chính mình). Trần số lần/ngày
   * để chống farm điểm (xem rewardWithDailyCap). Mặc định tắt (0 điểm).
   */
  async rewardAnswer(answererId: string, postAuthorId: string, commentId: string): Promise<void> {
    if (answererId === postAuthorId) return;
    const points = await this.rewardPoints('community.answer_reward_points', 0);
    if (points <= 0) return;
    const cap = await this.config.get<number>('community.daily_answer_reward_cap', 10);
    await this.rewardWithDailyCap(answererId, 'COMMUNITY_ANSWER', commentId, points, cap);
  }

  /**
   * Thưởng khi câu trả lời được chọn hay nhất (không thưởng nếu trỏ chính chủ bài).
   * Idempotent THEO BÀI (postId), KHÔNG theo comment — chủ bài đổi best-answer sang
   * comment khác (hợp lệ, sửa lựa chọn) không cấp thưởng lần 2 (partial unique index
   * reason WHERE refType='COMMUNITY' → grant bỏ qua; bài đã thưởng bằng xu trước gộp cũng bị
   * chặn vì grant kiểm dòng cùng reason ở sổ xu). Nếu key theo commentId, đổi best-answer liên tục
   * giữa nhiều tài khoản phụ farm được điểm vô hạn.
   *
   * NHƯNG idempotency theo postId chỉ chặn farm trên CÙNG 1 bài: tài khoản phụ đăng N bài
   * QUESTION rồi chọn best-answer cho nhau ở cả N bài vẫn ăn N×reward (mỗi bài 1 reason
   * khác nhau). Vì vậy phải đi qua rewardWithDailyCap giống rewardPost/rewardAnswer —
   * xem P1-2 trong docs/2026-09-08-review-progress.md.
   */
  async rewardBestAnswer(answererId: string, postAuthorId: string, postId: string): Promise<void> {
    if (answererId === postAuthorId) return;
    const points = await this.rewardPoints('community.best_answer_reward_points', 1);
    if (points <= 0) return;
    const cap = await this.config.get<number>('community.daily_best_answer_cap', 3);
    await this.rewardWithDailyCap(answererId, 'COMMUNITY_BEST', postId, points, cap);
  }

  /**
   * Thưởng người thắng sự kiện cộng đồng (Pha 4), `points` = CommunityEvent.rewardPoints.
   * Idempotent qua reason (partial unique index refType='COMMUNITY').
   */
  async rewardEventWinner(userId: string, eventId: string, points: number): Promise<void> {
    if (!(points > 0)) return;
    await this.rewards.grant(userId, points, `COMMUNITY_EVENT_WIN:${eventId}:${userId}`, 'COMMUNITY', eventId);
  }
}
