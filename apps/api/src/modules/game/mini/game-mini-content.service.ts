import { Injectable } from '@nestjs/common';
import { MINI_MIN_ACTIVE_ITEMS, type MiniGameId, type MiniProductCard } from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { PUBLIC_PRODUCT_WHERE } from '../../catalog/public-product';
import { publicProductThumb } from '../../../common/public-image';
import { MINI_GAMES, type MiniContentRow } from './games';
import type { MiniPickCtx } from './games/game-def';

/** Câu `game_quizzes` đi qua bộ chuyển mang id có tiền tố này, để không đụng id của `game_content_items`. */
export const LEGACY_QUIZ_PREFIX = 'gq:';

const CONTENT_SELECT = { id: true, game: true, payload: true, explanation: true, sourceUrl: true, productSlug: true } as const;

/** Cấu hình ván cần cho mỗi lần dựng: kho đang bật và thẻ sản phẩm của kho đó. */
export interface MiniPool {
  rows: MiniContentRow[];
  products: Map<string, MiniProductCard>;
  /** Số mục đang bật dùng được (đề Giỏ Đúng Việc: còn đủ hàng hôm nay). */
  usableCount: number;
  /** Đủ để hiện game: ít nhất `MINI_MIN_ACTIVE_ITEMS` mục bật, và có mục phát được ngay. */
  available: boolean;
  sortHazardous: boolean;
}

@Injectable()
export class GameMiniContentService {
  constructor(private readonly prisma: PrismaService) {}

  private toRow(r: { id: string; game: string; payload: unknown; explanation: string; sourceUrl: string; productSlug: string | null }): MiniContentRow {
    return { id: r.id, game: r.game as MiniGameId, payload: r.payload, explanation: r.explanation, sourceUrl: r.sourceUrl, productSlug: r.productSlug };
  }

  /**
   * Bộ chuyển chỉ-đọc cho câu đố cũ: chỉ câu có nguồn https mới vào Đố Xanh. `ids` cho đường chấm bài (đọc đúng câu đã phát, kể cả khi
   * nguồn vừa bị gỡ sau lúc phát).
   */
  private async legacyQuizzes(ids?: string[]): Promise<MiniContentRow[]> {
    const rows = await this.prisma.gameQuiz.findMany({
      where: ids ? { id: { in: ids } } : { sourceUrl: { startsWith: 'https://' } },
      select: { id: true, question: true, options: true, correct: true, explanation: true, sourceUrl: true, productSlug: true },
    });
    return rows.map((r) => ({
      id: `${LEGACY_QUIZ_PREFIX}${r.id}`,
      game: 'daily_quiz' as const,
      payload: { prompt: r.question, options: r.options, answer: r.correct },
      explanation: r.explanation ?? '',
      sourceUrl: r.sourceUrl ?? '',
      productSlug: r.productSlug,
    }));
  }

  /** Thẻ sản phẩm đang bán (đã duyệt, đang bật) theo slug. Giá: phân loại rẻ nhất còn hàng, không có thì rẻ nhất đang bán. */
  async products(slugs: readonly string[]): Promise<Map<string, MiniProductCard>> {
    const unique = [...new Set(slugs)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.product.findMany({
      where: { ...PUBLIC_PRODUCT_WHERE, slug: { in: unique } },
      select: {
        id: true,
        slug: true,
        name: true,
        thumbnail: true,
        basePrice: true,
        salePrice: true,
        variations: { where: { isActive: true }, select: { stock: true, retailPrice: true, salePrice: true } },
      },
    });
    const cards = new Map<string, MiniProductCard>();
    for (const r of rows) {
      const priceOf = (v: { retailPrice: number; salePrice: number | null }) => v.salePrice ?? v.retailPrice;
      const inStockPrices = r.variations.filter((v) => v.stock > 0).map(priceOf);
      const allPrices = r.variations.map(priceOf);
      const prices = inStockPrices.length > 0 ? inStockPrices : allPrices;
      cards.set(r.slug, {
        slug: r.slug,
        name: r.name,
        imageUrl: publicProductThumb({ id: r.id, thumbnail: r.thumbnail }),
        price: prices.length > 0 ? Math.min(...prices) : (r.salePrice ?? r.basePrice),
        inStock: inStockPrices.length > 0,
      });
    }
    return cards;
  }

  /** Kho đang bật của một game, kèm thẻ sản phẩm và việc game có đủ nội dung để hiện hay không. */
  async pool(game: MiniGameId, dayKey: string): Promise<MiniPool> {
    const def = MINI_GAMES[game];
    const items = (await this.prisma.gameContentItem.findMany({ where: { game, active: true }, select: CONTENT_SELECT })).map((r) =>
      this.toRow(r),
    );
    const rows = game === 'daily_quiz' ? [...items, ...(await this.legacyQuizzes())] : items;
    const products = await this.products(rows.flatMap((r) => def.productSlugs(r)));
    const ctx: MiniPickCtx = { rng: Math.random, dayKey, products };
    const usableCount = rows.filter((r) => def.usable(r, ctx)).length;
    const available = rows.length >= MINI_MIN_ACTIVE_ITEMS && (game === 'basket' ? usableCount > 0 : usableCount >= MINI_MIN_ACTIVE_ITEMS);
    const sortHazardous = game === 'sort' && rows.some((r) => (r.payload as { bin?: unknown } | null)?.bin === 'hazardous');
    return { rows, products, usableCount, available, sortHazardous };
  }

  /**
   * Mục đã phát cho một ván, đúng thứ tự `ids`, kể cả mục đã bị tắt sau lúc phát (ván đã phát vẫn chấm được). null khi thiếu mục
   * (id lạ hoặc không thuộc game này).
   */
  async byIds(game: MiniGameId, ids: readonly string[]): Promise<MiniContentRow[] | null> {
    const legacyIds = ids.filter((id) => id.startsWith(LEGACY_QUIZ_PREFIX)).map((id) => id.slice(LEGACY_QUIZ_PREFIX.length));
    const plainIds = ids.filter((id) => !id.startsWith(LEGACY_QUIZ_PREFIX));
    if (legacyIds.length > 0 && game !== 'daily_quiz') return null;
    const [items, legacy] = await Promise.all([
      plainIds.length > 0
        ? this.prisma.gameContentItem.findMany({ where: { game, id: { in: plainIds } }, select: CONTENT_SELECT })
        : Promise.resolve([]),
      legacyIds.length > 0 ? this.legacyQuizzes(legacyIds) : Promise.resolve([]),
    ]);
    const byId = new Map<string, MiniContentRow>([...items.map((r) => [r.id, this.toRow(r)] as const), ...legacy.map((r) => [r.id, r] as const)]);
    const out: MiniContentRow[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) return null;
      out.push(row);
    }
    return out;
  }
}
