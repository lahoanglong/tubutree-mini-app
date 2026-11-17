import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MINI_ERROR_CODES, type MiniErrorCode } from '@tubutree/shared-types';
import { PrismaService } from '../../../../prisma/prisma.service';
import { SystemConfigService } from '../../../system-config/system-config.service';
import { PUBLIC_PRODUCT_WHERE } from '../../../catalog/public-product';
import { SELLABLE_VARIATION_WHERE } from '../../../cart/sellable';
import { withCoverImages } from '../../../catalog/card-select';
import { VARIATION_ORDER_BY, cardPriceWithFlash, cardPrices, type FlashOffer } from '../../../catalog/variation-order';
import { activeFlashWhere, isStillDiscounted } from '../../../flash-sale/flash-active';
import { publicProductThumb } from '../../../../common/public-image';
import { isRealUser } from '../../../../common/real-user';
import { vnDateKey } from '../../../../common/vn-time';
import { ensureGameProfile } from '../../game-profile';
import { GameMiniRewardService } from '../game-mini-reward.service';
import { deviceHash } from '../game-mini-crypto';
import { readFlag, readMiniSettings } from '../game-mini.settings';
import {
  MATCHER_ENABLED_KEY,
  MATCHER_FALLBACK_ITEMS,
  MATCHER_GAME,
  MATCHER_MIN_ITEMS,
  MATCHER_REWARD,
  MATCHER_TRIVIA_PER_RUN,
  fillSlots,
  matcherContentGaps,
  pickOutcome,
  planSlots,
  readMatcherOutcome,
  readMatcherQuestion,
  readMatcherTrivia,
  resolveChain,
  sortQuestions,
  type MatcherAnswer,
  type MatcherOutcome,
  type MatcherQuestion,
} from './matcher.rules';
import type { MatcherContentResponse, MatcherItemView, MatcherResultResponse } from './matcher.types';

/** Nội dung đang bật đọc lại sau chừng này (admin bật/tắt mục thì khách thấy trong tối đa 10 phút). */
export const MATCHER_CACHE_MS = 10 * 60_000;
const FALLBACK_SCAN = 40;

interface TriviaRow {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  sourceUrl: string;
}

type OutcomeRow = MatcherOutcome & { id: string };

interface MatcherContent {
  questions: MatcherQuestion[];
  trivia: TriviaRow[];
  outcomes: OutcomeRow[];
  /** Mọi nhánh có đủ 3 câu và một bộ khớp, và có đủ câu kiến thức có nguồn. */
  available: boolean;
}

type PricedItem = Omit<MatcherItemView, 'why'>;

function matcherError(status: HttpStatus, code: MiniErrorCode, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

const disabled = () => matcherError(HttpStatus.NOT_FOUND, MINI_ERROR_CODES.disabled, 'Chọn Chuẩn Xanh đang tạm nghỉ. Bạn quay lại sau nhé.');
const noContent = () =>
  matcherError(HttpStatus.NOT_FOUND, MINI_ERROR_CODES.noContent, 'Chọn Chuẩn Xanh đang được cập nhật câu hỏi. Bạn quay lại sau nhé.');
const invalid = () =>
  matcherError(HttpStatus.BAD_REQUEST, MINI_ERROR_CODES.answersInvalid, 'Câu trả lời chưa đúng dạng. Bạn tải lại trang rồi chọn lại nhé.');

const isHttps = (url: string) => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

/** `[{code, value}]` đúng dạng (chuỗi ngắn); ngoài ra null. Đúng câu, đúng lựa chọn, đủ 3 câu do `resolveChain` kiểm. */
export function parseMatcherAnswers(raw: readonly unknown[]): MatcherAnswer[] | null {
  const out: MatcherAnswer[] = [];
  for (const a of raw) {
    if (typeof a !== 'object' || a === null || Array.isArray(a)) return null;
    const { code, value } = a as Record<string, unknown>;
    if (typeof code !== 'string' || typeof value !== 'string' || code.length > 40 || value.length > 40) return null;
    out.push({ code, value });
  }
  return out;
}

/**
 * "Chọn Chuẩn Xanh" (cờ `game.matcher_enabled`, độc lập với `game.mini.enabled`). Máy chủ giữ luật: chọn bộ theo đáp án (tất định),
 * lọc món còn bán, còn hàng theo đúng điều kiện của giỏ, giá theo đúng hàm giá thẻ (có Giờ vàng), và thưởng 💧 cho lượt đầu trong ngày
 * khi game mini đang bật. Không tạo mã giảm giá, không đổi giá, không cộng Điểm Xanh; "Thêm cả bộ" đi qua `POST /cart/items/batch` sẵn
 * có và không gắn thưởng.
 */
@Injectable()
export class MatcherService {
  private readonly logger = new Logger(MatcherService.name);
  private cache: { at: number; value: MatcherContent } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly env: ConfigService,
    private readonly rewards: GameMiniRewardService,
  ) {}

  async enabled(): Promise<boolean> {
    return readFlag(await this.config.get<unknown>(MATCHER_ENABLED_KEY, false));
  }

  /** Lối vào chỉ hiện khi chơi được thật: cờ bật mà nội dung chưa được bật đủ thì mọi lối vào chỉ dẫn tới câu "đang cập nhật". */
  async ready(): Promise<boolean> {
    return (await this.enabled()) && (await this.content()).available;
  }

  private async content(nowMs: number = Date.now()): Promise<MatcherContent> {
    if (this.cache && nowMs - this.cache.at < MATCHER_CACHE_MS) return this.cache.value;
    const rows = await this.prisma.gameContentItem.findMany({
      where: { game: MATCHER_GAME, active: true },
      select: { id: true, kind: true, payload: true, explanation: true, sourceUrl: true },
      orderBy: { id: 'asc' },
    });
    const questions: MatcherQuestion[] = [];
    const trivia: TriviaRow[] = [];
    const outcomes: OutcomeRow[] = [];
    for (const r of rows) {
      if (r.kind === 'question') {
        const q = readMatcherQuestion(r.payload);
        if (q && !questions.some((x) => x.code === q.code)) questions.push(q);
      } else if (r.kind === 'trivia') {
        const t = readMatcherTrivia(r.payload);
        if (t && r.explanation.trim() && isHttps(r.sourceUrl)) trivia.push({ id: r.id, ...t, explanation: r.explanation, sourceUrl: r.sourceUrl });
      } else if (r.kind === 'outcome') {
        const o = readMatcherOutcome(r.payload);
        if (o && !outcomes.some((x) => x.code === o.code)) outcomes.push({ id: r.id, ...o });
      }
    }
    const sorted = sortQuestions(questions);
    const gaps = matcherContentGaps(sorted, outcomes);
    if (gaps.length > 0 && rows.length > 0) this.logger.warn(`Chọn Chuẩn Xanh: nội dung chưa đủ nhánh (${gaps.slice(0, 3).join('; ')})`);
    const value = { questions: sorted, trivia, outcomes, available: gaps.length === 0 && trivia.length >= MATCHER_TRIVIA_PER_RUN };
    this.cache = { at: nowMs, value };
    return value;
  }

  private async usableContent(): Promise<MatcherContent> {
    if (!(await this.enabled())) throw disabled();
    const c = await this.content();
    if (!c.available) throw noContent();
    return c;
  }

  /** Bộ câu đang bật (công khai). Đáp án câu kiến thức có trong đây để hiện lời giải ngay; thưởng không tính theo câu đúng. */
  async publicContent(): Promise<MatcherContentResponse> {
    const c = await this.usableContent();
    return {
      questions: c.questions.map((q) => ({ code: q.code, step: q.step, prompt: q.prompt, options: q.options, when: q.when })),
      trivia: c.trivia.map((t) => ({ id: t.id, prompt: t.prompt, options: t.options, answer: t.answer, explanation: t.explanation, sourceUrl: t.sourceUrl })),
    };
  }

  /**
   * Thẻ giá của các slug đang bán, còn hàng: sản phẩm công khai (đang bán, đã duyệt) + phân loại đang bán có tồn, đúng điều kiện
   * `SELLABLE_VARIATION_WHERE` của giỏ. Giá = `cardPriceWithFlash` (giá thẻ, Giờ vàng thắng khi rẻ hơn); phân loại thêm vào giỏ là phân
   * loại có suất Giờ vàng đang thắng, không thì phân loại đại diện (cùng phân loại trang chi tiết mở sẵn).
   */
  private async priceSlugs(slugs: readonly string[], now: Date): Promise<Map<string, PricedItem>> {
    const unique = [...new Set(slugs)];
    if (unique.length === 0) return new Map();
    const products = await this.prisma.product.findMany({
      where: { ...PUBLIC_PRODUCT_WHERE, slug: { in: unique } },
      select: {
        id: true,
        slug: true,
        name: true,
        thumbnail: true,
        basePrice: true,
        salePrice: true,
        variations: {
          where: { isActive: SELLABLE_VARIATION_WHERE.isActive },
          orderBy: VARIATION_ORDER_BY,
          select: { id: true, sku: true, name: true, retailPrice: true, salePrice: true, stock: true },
        },
      },
    });
    const live = products.filter((p) => p.variations.some((v) => v.stock > 0));
    if (live.length === 0) return new Map();
    const flashWhere = activeFlashWhere(now);
    const flashRows = await this.prisma.flashSaleItem.findMany({
      where: { ...flashWhere, variation: { ...flashWhere.variation, productId: { in: live.map((p) => p.id) } } },
      select: { flashPrice: true, soldCount: true, quota: true, variationId: true, variation: { select: { productId: true, retailPrice: true, salePrice: true } } },
    });
    const offers = new Map<string, FlashOffer[]>();
    for (const r of flashRows) {
      if (r.soldCount >= r.quota || !isStillDiscounted(r)) continue;
      const list = offers.get(r.variation.productId) ?? [];
      list.push({ variationId: r.variationId, flashPrice: r.flashPrice, retailPrice: r.variation.retailPrice, salePrice: r.variation.salePrice });
      offers.set(r.variation.productId, list);
    }
    const withImages = await withCoverImages(this.prisma, live);
    const out = new Map<string, PricedItem>();
    for (const p of withImages) {
      // Chỉ ưu đãi của phân loại còn hàng: phân loại Giờ vàng hết hàng mà phân loại khác còn thì món vẫn vào bộ với giá thường.
      const own = offers.get(p.id)?.filter((o) => p.variations.some((v) => v.id === o.variationId && v.stock > 0));
      const price = cardPriceWithFlash(p, p.variations, own);
      const card = cardPrices(p, p.variations);
      const standing = card.salePrice ?? card.basePrice;
      const winner = price < standing ? (own ?? []).find((o) => o.flashPrice === price) : undefined;
      const chosen = p.variations.find((v) => v.id === (winner?.variationId ?? card.repVariationId));
      if (!chosen || chosen.stock <= 0) continue;
      out.set(p.slug, {
        slug: p.slug,
        productId: p.id,
        variationId: chosen.id,
        name: p.name,
        variationName: p.variations.length > 1 ? chosen.name : null,
        imageUrl: publicProductThumb(p),
        price,
        compareAtPrice: chosen.retailPrice > price ? chosen.retailPrice : null,
        flash: winner !== undefined,
      });
    }
    return out;
  }

  /** Bán chạy còn hàng của danh mục (và danh mục con): đã bán (app + ngoài) giảm dần, hoà thì slug. */
  private async fallbackItems(categorySlug: string, now: Date): Promise<MatcherItemView[]> {
    const cats = await this.prisma.category.findMany({
      where: { OR: [{ slug: categorySlug }, { parent: { slug: categorySlug } }] },
      select: { id: true },
    });
    if (cats.length === 0) return [];
    const rows = await this.prisma.product.findMany({
      where: {
        ...PUBLIC_PRODUCT_WHERE,
        categoryIds: { hasSome: cats.map((c) => c.id) },
        variations: { some: { isActive: SELLABLE_VARIATION_WHERE.isActive, stock: { gt: 0 } } },
      },
      select: { slug: true, soldApp: true, soldExternal: true },
      orderBy: [{ soldApp: 'desc' }, { slug: 'asc' }],
      take: FALLBACK_SCAN,
    });
    rows.sort((a, b) => b.soldApp + b.soldExternal - (a.soldApp + a.soldExternal) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const slugs = rows.map((r) => r.slug);
    const priced = await this.priceSlugs(slugs, now);
    return slugs
      .filter((s) => priced.has(s))
      .slice(0, MATCHER_FALLBACK_ITEMS)
      .map((s) => ({ ...priced.get(s)!, why: '' }));
  }

  /**
   * 💧 của lượt đầu trong ngày: chỉ khi game mini đang bật, khách đã đăng nhập bằng tài khoản thật, đủ tuổi tài khoản và có mã thiết bị
   * (`credit` không thưởng khi thiếu mã thiết bị; ghi ván lúc đó là đốt mất lượt thưởng của ngày). Lỗi ở bước thưởng không làm hỏng
   * gợi ý (transaction rollback sạch, lượt sau trong ngày vẫn nhận được).
   */
  private async reward(userId: string | null, outcomeId: string, deviceId: string | null | undefined, now: Date): Promise<number> {
    if (!userId || !deviceId) return 0;
    const settings = await readMiniSettings(this.config);
    if (!settings.enabled) return 0;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { zaloId: true, phone: true, createdAt: true } });
    if (!user || !isRealUser(user)) return 0;
    if (settings.minAccountAgeHours > 0 && now.getTime() - user.createdAt.getTime() < settings.minAccountAgeHours * 3_600_000) return 0;
    try {
      await ensureGameProfile(this.prisma, this.config, userId);
      const settled = await this.rewards.settleMatcher({
        userId,
        dayKey: vnDateKey(now),
        now,
        outcomeId,
        water: MATCHER_REWARD.water,
        deviceHash: deviceHash(this.env.get<string>('JWT_ACCESS_SECRET') || undefined, deviceId),
        settings,
      });
      return settled.water;
    } catch (err) {
      this.logger.warn(`Chọn Chuẩn Xanh của ${userId}: chưa cộng được 💧 (${String(err)})`);
      return 0;
    }
  }

  async result(userId: string | null, input: { answers: readonly unknown[]; deviceId?: string | null }, now: Date = new Date()): Promise<MatcherResultResponse> {
    const c = await this.usableContent();
    const answers = parseMatcherAnswers(input.answers);
    const chain = answers ? resolveChain(c.questions, answers) : null;
    if (!chain) throw invalid();
    const outcome = pickOutcome(c.outcomes, chain.tags) as OutcomeRow | null;
    if (!outcome) throw noContent();
    const plan = planSlots(outcome, chain.tags);
    const priced = await this.priceSlugs(plan.flatMap((s) => s.candidates), now);
    const filled = fillSlots(plan, (slug) => priced.has(slug));
    const fallback = filled.length < MATCHER_MIN_ITEMS;
    const items = fallback ? await this.fallbackItems(outcome.fallbackCategory, now) : filled.map((f) => ({ ...priced.get(f.slug)!, why: f.why }));
    // Bộ rỗng (cả nhóm dự phòng hết hàng) không dùng lượt thưởng của ngày: khách không thấy gì để nhận.
    const water = items.length > 0 ? await this.reward(userId, outcome.id, input.deviceId, now) : 0;
    return {
      outcomeId: outcome.id,
      code: outcome.code,
      title: outcome.title,
      fallback,
      items,
      total: items.reduce((sum, i) => sum + i.price, 0),
      water,
    };
  }
}
