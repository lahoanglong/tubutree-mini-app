import { BadRequestException, ConflictException, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { CatalogService } from '../catalog.service';
import { PUBLIC_PRODUCT_WHERE } from '../public-product';
import {
  REFILL_AUTO_MAX_RATIO,
  REFILL_FIRST_ENABLED_KEY,
  REFILL_PAIRS_BLOCK_KEY,
  REFILL_PAIRS_OVERRIDE_KEY,
  applyRefillOverrideOps,
  checkRefillOverrides,
  confirmRefillSuggestions,
  isRefillProduct,
  parseRefillBlock,
  parseRefillOverrides,
  refillPairRows,
  refillSizeLabel,
  type RefillCatalogRow,
  type RefillPairOverride,
  type RefillPairStatus,
} from './refill-pairs';
import { parseMeasure } from '../product-compare.unit';
import { REFILL_LANDING_MAX, compareRefillLandingPairs, refillSavingPct } from './refill-landing';
import { loadRefillPairTable } from './refill-pair-table';

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

/** Chai của một cặp trên trang "Tiết kiệm với Refill": tên, ảnh, giá đang bán trên thẻ (chưa gồm Giờ vàng), giá gạch, cỡ, còn hàng. */
export interface RefillLandingBottle {
  productId: string;
  slug: string;
  name: string;
  thumbnail: string | null;
  price: number;
  compareAt: number | null;
  sizeLabel: string | null;
  inStock: boolean;
}

export interface RefillLandingPair {
  bottle: RefillLandingBottle;
  refill: RefillOffer;
  /** Gói rẻ hơn mua chai cùng lượng bao nhiêu % (`refillSavingPct`); null khi không so được. */
  savingPct: number | null;
}

/** GET /catalog/refill-pairs/landing. Cờ `catalog.refill_first_enabled` tắt: `{ enabled: false, pairs: [] }`. */
export interface RefillLanding {
  enabled: boolean;
  pairs: RefillLandingPair[];
}

export interface AdminRefillProduct {
  id: string;
  slug: string;
  name: string;
  /** "10L"; null khi tên không ghi lượng. */
  sizeLabel: string | null;
}

export interface AdminRefillPairRow {
  bottle: AdminRefillProduct;
  refill: AdminRefillProduct | null;
  status: RefillPairStatus;
  candidates: number;
  /** Gói refill gấp mấy lần chai (một chữ số thập phân); null khi một bên không ghi lượng hay khác chiều. */
  ratio: number | null;
}

/** Thẻ admin "Cặp Refill": cờ, luật lượng, bảng cặp, ghép tay và danh sách chặn hiện hành. */
export interface AdminRefillPairs {
  enabled: boolean;
  maxRatio: number;
  rows: AdminRefillPairRow[];
  overrides: RefillPairOverride[];
  /** Slug đang chặn, kèm tên khi còn trong danh mục công khai (gói refill bị chặn không có dòng nào trong `rows`). */
  block: { slug: string; name: string | null }[];
  /** Lựa chọn cho ô "Ghép tay": mọi chai (không phải refill, không phải combo) và mọi gói Refill đang bán, theo tên. */
  choices: { bottles: AdminRefillProduct[]; refills: AdminRefillProduct[] };
}

export interface AdminRefillPairsInput {
  enabled?: boolean;
  /** Thay cả danh sách ghép tay (API cũ). Thẻ admin gửi `add`/`remove` để không ghi đè cặp nó chưa thấy. */
  overrides?: readonly RefillPairOverride[];
  /** Ghép tay một chai (thay cặp cũ của cùng chai), gộp vào danh sách đang lưu. */
  add?: RefillPairOverride;
  /** Bỏ ghép tay một chai (slug chai), trên danh sách đang lưu. */
  remove?: string;
  /** Duyệt các cặp bảng đang gợi ý (`near`, `size`): tất cả trong một lần ghi, hoặc không cặp nào (bảng đã đổi → 409). */
  confirm?: readonly RefillPairOverride[];
  block?: readonly string[];
}

const adminProduct = (p: RefillCatalogRow): AdminRefillProduct => ({ id: p.id, slug: p.slug, name: p.name, sizeLabel: refillSizeLabel(p.name) });

const byName = (rows: readonly RefillCatalogRow[]) => rows.map(adminProduct).sort((a, b) => a.name.localeCompare(b.name, 'vi'));

function ratioOf(bottle: string, refill: string): number | null {
  const b = parseMeasure(bottle);
  const r = parseMeasure(refill);
  return b && r && b.unit === r.unit && b.qty > 0 ? Math.round((r.qty / b.qty) * 10) / 10 : null;
}

function cardPrice(card: Card): { price: number; compareAt: number | null } {
  const price = card.salePrice ?? card.basePrice;
  return { price, compareAt: card.salePrice != null && card.basePrice > card.salePrice ? card.basePrice : null };
}

function toBottle(card: Card): RefillLandingBottle {
  return {
    productId: card.id,
    slug: card.slug,
    name: card.name,
    thumbnail: card.thumbnail ?? null,
    ...cardPrice(card),
    sizeLabel: refillSizeLabel(card.name),
    inStock: card.inStock === true,
  };
}

function toOffer(card: Card): RefillOffer | null {
  if (!card.repVariationId) return null;
  return {
    productId: card.id,
    slug: card.slug,
    name: card.name,
    thumbnail: card.thumbnail ?? null,
    variationId: card.repVariationId,
    ...cardPrice(card),
    sizeLabel: refillSizeLabel(card.name),
    inStock: card.inStock === true,
    tubu: card.fulfiller?.kind === 'TUBU',
  };
}

@Injectable()
export class RefillPairsService {
  private table: { pairs: Map<string, string>; expiresAt: number } | null = null;
  private loading: Promise<Map<string, string>> | null = null;
  /** Tăng mỗi lần admin lưu: lần quét bắt đầu trước đó (đọc cấu hình cũ) không được ghi vào bộ nhớ đệm. */
  private generation = 0;

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

  /**
   * Trang "Tiết kiệm với Refill" (web /tiet-kiem-refill, Mini /refill-deals): mọi cặp đang hiệu lực của bảng cặp (tự ghép, ghép tay, đã duyệt;
   * chai bị chặn không có) mà cả chai lẫn gói còn bán công khai, kèm % rẻ hơn. Công khai, không đọc người gọi. Cờ tắt thì chỉ đọc cờ.
   */
  async landing(): Promise<RefillLanding> {
    if (!(await this.enabled())) return { enabled: false, pairs: [] };
    const pairs = await this.pairs();
    if (pairs.size === 0) return { enabled: true, pairs: [] };
    const cards = new Map((await this.catalog.cardsByIds([...new Set([...pairs.keys(), ...pairs.values()])])).map((c) => [c.id, c]));
    const out: RefillLandingPair[] = [];
    for (const [bottleId, refillId] of pairs) {
      const bottleCard = cards.get(bottleId);
      const refillCard = cards.get(refillId);
      const refill = refillCard ? toOffer(refillCard) : null;
      if (!bottleCard || !refill) continue;
      const bottle = toBottle(bottleCard);
      out.push({ bottle, refill, savingPct: refillSavingPct(bottle, refill) });
    }
    return { enabled: true, pairs: out.sort(compareRefillLandingPairs).slice(0, REFILL_LANDING_MAX) };
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

  /** Thẻ admin: mọi chai có ứng viên refill (tự ghép, chờ ghép tay vì lệch lượng, nhiều ứng viên, đã ghép tay, đã chặn). */
  async adminOverview(): Promise<AdminRefillPairs> {
    const [products, overridesRaw, blockRaw, enabled] = await Promise.all([this.catalogRows(), this.configValue(REFILL_PAIRS_OVERRIDE_KEY), this.configValue(REFILL_PAIRS_BLOCK_KEY), this.enabled()]);
    const overrides = parseRefillOverrides(overridesRaw);
    const block = parseRefillBlock(blockRaw);
    const nameOf = new Map(products.map((p) => [p.slug, p.name]));
    return {
      enabled,
      maxRatio: REFILL_AUTO_MAX_RATIO,
      rows: refillPairRows(products, { overrides, block }).map((r) => ({
        bottle: adminProduct(r.bottle),
        refill: r.refill ? adminProduct(r.refill) : null,
        status: r.status,
        candidates: r.candidates,
        ratio: r.refill ? ratioOf(r.bottle.name, r.refill.name) : null,
      })),
      overrides,
      block: [...block].map((slug) => ({ slug, name: nameOf.get(slug) ?? null })),
      choices: {
        bottles: byName(products.filter((p) => !p.isCombo && !isRefillProduct(p))),
        refills: byName(products.filter((p) => !p.isCombo && isRefillProduct(p))),
      },
    };
  }

  /**
   * Lưu thẻ admin: phần nào có trong `input` thì ghi đè khoá cấu hình đó (có lịch sử, ghi người sửa). Ghép tay phải là một chai (không phải
   * gói refill) và một gói refill đang bán, hai slug khác nhau, mỗi chai một cặp (`checkRefillOverrides`). Bảng cặp trong bộ nhớ bỏ ngay; /catalog/refill-pairs công khai còn cache CDN
   * như danh mục.
   *
   * Ghép tay đọc, gộp và ghi danh sách đang lưu dưới khoá dòng (`SystemConfigService.update`): hai admin ghép hai chai cùng lúc thì cả hai cặp còn.
   * Ghép tay lưu trước các phần khác, nên ghép sai (400) thì không phần nào được ghi.
   *
   * `confirm` (nút "Duyệt nhanh tất cả gợi ý" và nút duyệt từng dòng): so từng cặp với bảng dựng từ danh sách đọc dưới cùng khoá dòng, rồi gộp
   * tất cả trong cùng lần ghi đó. Cặp không còn là gợi ý → 409, không cặp nào được ghi; gửi lại lần duyệt đã xong → không đổi gì.
   */
  async adminSave(input: AdminRefillPairsInput, actor: string): Promise<AdminRefillPairs> {
    const config = this.config;
    if (!config) throw new ServiceUnavailableException('Chưa đọc được cấu hình hệ thống.');
    try {
      if (input.overrides || input.add || input.remove || input.confirm?.length) {
        const products = await this.catalogRows();
        const bySlug = new Map(products.map((p) => [p.slug, p]));
        await config.update<RefillPairOverride[]>(
          REFILL_PAIRS_OVERRIDE_KEY,
          [],
          async (storedRaw, read) => {
            // Danh sách chặn đọc trong cùng transaction: bản cache của get có thể chậm tới 60 giây sau khi tiến trình API khác vừa chặn một chai.
            const block = input.block ? new Set(input.block.map((s) => s.trim())) : parseRefillBlock(await read(REFILL_PAIRS_BLOCK_KEY));
            const stored = parseRefillOverrides(storedRaw);
            let next = applyRefillOverrideOps(input.overrides ?? stored, { add: input.add, remove: input.remove });
            if (input.confirm?.length) {
              const confirmed = confirmRefillSuggestions(refillPairRows(products, { overrides: next, block }), input.confirm);
              if ('stale' in confirmed) throw new ConflictException(confirmed.stale);
              if ('error' in confirmed) throw new BadRequestException(confirmed.error);
              for (const add of confirmed.add) next = applyRefillOverrideOps(next, { add });
            }
            const checked = checkRefillOverrides(next, bySlug, { kept: stored, block });
            if ('error' in checked) throw new BadRequestException(checked.error);
            return checked.ok;
          },
          actor,
        );
      }
      if (input.enabled !== undefined) await config.set(REFILL_FIRST_ENABLED_KEY, input.enabled, actor);
      if (input.block) await config.set(REFILL_PAIRS_BLOCK_KEY, [...new Set(input.block.map((s) => s.trim()).filter(Boolean))], actor);
    } finally {
      // Một bước sau lỗi thì các bước trước đã ghi rồi: bảng cặp đang nhớ phải bỏ cả khi lần lưu báo lỗi.
      this.generation += 1;
      this.table = null;
      this.loading = null;
    }
    return this.adminOverview();
  }

  /** Bảng cặp hiện hành (id chai → id gói refill), dùng chung bộ nhớ đệm. */
  async pairs(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.table && this.table.expiresAt > now) return this.table.pairs;
    if (!this.loading) {
      const generation = this.generation;
      const loading: Promise<Map<string, string>> = this.load()
        .then((pairs) => {
          if (generation === this.generation) this.table = { pairs, expiresAt: Date.now() + REFILL_PAIRS_TTL_MS };
          return pairs;
        })
        .finally(() => {
          if (this.loading === loading) this.loading = null;
        });
      this.loading = loading;
    }
    return this.loading;
  }

  private load(): Promise<Map<string, string>> {
    return loadRefillPairTable(this.prisma, this.config);
  }

  private catalogRows(): Promise<RefillCatalogRow[]> {
    return this.prisma.product.findMany({ where: { ...PUBLIC_PRODUCT_WHERE }, select: { id: true, slug: true, name: true, brand: true, isCombo: true } });
  }

  private async configValue(key: string): Promise<unknown> {
    return (await this.config?.get<unknown>(key, [])) ?? [];
  }
}
