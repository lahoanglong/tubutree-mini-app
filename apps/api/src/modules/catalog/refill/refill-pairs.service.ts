import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { CatalogService } from '../catalog.service';
import { PUBLIC_PRODUCT_WHERE } from '../public-product';
import {
  REFILL_FIRST_ENABLED_KEY,
  REFILL_PAIRS_BLOCK_KEY,
  REFILL_PAIRS_OVERRIDE_KEY,
  pairRefills,
  parseRefillBlock,
  parseRefillOverrides,
  refillSizeLabel,
} from './refill-pairs';

/** Bảng cặp (quét danh mục công khai + hai khoá cấu hình) đọc lại sau chừng này; mỗi lần hỏi chỉ tra trong bộ nhớ. */
export const REFILL_PAIRS_TTL_MS = 60_000;

/**
 * Gói refill thay cho một chai, theo dạng thẻ dòng: tên, ảnh, giá khách thấy trên thẻ (giá đang bán, chưa gồm Giờ vàng), giá gạch, còn hàng.
 * Cùng dạng với `RefillOfferDTO` ở `packages/app-core/src/refill/refill-api.ts`.
 */
export interface RefillOffer {
  productId: string;
  slug: string;
  name: string;
  thumbnail: string | null;
  /** Phân loại đại diện của thẻ: biến thể giỏ thêm khi khách đổi. */
  variationId: string;
  price: number;
  compareAt: number | null;
  /** "10L"; null khi tên không ghi lượng. */
  sizeLabel: string | null;
  inStock: boolean;
  /** Kho Tubu giao (được tính vào Miễn phí giao hàng, quà, Hộp Xanh như chai Tubu giao). */
  tubu: boolean;
}

type Card = Awaited<ReturnType<CatalogService['cardsByIds']>>[number];

function toOffer(card: Card): RefillOffer | null {
  if (!card.repVariationId) return null;
  const price = card.salePrice ?? card.basePrice;
  return {
    productId: card.id,
    slug: card.slug,
    name: card.name,
    thumbnail: card.thumbnail ?? null,
    variationId: card.repVariationId,
    price,
    compareAt: card.salePrice != null && card.basePrice > card.salePrice ? card.basePrice : null,
    sizeLabel: refillSizeLabel(card.name),
    inStock: card.inStock === true,
    tubu: card.fulfiller?.kind === 'TUBU',
  };
}

@Injectable()
export class RefillPairsService {
  private table: { pairs: Map<string, string>; expiresAt: number } | null = null;
  private loading: Promise<Map<string, string>> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  async enabled(): Promise<boolean> {
    if (!this.config) return false;
    return (await this.config.get<unknown>(REFILL_FIRST_ENABLED_KEY, false)) === true;
  }

  /** Công khai: chai → gói refill cho các id hỏi (id không có cặp thì vắng). Cờ tắt trả `{}` và chỉ đọc cờ. */
  async pairsFor(ids: readonly string[]): Promise<Record<string, RefillOffer>> {
    if (ids.length === 0 || !(await this.enabled())) return {};
    return this.offersFor(ids);
  }

  /**
   * Như `pairsFor` nhưng chỉ cho chai khách ĐÃ CÓ: có trong một đơn bán lẻ đã giao của chính khách, không phải đơn CTV lên hộ (cùng định
   * nghĩa đơn tính của huy hiệu REFILL_5). Khách chưa từng nhận chai đó thì không có gợi ý: họ cần cái chai.
   */
  async minePairsFor(userId: string, ids: readonly string[]): Promise<Record<string, RefillOffer>> {
    if (ids.length === 0 || !(await this.enabled())) return {};
    const pairs = await this.pairs();
    const bottleIds = ids.filter((id) => pairs.has(id));
    if (bottleIds.length === 0) return {};
    const owned = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT DISTINCT v."productId" AS id
        FROM order_items oi
        JOIN orders o ON o.id = oi."orderId"
        JOIN variations v ON v.id = oi."variationId"
       WHERE o."userId" = ${userId}
         AND o.status = 'DELIVERED' AND o.type = 'RETAIL' AND o."placedForCustomer" = false
         AND v."productId" IN (${Prisma.join(bottleIds)})`);
    if (owned.length === 0) return {};
    return this.offersFor(owned.map((r) => r.id));
  }

  private async offersFor(ids: readonly string[]): Promise<Record<string, RefillOffer>> {
    const pairs = await this.pairs();
    const wanted = ids.filter((id) => pairs.has(id));
    if (wanted.length === 0) return {};
    const refillIds = [...new Set(wanted.map((id) => pairs.get(id)!))];
    const offers = new Map<string, RefillOffer>();
    for (const card of await this.catalog.cardsByIds(refillIds)) {
      const offer = toOffer(card);
      if (offer) offers.set(card.id, offer);
    }
    const out: Record<string, RefillOffer> = {};
    for (const id of wanted) {
      const offer = offers.get(pairs.get(id)!);
      if (offer) out[id] = offer;
    }
    return out;
  }

  /** Bảng cặp hiện hành (id chai → id gói refill), dùng chung bộ nhớ đệm. */
  async pairs(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.table && this.table.expiresAt > now) return this.table.pairs;
    this.loading ??= this.load()
      .then((pairs) => {
        this.table = { pairs, expiresAt: Date.now() + REFILL_PAIRS_TTL_MS };
        return pairs;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private async load(): Promise<Map<string, string>> {
    const [products, overrides, block] = await Promise.all([
      this.prisma.product.findMany({ where: { ...PUBLIC_PRODUCT_WHERE }, select: { id: true, slug: true, name: true, brand: true, isCombo: true } }),
      this.config?.get<unknown>(REFILL_PAIRS_OVERRIDE_KEY, []) ?? [],
      this.config?.get<unknown>(REFILL_PAIRS_BLOCK_KEY, []) ?? [],
    ]);
    return pairRefills(products, { overrides: parseRefillOverrides(overrides), block: parseRefillBlock(block) });
  }
}
