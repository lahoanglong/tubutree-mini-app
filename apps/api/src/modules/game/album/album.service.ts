import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import {
  ALBUM_BADGE_IDS,
  MINI_ERROR_CODES,
  MINI_MIN_ROUND_MS,
  MINI_ROUND_TTL_MS,
  type AlbumBadgeId,
  type MiniErrorCode,
} from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { vnDateKey } from '../../../common/vn-time';
import { GameMiniContentService } from '../mini/game-mini-content.service';
import { BADGES_ENABLED_KEY, readEngagementFlag } from '../missions/daily-missions';
import { MINI_ENABLED_KEY, readFlag } from '../mini/game-mini.settings';
import {
  ALBUM_CACHE_MAX_USERS,
  ALBUM_CACHE_MS,
  ALBUM_ENABLED_KEY,
  ALBUM_GAME_TOPIC,
  ALBUM_GAMES,
  ALBUM_REVIEW_ITEMS,
  ALBUM_REVIEWS_PER_DAY,
  ALBUM_TOPIC_IDS,
  isAlbumGame,
  type AlbumTopicId,
} from './album.constants';
import { albumProductSlugs, buildQuestion, cardText, relatedProduct, sortBinsFor, type AlbumContent, type AlbumItem, type AlbumQuestion } from './album-cards';
import { ALBUM_MASTER_10, grantAlbumBadgeSql } from './album-badges';
import { ALBUM_MESSAGES } from './album-notice';
import { albumStatsSql, levelOf, newCardsIn, reviewCandidates, type AlbumStatRow } from './album-stats';
import type { AlbumBadge, AlbumCard, AlbumResponse, AlbumReviewStartResponse, AlbumReviewSubmitResponse, AlbumTopicSummary } from './album.types';

const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/** [0, 1) từ bộ sinh số của hệ điều hành: thứ tự lựa chọn của câu ôn không đoán trước được. */
const cryptoRng = (): number => randomInt(0, 2 ** 47) / 2 ** 47;

function albumError(status: HttpStatus, code: MiniErrorCode, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

interface LastRound {
  id: string;
  contentIds: string[];
  submittedAt: Date | null;
}

interface UserStats {
  rows: AlbumStatRow[];
  byId: Map<string, AlbumStatRow>;
  last: LastRound | null;
}

/** Câu ôn đọc lại từ JSON đã lưu; null khi dữ liệu không đúng dạng (không chấm theo dữ liệu hỏng). */
export function readQuestions(raw: unknown): AlbumQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > ALBUM_REVIEW_ITEMS) return null;
  const out: AlbumQuestion[] = [];
  for (const q of raw as Record<string, unknown>[]) {
    if (!q || typeof q.id !== 'string' || typeof q.prompt !== 'string' || !Array.isArray(q.options)) return null;
    const options = q.options as unknown[];
    if (options.length < 2 || !options.every((o) => typeof o === 'string')) return null;
    if (typeof q.answer !== 'number' || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= options.length) return null;
    out.push({
      id: q.id,
      prompt: q.prompt,
      options: options as string[],
      answer: q.answer,
      explanation: typeof q.explanation === 'string' ? q.explanation : '',
      sourceUrl: typeof q.sourceUrl === 'string' ? q.sourceUrl : '',
      productSlug: typeof q.productSlug === 'string' ? q.productSlug : null,
    });
  }
  return out;
}

/**
 * Sổ tay Xanh (cờ `game.album_enabled`, cần thêm `game.mini.enabled`): mỗi mục nội dung khách đã gặp trong game mini thành một thẻ, tính lúc đọc từ
 * các ván ĐÃ NỘP. Ván "Ôn 5 thẻ" ghi vào bảng riêng `game_album_reviews`, không bao giờ ghi `game_play_rounds`: không thưởng, không nhiệm vụ, không
 * chuỗi, không trần nào đếm nó. Service này không gọi sổ điểm, ví hay 💧.
 */
@Injectable()
export class GameAlbumService {
  private content: { at: number; value: Promise<AlbumContent> } | null = null;
  private readonly userCache = new Map<string, { at: number; fingerprint: string; rows: AlbumStatRow[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly miniContent: GameMiniContentService,
  ) {}

  /** Cờ tắt: mọi route trả 404 như route không có, kể cả với khách chưa đăng nhập. */
  private async assertOn(): Promise<void> {
    const [album, mini] = await Promise.all([this.config.get<unknown>(ALBUM_ENABLED_KEY, false), this.config.get<unknown>(MINI_ENABLED_KEY, false)]);
    if (!readFlag(album) || !readFlag(mini)) throw albumError(HttpStatus.NOT_FOUND, MINI_ERROR_CODES.disabled, ALBUM_MESSAGES.disabled);
  }

  private requireUser(userId: string | null): string {
    if (!userId) throw albumError(HttpStatus.UNAUTHORIZED, MINI_ERROR_CODES.loginRequired, ALBUM_MESSAGES.login);
    return userId;
  }

  /** Mục có vào sổ (game có vào sổ, đã kiểm nguồn; cả mục đã tắt để giữ thẻ cũ) và thẻ sản phẩm của chúng. Dùng chung mọi khách, đệm 60 giây. */
  async loadContent(now: Date = new Date()): Promise<AlbumContent> {
    if (this.content && now.getTime() - this.content.at < ALBUM_CACHE_MS) return this.content.value;
    const value = (async () => {
      const rows = await this.prisma.gameContentItem.findMany({
        where: { game: { in: ALBUM_GAMES }, sourceCheckedAt: { not: null } },
        select: { id: true, game: true, payload: true, explanation: true, sourceUrl: true, productSlug: true, active: true },
      });
      const items = new Map<string, AlbumItem>();
      for (const r of rows) {
        if (!isAlbumGame(r.game)) continue;
        items.set(r.id, { id: r.id, game: r.game, payload: r.payload, explanation: r.explanation, sourceUrl: r.sourceUrl, productSlug: r.productSlug, active: r.active });
      }
      const products = await this.miniContent.products([...items.values()].flatMap(albumProductSlugs));
      return { items, products, sortBins: sortBinsFor(items.values()) };
    })();
    this.content = { at: now.getTime(), value };
    value.catch(() => {
      if (this.content?.value === value) this.content = null;
    });
    return value;
  }

  /**
   * Thống kê theo mục của một khách. Đệm 60 giây theo người, kèm dấu vân tay (ván thường gần nhất của game có vào sổ, lần nộp ván ôn gần nhất): nộp
   * ván ở bất kỳ đâu đổi dấu vân tay nên lần đọc sau tính lại, không phải sửa luồng nộp ván của game mini.
   */
  private async userStats(userId: string, now: Date): Promise<UserStats> {
    const [last, review] = await Promise.all([
      this.prisma.gamePlayRound.findFirst({
        where: { userId, game: { in: ALBUM_GAMES }, submittedAt: { not: null } },
        orderBy: { submittedAt: 'desc' },
        select: { id: true, contentIds: true, submittedAt: true },
      }),
      this.prisma.gameAlbumReview.findFirst({ where: { userId, submittedAt: { not: null } }, orderBy: { submittedAt: 'desc' }, select: { submittedAt: true } }),
    ]);
    const fingerprint = `${last?.id ?? ''}|${last?.submittedAt?.getTime() ?? ''}|${review?.submittedAt?.getTime() ?? ''}`;
    const hit = this.userCache.get(userId);
    let rows: AlbumStatRow[];
    if (hit && hit.fingerprint === fingerprint && now.getTime() - hit.at < ALBUM_CACHE_MS) {
      rows = hit.rows;
    } else {
      rows = last || review ? await this.prisma.$queryRaw<AlbumStatRow[]>(albumStatsSql(userId)) : [];
      if (this.userCache.size >= ALBUM_CACHE_MAX_USERS) this.userCache.clear();
      this.userCache.set(userId, { at: now.getTime(), fingerprint, rows });
    }
    return { rows, byId: new Map(rows.map((r) => [r.cid, r])), last };
  }

  invalidate(userId: string): void {
    this.userCache.delete(userId);
  }

  private dueCount(stats: UserStats, content: AlbumContent, today: string, reviewedToday: ReadonlySet<string>): number {
    return reviewCandidates(stats.rows, content.items, today, reviewedToday).filter((id) => buildQuestion(content.items.get(id)!, content, Math.random) !== null).length;
  }

  /**
   * Huy hiệu thuộc bài (0 điểm, chỉ ghi nhận): đọc dòng đã có; huy hiệu mà số thẻ thuộc vừa đủ thì chạy câu cấp của nó (cùng câu với job, SQL là
   * nguồn đúng), rồi đọc lại. Cấp như hạ tầng huy hiệu: chỉ khi `engagement.badges_enabled` bật.
   */
  private async badges(userId: string, now: Date, reach: Record<AlbumBadgeId, boolean>): Promise<AlbumBadge[]> {
    const read = () => this.prisma.userBadge.findMany({ where: { userId, badge: { in: [...ALBUM_BADGE_IDS] } }, select: { badge: true, earnedAt: true } });
    let rows = await read();
    const have = new Set(rows.map((r) => r.badge));
    const missing = ALBUM_BADGE_IDS.filter((b) => reach[b] && !have.has(b));
    if (missing.length > 0 && (await readEngagementFlag(this.config, BADGES_ENABLED_KEY))) {
      for (const b of missing) await this.prisma.$executeRaw(grantAlbumBadgeSql(b, userId, now));
      rows = await read();
    }
    const earned = new Map(rows.map((r) => [r.badge, r.earnedAt]));
    return ALBUM_BADGE_IDS.map((id) => {
      const at = earned.get(id);
      return { id, earned: at !== undefined, earnedAt: at ? at.toISOString() : null };
    });
  }

  async album(userIdParam: string | null, opts: { summary?: boolean } = {}, now: Date = new Date()): Promise<AlbumResponse> {
    await this.assertOn();
    const userId = this.requireUser(userIdParam);
    const today = vnDateKey(now);
    const [content, stats, todays] = await Promise.all([
      this.loadContent(now),
      this.userStats(userId, now),
      this.prisma.gameAlbumReview.findMany({ where: { userId, dayKey: today }, select: { contentIds: true, submittedAt: true, expiresAt: true } }),
    ]);

    const topics = new Map<AlbumTopicId, AlbumTopicSummary>(ALBUM_TOPIC_IDS.map((id) => [id, { id, total: 0, seen: 0, mastered: 0 }]));
    let masteredAll = 0;
    for (const item of content.items.values()) {
      const level = levelOf(stats.byId.get(item.id));
      if (level === 3) masteredAll += 1;
      if (!item.active) continue;
      const t = topics.get(ALBUM_GAME_TOPIC[item.game])!;
      t.total += 1;
      if (level > 0) t.seen += 1;
      if (level === 3) t.mastered += 1;
    }
    const list = [...topics.values()].filter((t) => t.total > 0 || stats.rows.some((r) => content.items.get(r.cid) && ALBUM_GAME_TOPIC[content.items.get(r.cid)!.game] === t.id));
    const sum = (k: 'total' | 'seen' | 'mastered') => list.reduce((s, t) => s + t[k], 0);

    const cards: AlbumCard[] = [];
    if (!opts.summary) {
      for (const row of stats.rows) {
        const item = content.items.get(row.cid);
        const text = item ? cardText(item, content.products) : null;
        if (!item || !text) continue;
        cards.push({
          id: item.id,
          topic: ALBUM_GAME_TOPIC[item.game],
          game: item.game,
          level: levelOf(row) as 1 | 2 | 3,
          seen: row.seen,
          correct: row.correct,
          lastSeenDay: row.lastSeenDay,
          title: text.title,
          answer: text.answer,
          explanation: item.explanation,
          sourceUrl: item.sourceUrl,
          product: relatedProduct(item, content.products),
          retired: !item.active,
        });
      }
      const order = new Map(ALBUM_TOPIC_IDS.map((t, i) => [t, i]));
      cards.sort((a, b) => order.get(a.topic)! - order.get(b.topic)! || (a.lastSeenDay < b.lastSeenDay ? 1 : a.lastSeenDay > b.lastSeenDay ? -1 : a.id < b.id ? -1 : 1));
    }

    const reviewedToday = new Set(todays.flatMap((r) => r.contentIds));
    const open = todays.find((r) => r.submittedAt === null && r.expiresAt > now);
    const left = Math.max(0, ALBUM_REVIEWS_PER_DAY - todays.length);
    const due = this.dueCount(stats, content, today, reviewedToday);
    const last = stats.last?.submittedAt ? { roundId: stats.last.id, newCards: newCardsIn(stats.last.contentIds, stats.last.submittedAt, stats.byId, content.items) } : null;
    const reach: Record<AlbumBadgeId, boolean> = {
      ALBUM_MASTER_10: masteredAll >= ALBUM_MASTER_10,
      ALBUM_TOPIC: list.some((t) => t.total > 0 && t.mastered >= t.total),
      ALBUM_ALL: sum('total') > 0 && sum('mastered') >= sum('total'),
    };
    return {
      dayKey: today,
      total: sum('total'),
      seen: sum('seen'),
      mastered: sum('mastered'),
      topics: list,
      cards,
      // Ván ôn đang mở: "Ôn n thẻ" bắt đầu lại đúng ván đó (n = số câu đã phát), kể cả khi nó là ván cuối của trần trong ngày.
      review: open ? { due: open.contentIds.length, leftToday: Math.max(left, 1) } : { due, leftToday: left },
      lastRound: last,
      badges: await this.badges(userId, now, reach),
    };
  }

  /**
   * Phát ván "Ôn 5 thẻ". Khoá `users` như lúc phát ván game mini: hai lần bấm song song xếp hàng, lần sau nhận lại đúng ván đang mở. Ván ôn ghi vào
   * `game_album_reviews`, không có ô thưởng, không 💧, không Điểm Xanh.
   */
  async startReview(userIdParam: string | null, now: Date = new Date()): Promise<AlbumReviewStartResponse> {
    await this.assertOn();
    const userId = this.requireUser(userIdParam);
    const today = vnDateKey(now);
    const [content, stats] = await Promise.all([this.loadContent(now), this.userStats(userId, now)]);
    const review = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const open = await tx.gameAlbumReview.findFirst({ where: { userId, submittedAt: null, expiresAt: { gt: now } }, orderBy: { issuedAt: 'desc' } });
      if (open) return open;
      const todays = await tx.gameAlbumReview.findMany({ where: { userId, dayKey: today }, select: { contentIds: true } });
      if (todays.length >= ALBUM_REVIEWS_PER_DAY) throw albumError(HttpStatus.TOO_MANY_REQUESTS, MINI_ERROR_CODES.roundLimit, ALBUM_MESSAGES.limit);
      const reviewed = new Set(todays.flatMap((r) => r.contentIds));
      const questions: AlbumQuestion[] = [];
      for (const id of reviewCandidates(stats.rows, content.items, today, reviewed)) {
        const q = buildQuestion(content.items.get(id)!, content, cryptoRng);
        if (q) questions.push(q);
        if (questions.length === ALBUM_REVIEW_ITEMS) break;
      }
      if (questions.length === 0) throw albumError(HttpStatus.NOT_FOUND, MINI_ERROR_CODES.noContent, ALBUM_MESSAGES.nothingDue);
      return tx.gameAlbumReview.create({
        data: {
          userId,
          dayKey: today,
          contentIds: questions.map((q) => q.id),
          questions: questions as unknown as Prisma.InputJsonValue,
          issuedAt: now,
          expiresAt: new Date(now.getTime() + MINI_ROUND_TTL_MS),
        },
      });
    }, TX_OPTIONS);
    const questions = readQuestions(review.questions);
    if (!questions) throw albumError(HttpStatus.NOT_FOUND, MINI_ERROR_CODES.roundNotFound, ALBUM_MESSAGES.notFound);
    return {
      game: 'daily_quiz',
      roundId: review.id,
      token: null,
      issuedAt: review.issuedAt.toISOString(),
      expiresAt: review.expiresAt.toISOString(),
      rewarded: false,
      noRewardReason: null,
      content: { game: 'daily_quiz', items: questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options, product: null })) },
    };
  }

  /** Chấm ván ôn đúng một lần (`submittedAt` IS NULL trong câu cập nhật): nộp đúp hay song song chỉ một lần thắng, lần kia 409. */
  async submitReview(userIdParam: string | null, input: { roundId: string; answers: unknown[] }, now: Date = new Date()): Promise<AlbumReviewSubmitResponse> {
    await this.assertOn();
    const userId = this.requireUser(userIdParam);
    const review = await this.prisma.gameAlbumReview.findUnique({ where: { id: input.roundId } });
    if (!review || review.userId !== userId) throw albumError(HttpStatus.NOT_FOUND, MINI_ERROR_CODES.roundNotFound, ALBUM_MESSAGES.notFound);
    if (review.submittedAt) throw albumError(HttpStatus.CONFLICT, MINI_ERROR_CODES.roundSubmitted, ALBUM_MESSAGES.submitted);
    const durationMs = now.getTime() - review.issuedAt.getTime();
    if (durationMs > MINI_ROUND_TTL_MS) throw albumError(HttpStatus.BAD_REQUEST, MINI_ERROR_CODES.roundExpired, ALBUM_MESSAGES.expired);
    if (durationMs < MINI_MIN_ROUND_MS) throw albumError(HttpStatus.BAD_REQUEST, MINI_ERROR_CODES.tooFast, ALBUM_MESSAGES.tooFast);
    const questions = readQuestions(review.questions);
    const answers = input.answers;
    const valid =
      questions !== null &&
      answers.length === questions.length &&
      answers.every((a, i) => a === null || (typeof a === 'number' && Number.isInteger(a) && a >= 0 && a < questions[i]!.options.length));
    if (!valid) throw albumError(HttpStatus.BAD_REQUEST, MINI_ERROR_CODES.answersInvalid, ALBUM_MESSAGES.invalid);
    const items = questions.map((q, i) => {
      const given = (answers[i] as number | null) ?? null;
      return {
        contentId: q.id,
        prompt: q.prompt,
        given,
        expected: q.answer,
        correct: given === q.answer,
        explanation: q.explanation,
        sourceUrl: q.sourceUrl,
        productSlug: q.productSlug,
      };
    });
    const correctIds = items.filter((x) => x.correct).map((x) => x.contentId);
    const { count } = await this.prisma.gameAlbumReview.updateMany({
      where: { id: review.id, submittedAt: null },
      data: { submittedAt: now, correctIds, correct: correctIds.length, total: items.length },
    });
    if (count === 0) throw albumError(HttpStatus.CONFLICT, MINI_ERROR_CODES.roundSubmitted, ALBUM_MESSAGES.submitted);
    this.invalidate(userId);
    return {
      game: 'daily_quiz',
      roundId: review.id,
      correct: correctIds.length,
      total: items.length,
      durationMs,
      rewarded: false,
      noRewardReason: null,
      baseWater: 0,
      basePoints: 0,
      water: 0,
      points: 0,
      capped: [],
      totalSeeds: null,
      checkIn: null,
      review: { game: 'daily_quiz', items },
    };
  }
}
