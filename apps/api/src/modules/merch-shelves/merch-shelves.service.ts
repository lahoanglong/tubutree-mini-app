import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { bundleLiveWhere } from '../bundles/bundle-read';
import { CatalogService } from '../catalog/catalog.service';
import { childrenByParent, expandCategoryScope } from '../catalog/category-scope';
import { PUBLIC_PRODUCT_WHERE, isPublicProduct } from '../catalog/public-product';
import { activeFlashWhere } from '../flash-sale/flash-active';
import type { MerchPinDto, SaveMerchShelfDto } from './dto/merch-shelf.dto';
import {
  BEST_SELLERS_SHELF,
  HOME_FEATURED_SHELF,
  MERCH_SHELF_MAX_PINS,
  MERCH_SUGGEST_COUNT,
  type MerchShelfKey,
  type PinWarning,
  categoryShelfKey,
  parseShelfKey,
  pinInWindow,
  pinWarnings,
  shelfVersion,
  spreadPick,
} from './merch-shelf';
import { PIN_SELLABLE_WHERE } from './merch-shelf-reader';

/** Dòng nhật ký admin (`user_admin_events`) của một lần lưu kệ: `fromValue`/`toValue` là id món theo thứ tự, `reason` là `shelf:<khoá>`. */
export const MERCH_SHELF_EVENT_KIND = 'MERCH_SHELF';

type Card = Awaited<ReturnType<CatalogService['cardsByIds']>>[number];

export interface MerchShelfStatus {
  enabled: boolean;
  curated: boolean;
}

export interface MerchShelfSummary {
  key: MerchShelfKey;
  label: string;
  kind: 'home' | 'best_sellers' | 'category';
  pinCount: number;
}

/** Món nhìn từ tab admin: cảnh báo sẵn sàng và thẻ cửa hàng (null khi khách không thấy món, ví dụ đang ẩn). */
export interface MerchProductView {
  productId: string;
  name: string;
  brand: string;
  slug: string;
  thumbnail: string | null;
  warnings: PinWarning[];
  card: Card | null;
}

export interface MerchPinView extends MerchProductView {
  position: number;
  startsAt: string | null;
  endsAt: string | null;
  note: string | null;
  /** Lúc đọc, món này có đứng đầu kệ của khách không (đang bán, còn hàng, trong khung giờ, và thuộc danh mục với kệ danh mục). */
  live: boolean;
}

export interface MerchShelfView {
  key: MerchShelfKey;
  label: string;
  version: string;
  maxPins: number;
  status: MerchShelfStatus;
  pins: MerchPinView[];
}

export interface EmptyEntrance {
  key: string;
  label: string;
  detail: string;
  /** Tab quản trị để thêm nội dung; null khi chưa có tab quản trị cho lối vào đó. */
  adminTab: string | null;
}

type ResolvedShelf = { key: MerchShelfKey; label: string; kind: MerchShelfSummary['kind']; scope: string[] | null };

const READINESS_SELECT = {
  id: true,
  name: true,
  brand: true,
  slug: true,
  thumbnail: true,
  images: true,
  shortDesc: true,
  categoryIds: true,
  isActive: true,
  approvalStatus: true,
  variations: { select: { isActive: true, stock: true } },
} satisfies Prisma.ProductSelect;

const PIN_ROW_SELECT = { productId: true, position: true, startsAt: true, endsAt: true, note: true, updatedAt: true } satisfies Prisma.MerchShelfPinSelect;

const HOME_LABEL = 'Gợi ý hôm nay (Trang chủ và Danh mục chưa lọc)';
const BEST_LABEL = 'Bán chạy nhất (khi chưa đủ số bán)';
const EMPTY_CATEGORY_LIMIT = 30;

const nonEmpty = (s: string | null | undefined) => Boolean(s && s.trim());
const hasImage = (p: { images: string[]; thumbnail: string | null }) => p.images.some(nonEmpty) || nonEmpty(p.thumbnail);

function badRequest(code: string, message: string, extra: Record<string, unknown> = {}): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code, message, ...extra });
}

/**
 * Tab admin "Xếp kệ" (tubu-w4-06): đọc, lưu và gợi ý món ghim của từng kệ. Phần đọc cho khách ở `MerchShelfReader` (trong CatalogService);
 * lưu xong thì xoá bộ nhớ của CatalogService và khối Trang chủ để khách thấy thứ tự mới ngay trên instance nhận lệnh.
 */
@Injectable()
export class MerchShelvesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  async overview(): Promise<{ status: MerchShelfStatus; shelves: MerchShelfSummary[] }> {
    const [status, categories, counts] = await Promise.all([
      this.catalog.merchStatus(),
      this.catalog.categoriesFlat(),
      this.prisma.merchShelfPin.groupBy({ by: ['shelfKey'], _count: { _all: true } }),
    ]);
    const countOf = new Map(counts.map((c) => [c.shelfKey, c._count._all]));
    const shelves: MerchShelfSummary[] = [
      { key: HOME_FEATURED_SHELF, label: HOME_LABEL, kind: 'home', pinCount: countOf.get(HOME_FEATURED_SHELF) ?? 0 },
      { key: BEST_SELLERS_SHELF, label: BEST_LABEL, kind: 'best_sellers', pinCount: countOf.get(BEST_SELLERS_SHELF) ?? 0 },
      ...categories.map((c) => {
        const key = categoryShelfKey(c.slug);
        return { key, label: `Đầu danh mục: ${c.name}`, kind: 'category' as const, pinCount: countOf.get(key) ?? 0 };
      }),
    ];
    return { status, shelves };
  }

  async getShelf(rawKey: string): Promise<MerchShelfView> {
    const shelf = await this.resolveShelf(rawKey);
    const [rows, status] = await Promise.all([
      this.prisma.merchShelfPin.findMany({ where: { shelfKey: shelf.key }, orderBy: [{ position: 'asc' }, { productId: 'asc' }], select: PIN_ROW_SELECT }),
      this.catalog.merchStatus(),
    ]);
    const views = await this.productViews(
      rows.map((r) => r.productId),
      shelf.scope,
    );
    const now = new Date();
    const pins: MerchPinView[] = [];
    for (const r of rows) {
      const view = views.get(r.productId);
      if (!view) continue;
      pins.push({
        ...view,
        position: r.position,
        startsAt: r.startsAt?.toISOString() ?? null,
        endsAt: r.endsAt?.toISOString() ?? null,
        note: r.note,
        live: isLive(view) && pinInWindow(r, now),
      });
    }
    return { key: shelf.key, label: shelf.label, version: shelfVersion(rows), maxPins: MERCH_SHELF_MAX_PINS, status, pins };
  }

  /** Một món vừa chọn ở bộ chọn sản phẩm: cảnh báo và thẻ xem trước theo kệ đang xếp, trước khi lưu. */
  async product(productId: string, rawKey?: string): Promise<MerchProductView> {
    const scope = rawKey ? (await this.resolveShelf(rawKey)).scope : null;
    const view = (await this.productViews([productId], scope)).get(productId);
    if (!view) throw new NotFoundException({ statusCode: 404, error: 'Not Found', code: 'PRODUCT_NOT_FOUND', message: 'Không tìm thấy sản phẩm.' });
    return view;
  }

  async save(dto: SaveMerchShelfDto, adminId: string): Promise<MerchShelfView> {
    const shelf = await this.resolveShelf(dto.key);
    const pins = normalizePins(dto.pins);
    const ids = pins.map((p) => p.productId);
    if (ids.length > 0) {
      const found = await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, images: true, thumbnail: true } });
      const byId = new Map(found.map((p) => [p.id, p]));
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length > 0) throw badRequest('PIN_PRODUCT_NOT_FOUND', 'Có món không còn trong danh sách sản phẩm. Gỡ món đó rồi lưu lại.', { productIds: missing });
      const noImage = ids.filter((id) => !hasImage(byId.get(id)!));
      if (noImage.length > 0) throw badRequest('PIN_NO_IMAGE', 'Món chưa có ảnh không ghim được: ô ảnh trống ở đầu kệ trông như trang hỏng.', { productIds: noImage });
    }
    await this.prisma.$transaction(
      async (tx) => {
        // Hai admin lưu cùng một kệ: người sau chờ khoá, đọc lại kệ người trước vừa ghi nên dấu phiên bản lệch và nhận 409 thay vì ghi đè.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`merch-shelf:${shelf.key}`}))`;
        const current = await tx.merchShelfPin.findMany({ where: { shelfKey: shelf.key }, orderBy: [{ position: 'asc' }, { productId: 'asc' }], select: PIN_ROW_SELECT });
        if (shelfVersion(current) !== dto.version) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            code: 'SHELF_CHANGED',
            message: 'Kệ này vừa được người khác lưu. Tải lại kệ để xem bản mới rồi xếp lại.',
          });
        }
        const keep = new Set(ids);
        const removed = current.filter((r) => !keep.has(r.productId)).map((r) => r.productId);
        if (removed.length > 0) await tx.merchShelfPin.deleteMany({ where: { shelfKey: shelf.key, productId: { in: removed } } });
        const now = new Date();
        for (const [position, p] of pins.entries()) {
          const fields = { position, startsAt: p.startsAt, endsAt: p.endsAt, note: p.note, updatedAt: now };
          await tx.merchShelfPin.upsert({
            where: { shelfKey_productId: { shelfKey: shelf.key, productId: p.productId } },
            create: { shelfKey: shelf.key, productId: p.productId, createdById: adminId, ...fields },
            update: fields,
          });
        }
        await tx.userAdminEvent.create({
          data: {
            userId: adminId,
            kind: MERCH_SHELF_EVENT_KIND,
            fromValue: current.map((r) => r.productId).join(','),
            toValue: ids.join(','),
            reason: `shelf:${shelf.key}`,
            actorId: adminId,
          },
        });
      },
      { timeout: 30_000 },
    );
    this.catalog.invalidateMerchShelves();
    return this.getShelf(shelf.key);
  }

  /**
   * "Gợi ý 8 món sẵn sàng": món đang bán, còn hàng, có ảnh, có danh mục (kệ danh mục: thuộc danh mục đó), chưa ghim và không có trong bản nháp,
   * xếp theo số bán rồi trải đều nhãn và danh mục. Chỉ trả về để admin xem, không ghi gì.
   */
  async suggest(rawKey: string, exclude: readonly string[]): Promise<{ items: MerchProductView[] }> {
    const shelf = await this.resolveShelf(rawKey);
    const pinned = await this.prisma.merchShelfPin.findMany({ where: { shelfKey: shelf.key }, select: { productId: true } });
    const skip = [...new Set([...pinned.map((p) => p.productId), ...exclude])];
    const ranked = await this.prisma.product.findMany({
      where: {
        ...PIN_SELLABLE_WHERE,
        images: { isEmpty: false },
        categoryIds: shelf.scope ? { hasSome: shelf.scope } : { isEmpty: false },
        ...(skip.length > 0 ? { id: { notIn: skip } } : {}),
      },
      orderBy: [{ soldApp30d: 'desc' }, { soldApp: 'desc' }, { soldExternal: 'desc' }, { isFeatured: 'desc' }, { reviewCount: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: 200,
      select: { id: true, brand: true, categoryIds: true, images: true },
    });
    const picked = spreadPick(
      ranked.filter((p) => p.images.some(nonEmpty)),
      MERCH_SUGGEST_COUNT,
    );
    const views = await this.productViews(
      picked.map((p) => p.id),
      shelf.scope,
    );
    return { items: picked.map((p) => views.get(p.id)).filter((v): v is MerchProductView => Boolean(v)) };
  }

  /** Lối vào của cửa hàng đang không có nội dung trên dữ liệu thật. Chỉ đọc: không ẩn lối vào nào. */
  async emptyEntrances(): Promise<{ checkedAt: string; entrances: EmptyEntrance[] }> {
    const now = new Date();
    const [flashItems, liveBundles, openGroups, categories] = await Promise.all([
      this.prisma.flashSaleItem.count({ where: activeFlashWhere(now) }),
      this.prisma.bundle.count({ where: { ...bundleLiveWhere(now), items: { some: { product: PUBLIC_PRODUCT_WHERE } } } }),
      this.prisma.groupBuy.count({ where: { status: 'OPEN', expiresAt: { gt: now } } }),
      this.catalog.categoriesFlat(),
    ]);
    const entrances: EmptyEntrance[] = [];
    if (flashItems === 0) entrances.push({ key: 'flash', label: 'Giờ vàng', detail: 'Không có món giảm đang chạy, còn hàng.', adminTab: 'flashSales' });
    if (liveBundles === 0) entrances.push({ key: 'bundles', label: 'Combo và mua kèm', detail: 'Không có bộ nào đang chạy có món đang bán.', adminTab: 'bundles' });
    if (openGroups === 0) entrances.push({ key: 'groupBuys', label: 'Mua chung', detail: 'Không có nhóm mua chung nào đang mở.', adminTab: null });
    const empty = categories.filter((c) => c.productCount === 0);
    for (const c of empty.slice(0, EMPTY_CATEGORY_LIMIT)) {
      entrances.push({ key: categoryShelfKey(c.slug), label: `Danh mục "${c.name}"`, detail: 'Không có món nào đang bán.', adminTab: 'productCategories' });
    }
    if (empty.length > EMPTY_CATEGORY_LIMIT) {
      entrances.push({
        key: 'categories:more',
        label: `Và ${empty.length - EMPTY_CATEGORY_LIMIT} danh mục khác`,
        detail: 'Cũng không có món nào đang bán.',
        adminTab: 'productCategories',
      });
    }
    return { checkedAt: now.toISOString(), entrances };
  }

  private async resolveShelf(raw: string): Promise<ResolvedShelf> {
    const parsed = parseShelfKey(raw);
    if (!parsed) throw badRequest('SHELF_KEY_INVALID', 'Kệ không hợp lệ.');
    if (parsed.key === HOME_FEATURED_SHELF) return { key: parsed.key, label: HOME_LABEL, kind: 'home', scope: null };
    if (parsed.key === BEST_SELLERS_SHELF) return { key: parsed.key, label: BEST_LABEL, kind: 'best_sellers', scope: null };
    const flat = await this.catalog.categoriesFlat();
    const category = flat.find((c) => c.slug === parsed.categorySlug);
    if (!category) throw new NotFoundException({ statusCode: 404, error: 'Not Found', code: 'SHELF_CATEGORY_NOT_FOUND', message: 'Danh mục của kệ này không còn.' });
    return {
      key: parsed.key,
      label: `Đầu danh mục: ${category.name}`,
      kind: 'category',
      scope: expandCategoryScope(childrenByParent(flat), category.id),
    };
  }

  private async productViews(ids: readonly string[], scope: readonly string[] | null): Promise<Map<string, MerchProductView>> {
    if (ids.length === 0) return new Map();
    const [products, cards] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: [...ids] } }, select: READINESS_SELECT }),
      this.catalog.cardsByIds(ids),
    ]);
    const cardOf = new Map(cards.map((c) => [c.id, c]));
    const inScope = scope ? new Set(scope) : null;
    return new Map(
      products.map((p) => [
        p.id,
        {
          productId: p.id,
          name: p.name,
          brand: p.brand,
          slug: p.slug,
          thumbnail: p.thumbnail ?? p.images.find(nonEmpty) ?? null,
          warnings: pinWarnings({
            isPublic: isPublicProduct(p),
            inStock: p.variations.some((v) => v.isActive && v.stock > 0),
            hasImage: hasImage(p),
            hasShortDesc: nonEmpty(p.shortDesc),
            hasCategory: p.categoryIds.length > 0,
            inCategory: inScope ? p.categoryIds.some((id) => inScope.has(id)) : undefined,
          }),
          card: cardOf.get(p.id) ?? null,
        },
      ]),
    );
  }
}

const BLOCKING_LIVE: readonly PinWarning[] = ['NOT_ON_SALE', 'OUT_OF_STOCK', 'OUTSIDE_CATEGORY'];
const isLive = (v: MerchProductView) => v.card !== null && !v.warnings.some((w) => BLOCKING_LIVE.includes(w));

type NormalizedPin = { productId: string; startsAt: Date | null; endsAt: Date | null; note: string | null };

/** Kiểm phần DTO không tự kiểm được: món trùng, khung giờ ngược. Ghi chú rỗng thành null. */
export function normalizePins(pins: readonly MerchPinDto[]): NormalizedPin[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  const out: NormalizedPin[] = [];
  for (const p of pins) {
    if (seen.has(p.productId)) dupes.push(p.productId);
    seen.add(p.productId);
    const startsAt = p.startsAt ? new Date(p.startsAt) : null;
    const endsAt = p.endsAt ? new Date(p.endsAt) : null;
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw badRequest('PIN_WINDOW_INVALID', 'Giờ kết thúc phải sau giờ bắt đầu.', { productIds: [p.productId] });
    }
    out.push({ productId: p.productId, startsAt, endsAt, note: p.note?.trim() ? p.note.trim() : null });
  }
  if (dupes.length > 0) throw badRequest('PIN_DUPLICATE', 'Một món chỉ ghim một lần trên mỗi kệ.', { productIds: [...new Set(dupes)] });
  return out;
}
