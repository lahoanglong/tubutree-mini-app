import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type GameContentItem } from '@prisma/client';
import { MINI_GAME_IDS, MINI_MIN_ACTIVE_ITEMS, type MiniContentGameId, type MiniGameId } from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { paginated } from '../../../common/pagination';
import { vnDateKey } from '../../../common/vn-time';
import { GameMiniContentService, LEGACY_QUIZ_PREFIX } from './game-mini-content.service';
import { readMiniSettings } from './game-mini.settings';
import { MINI_GAMES, type MiniContentRow } from './games';
import { ARCADE_ID_PREFIX } from './games/arcade';
import { SLUG_RE, isRecord } from './games/game-def';
import { MATCHER_GAME, matcherPayloadError } from './matcher/matcher.rules';

/** Loại mục do máy chủ đặt theo game (cột `kind`), admin không gửi. Game thao tác (Ghép Mầm Xanh, Băng Chuyền Xanh) không có mục. */
export const MINI_CONTENT_KIND: Record<MiniContentGameId, string> = {
  sort: 'sort_item',
  daily_quiz: 'quiz_question',
  match: 'match_pair',
  origin: 'origin_question',
  basket: 'basket_task',
  kitchen_swap: 'kitchen_swap_item',
};

export const MINI_EXPLANATION_MAX = 220;
const SOURCE_URL_MAX = 500;
const PAYLOAD_JSON_MAX = 4_000;
const STATS_DAYS_MAX = 60;
const STATS_ITEMS_MAX = 200;

export interface MiniContentCreateInput {
  game: MiniContentGameId;
  payload: unknown;
  explanation: string;
  sourceUrl: string;
  sourceCheckedAt?: string | null;
  productSlug?: string | null;
  active?: boolean;
}

export type MiniContentUpdateInput = Partial<Omit<MiniContentCreateInput, 'game'>>;

/** Game được lọc ở màn duyệt: 6 game mini và "Chọn Chuẩn Xanh" (nội dung `game = 'matcher'`, chỉ bật/tắt và sửa, không thêm từ admin). */
export type MiniContentGameFilter = MiniGameId | typeof MATCHER_GAME;

export interface MiniContentListQuery {
  game?: MiniContentGameFilter;
  active?: boolean;
  page: number;
  limit: number;
}

function bad(message: string): BadRequestException {
  return new BadRequestException(message);
}

function checkSourceUrl(raw: string): string {
  const url = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw bad('Link nguồn chưa đúng dạng. Dán đầy đủ link bắt đầu bằng https://');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.') || url.length > SOURCE_URL_MAX) {
    throw bad(`Link nguồn phải là link https:// đầy đủ, tối đa ${SOURCE_URL_MAX} ký tự.`);
  }
  return url;
}

function checkExplanation(raw: string): string {
  const t = raw.trim();
  if (t.length < 1 || t.length > MINI_EXPLANATION_MAX) throw bad(`Lời giải thích cần 1–${MINI_EXPLANATION_MAX} ký tự.`);
  return t;
}

function checkProductSlug(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const t = raw.trim();
  if (t === '') return null;
  if (t.length > 160 || !SLUG_RE.test(t)) throw bad('Mã sản phẩm (slug) chỉ gồm chữ thường không dấu, số và dấu gạch ngang.');
  return t;
}

function checkCheckedAt(raw: string | null | undefined): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) throw bad('Ngày kiểm nguồn cần dạng YYYY-MM-DD.');
  const d = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw bad('Ngày kiểm nguồn cần dạng YYYY-MM-DD.');
  return d;
}

function checkPayload(game: MiniGameId, payload: unknown): Prisma.InputJsonValue {
  if (!isRecord(payload)) throw bad('Nội dung mục phải là một đối tượng JSON.');
  if (JSON.stringify(payload).length > PAYLOAD_JSON_MAX) throw bad(`Nội dung mục quá dài (tối đa ${PAYLOAD_JSON_MAX} ký tự JSON).`);
  const err = MINI_GAMES[game].payloadError(payload);
  if (err) throw bad(err);
  return payload as Prisma.InputJsonValue;
}

function checkMatcherPayload(kind: string, payload: unknown): Prisma.InputJsonValue {
  if (!isRecord(payload)) throw bad('Nội dung mục phải là một đối tượng JSON.');
  if (JSON.stringify(payload).length > PAYLOAD_JSON_MAX) throw bad(`Nội dung mục quá dài (tối đa ${PAYLOAD_JSON_MAX} ký tự JSON).`);
  const err = matcherPayloadError(kind, payload);
  if (err) throw bad(err);
  return payload as Prisma.InputJsonValue;
}

/** Nhãn ngắn để bảng số đọc được: câu hỏi, tên vật, nguyên liệu hoặc đề giỏ. */
function labelOf(payload: unknown): string {
  if (!isRecord(payload)) return '';
  for (const key of ['prompt', 'label', 'ingredient', 'task', 'title', 'item'] as const) {
    const v = payload[key];
    if (typeof v === 'string') return v.slice(0, 120);
  }
  return '';
}

/**
 * Nội dung 6 game mini cho ADMIN: thêm, sửa, bật/tắt từng mục (không xoá: ván đã phát vẫn phải chấm được mục cũ) và bảng số.
 * Mục mới mặc định TẮT; sửa nội dung tăng `version`. Mỗi game cần ít nhất `MINI_MIN_ACTIVE_ITEMS` mục bật mới hiện cho khách.
 */
@Injectable()
export class GameMiniAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly content: GameMiniContentService,
  ) {}

  private async withUsable(rows: GameContentItem[]) {
    const toRow = (r: GameContentItem): MiniContentRow => ({
      id: r.id,
      game: r.game as MiniGameId,
      payload: r.payload,
      explanation: r.explanation,
      sourceUrl: r.sourceUrl,
      productSlug: r.productSlug,
    });
    const slugs = rows.flatMap((r) => (MINI_GAMES[r.game as MiniGameId] ? MINI_GAMES[r.game as MiniGameId].productSlugs(toRow(r)) : []));
    const products = await this.content.products(slugs);
    const ctx = { rng: Math.random, dayKey: vnDateKey(), products };
    return rows.map((r) => {
      if (r.game === MATCHER_GAME) {
        const payloadError = matcherPayloadError(r.kind, r.payload);
        return { ...r, payloadError, usableToday: payloadError === null };
      }
      const def = MINI_GAMES[r.game as MiniGameId];
      return {
        ...r,
        payloadError: def ? def.payloadError(r.payload) : 'Game không còn tồn tại.',
        /** Mục đủ điều kiện phát hôm nay (đề Giỏ Đúng Việc cần cả 6 sản phẩm còn hàng). */
        usableToday: def ? def.usable(toRow(r), ctx) : false,
      };
    });
  }

  async list(q: MiniContentListQuery) {
    const where: Prisma.GameContentItemWhereInput = {
      ...(q.game ? { game: q.game } : {}),
      ...(q.active !== undefined ? { active: q.active } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.gameContentItem.findMany({
        where,
        orderBy: [{ game: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.gameContentItem.count({ where }),
    ]);
    return paginated(await this.withUsable(rows), q.page, q.limit, total);
  }

  async create(input: MiniContentCreateInput) {
    const payload = checkPayload(input.game, input.payload);
    const row = await this.prisma.gameContentItem.create({
      data: {
        game: input.game,
        kind: MINI_CONTENT_KIND[input.game],
        payload,
        explanation: checkExplanation(input.explanation),
        sourceUrl: checkSourceUrl(input.sourceUrl),
        sourceCheckedAt: checkCheckedAt(input.sourceCheckedAt),
        productSlug: checkProductSlug(input.productSlug),
        active: input.active ?? false,
      },
    });
    return (await this.withUsable([row]))[0]!;
  }

  async update(id: string, input: MiniContentUpdateInput) {
    const current = await this.prisma.gameContentItem.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Không tìm thấy mục nội dung này.');
    const game = current.game as MiniGameId;
    const matcher = current.game === MATCHER_GAME;
    if (!matcher && !MINI_GAMES[game]) throw bad('Game của mục này không còn tồn tại.');
    const check = (payload: unknown) => (matcher ? checkMatcherPayload(current.kind, payload) : checkPayload(game, payload));

    const data: Prisma.GameContentItemUpdateInput = {};
    if (input.payload !== undefined) data.payload = check(input.payload);
    if (input.explanation !== undefined) data.explanation = checkExplanation(input.explanation);
    if (input.sourceUrl !== undefined) data.sourceUrl = checkSourceUrl(input.sourceUrl);
    if (input.sourceCheckedAt !== undefined) data.sourceCheckedAt = checkCheckedAt(input.sourceCheckedAt);
    if (input.productSlug !== undefined) data.productSlug = checkProductSlug(input.productSlug);
    if (input.active !== undefined) {
      // Mục nhập trước khi luật đổi có thể không còn hợp lệ: không bật mục máy chủ không chấm được.
      if (input.active && input.payload === undefined) check(current.payload);
      data.active = input.active;
    }
    const contentChanged = (['payload', 'explanation', 'sourceUrl', 'productSlug'] as const).some((k) => data[k] !== undefined);
    if (contentChanged) data.version = { increment: 1 };
    if (Object.keys(data).length === 0) return (await this.withUsable([current]))[0]!;
    const row = await this.prisma.gameContentItem.update({ where: { id }, data });
    return (await this.withUsable([row]))[0]!;
  }

  /**
   * Bảng số `days` ngày gần nhất (theo ngày VN): người chơi/ngày, ván, thưởng đã phát so ngân sách điểm, tỉ lệ đúng theo mục và tình
   * trạng kho từng game (dưới `MINI_MIN_ACTIVE_ITEMS` mục bật thì game tự ẩn).
   */
  async stats(daysRaw: number, now: Date = new Date()) {
    const days = Math.min(Math.max(Math.floor(daysRaw) || 14, 1), STATS_DAYS_MAX);
    const today = vnDateKey(now);
    const from = vnDateKey(new Date(now.getTime() - (days - 1) * 86_400_000));
    const settings = await readMiniSettings(this.config);

    // Chọn Chuẩn Xanh chỉ ghi lượt có thưởng (đăng nhập, game mini bật, có mã thiết bị) và để `submittedAt` trống: không tính vào số ván game
    // mini theo ngày; ở bảng theo game thì mỗi dòng của nó là một lượt có thưởng.
    const [perDay, perGame, global, items, pools] = await Promise.all([
      this.prisma.$queryRaw<Array<{ dayKey: string; players: bigint; rounds: bigint; submitted: bigint; rewarded: bigint }>>`
        SELECT "dayKey",
               COUNT(DISTINCT "userId") FILTER (WHERE "submittedAt" IS NOT NULL) AS players,
               COUNT(*) AS rounds,
               COUNT(*) FILTER (WHERE "submittedAt" IS NOT NULL) AS submitted,
               COUNT(*) FILTER (WHERE "submittedAt" IS NOT NULL AND "slot" IS NOT NULL) AS rewarded
          FROM "game_play_rounds" WHERE "dayKey" >= ${from} AND "dayKey" <= ${today} AND "game" <> ${MATCHER_GAME}
         GROUP BY "dayKey" ORDER BY "dayKey" DESC`,
      this.prisma.$queryRaw<
        Array<{ dayKey: string; game: string; players: bigint; submitted: bigint; water: bigint | null; points: bigint | null; capped: bigint }>
      >`
        SELECT "dayKey", "game",
               COUNT(DISTINCT "userId") FILTER (WHERE "submittedAt" IS NOT NULL OR "game" = ${MATCHER_GAME}) AS players,
               COUNT(*) FILTER (WHERE "submittedAt" IS NOT NULL OR "game" = ${MATCHER_GAME}) AS submitted,
               SUM("waterAwarded") AS water,
               SUM("pointsAwarded") AS points,
               COUNT(*) FILTER (WHERE "cappedBy" IS NOT NULL) AS capped
          FROM "game_play_rounds" WHERE "dayKey" >= ${from} AND "dayKey" <= ${today}
         GROUP BY "dayKey", "game" ORDER BY "dayKey" DESC, "game"`,
      this.prisma.gameGlobalDaily.findMany({ where: { dayKey: { gte: from, lte: today } }, orderBy: { dayKey: 'desc' } }),
      // Ván Chọn Chuẩn Xanh không có đáp án đúng (contentIds là mã bộ kết quả): tính vào thì tỉ lệ đúng của bộ luôn là 0. Game thao tác
      // ghi một id mục ảo (`arcade:`) không có câu để xem tỉ lệ đúng.
      this.prisma.$queryRaw<Array<{ contentId: string; game: string; shown: bigint; correct: bigint }>>`
        SELECT c."contentId", r."game",
               COUNT(*) AS shown,
               COUNT(*) FILTER (WHERE c."contentId" = ANY(r."correctIds")) AS correct
          FROM "game_play_rounds" r CROSS JOIN LATERAL unnest(r."contentIds") AS c("contentId")
         WHERE r."submittedAt" IS NOT NULL AND r."dayKey" >= ${from} AND r."dayKey" <= ${today} AND r."game" <> ${MATCHER_GAME}
           AND c."contentId" NOT LIKE ${`${ARCADE_ID_PREFIX}%`}
         GROUP BY c."contentId", r."game"
         ORDER BY COUNT(*) DESC, c."contentId"
         LIMIT ${STATS_ITEMS_MAX}`,
      Promise.all(MINI_GAME_IDS.map((g) => this.content.pool(g, today))),
    ]);

    const plainIds = items.map((i) => i.contentId).filter((id) => !id.startsWith(LEGACY_QUIZ_PREFIX));
    const legacyIds = items.map((i) => i.contentId).filter((id) => id.startsWith(LEGACY_QUIZ_PREFIX)).map((id) => id.slice(LEGACY_QUIZ_PREFIX.length));
    const [plain, legacy] = await Promise.all([
      plainIds.length ? this.prisma.gameContentItem.findMany({ where: { id: { in: plainIds } }, select: { id: true, payload: true, active: true } }) : [],
      legacyIds.length ? this.prisma.gameQuiz.findMany({ where: { id: { in: legacyIds } }, select: { id: true, question: true } }) : [],
    ]);
    const labels = new Map<string, { label: string; active: boolean | null }>([
      ...plain.map((r) => [r.id, { label: labelOf(r.payload), active: r.active }] as const),
      ...legacy.map((r) => [`${LEGACY_QUIZ_PREFIX}${r.id}`, { label: r.question.slice(0, 120), active: null }] as const),
    ]);
    const mintedByDay = new Map(global.map((g) => [g.dayKey, g.pointsMinted]));

    return {
      from,
      to: today,
      enabled: settings.enabled,
      caps: {
        roundsPerGame: settings.roundsPerGame,
        waterCap: settings.waterCap,
        pointsCap: settings.pointsCap,
        accountsPerDevice: settings.accountsPerDevice,
        globalBudget: settings.globalBudget,
        minAccountAgeHours: settings.minAccountAgeHours,
      },
      games: MINI_GAME_IDS.map((game, i) => ({
        game,
        flagOn: settings.games[game],
        activeItems: pools[i]!.rows.length,
        usableItems: pools[i]!.usableCount,
        minActiveItems: MINI_MIN_ACTIVE_ITEMS,
        /** false = game đang tự ẩn trong `today` vì thiếu mục bật (hoặc đề giỏ không đủ hàng). */
        available: pools[i]!.available,
      })),
      days: perDay.map((d) => ({
        dayKey: d.dayKey,
        players: Number(d.players),
        rounds: Number(d.rounds),
        submitted: Number(d.submitted),
        rewarded: Number(d.rewarded),
        pointsMinted: mintedByDay.get(d.dayKey) ?? 0,
        pointsBudget: settings.globalBudget,
      })),
      byGame: perGame.map((g) => ({
        dayKey: g.dayKey,
        game: g.game,
        players: Number(g.players),
        submitted: Number(g.submitted),
        water: Number(g.water ?? 0),
        points: Number(g.points ?? 0),
        cappedRounds: Number(g.capped),
      })),
      items: items.map((it) => {
        const shown = Number(it.shown);
        const correct = Number(it.correct);
        const meta = labels.get(it.contentId);
        return {
          contentId: it.contentId,
          game: it.game,
          label: meta?.label ?? '',
          active: meta?.active ?? null,
          shown,
          correct,
          correctRate: shown > 0 ? Math.round((correct / shown) * 1000) / 1000 : null,
        };
      }),
    };
  }
}
