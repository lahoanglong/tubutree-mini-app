import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

export const UNANSWERED_ALERT_HOURS_KEY = 'community.unanswered_alert_hours';
export const DEFAULT_UNANSWERED_ALERT_HOURS = 24;

const HOUR_MS = 3_600_000;

/** Mốc "đã chờ quá lâu": câu hỏi đăng trước mốc này mà chưa ai trả lời thì lên hàng chờ của CSKH. Giá trị cấu hình sai thì dùng mặc định. */
export function unansweredCutoff(configuredHours: unknown, now: Date): Date {
  const hours =
    typeof configuredHours === 'number' && Number.isFinite(configuredHours) && configuredHours > 0
      ? configuredHours
      : DEFAULT_UNANSWERED_ALERT_HOURS;
  return new Date(now.getTime() - hours * HOUR_MS);
}

/**
 * "Chưa ai trả lời" = chưa có bình luận còn hiện của NGƯỜI KHÁC chủ bài: chủ bài tự bình luận bổ sung không làm câu hỏi hết chờ.
 * Prisma không so cột bài cha với cột bình luận trong lọc quan hệ nên viết SQL thô; một nguồn cho cả số trên "Việc cần xử lý"
 * và danh sách ở tab Cộng đồng để hai nơi không lệch nhau.
 */
const unansweredFrom = (cutoff: Date) => Prisma.sql`
  FROM "feed_posts" p
  WHERE p."kind" = 'QUESTION' AND p."status" = 'PUBLISHED' AND p."createdAt" < ${cutoff}
    AND NOT EXISTS (
      SELECT 1 FROM "feed_comments" c
       WHERE c."postId" = p."id" AND c."isRemoved" = false AND c."userId" <> p."userId")`;

export async function countUnansweredQuestions(prisma: Pick<PrismaService, '$queryRaw'>, cutoff: Date): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS "n" ${unansweredFrom(cutoff)}`);
  return row?.n ?? 0;
}

export interface UnansweredQuestionRow {
  id: string;
  title: string | null;
  excerpt: string;
  createdAt: Date;
  author: string | null;
  category: string | null;
}

/** Cũ nhất trước: câu hỏi chờ lâu nhất cần người trả lời trước. */
export function listUnansweredQuestions(prisma: Pick<PrismaService, '$queryRaw'>, cutoff: Date, take: number): Promise<UnansweredQuestionRow[]> {
  return prisma.$queryRaw<UnansweredQuestionRow[]>(Prisma.sql`
    SELECT p."id", p."title", left(p."body", 200) AS "excerpt", p."createdAt",
           (SELECT u."fullName" FROM "users" u WHERE u."id" = p."userId") AS "author",
           (SELECT cc."name" FROM "community_categories" cc WHERE cc."id" = p."categoryId") AS "category"
    ${unansweredFrom(cutoff)}
    ORDER BY p."createdAt" ASC, p."id" ASC
    LIMIT ${take}`);
}
