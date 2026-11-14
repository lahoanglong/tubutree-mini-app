import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageResizeService } from './image-resize.service';
import { VARIATION_ORDER_BY } from './variation-order';
import {
  PRODUCT_IMAGES_LIMIT,
  WP_IMAGE_CANDIDATES,
  WP_TIER_LABELS,
  applyWpCandidate,
  candidateForSlug,
  clearDecision,
  loadDecisions,
  loadWpCatalog,
  nodeWpHttp,
  pickImageUrls,
  recordDecision,
  resolveWpProduct,
  type DecisionDetail,
  type ResolvedWpProduct,
  type WpCandidateTier,
  type WpDecision,
  type WpHttp,
  type WpImageCandidate,
} from './wp-image-sync.core';
import { buildWpMatcher, type WpCatalogItem, type WpMatcher, type WpSuggestion } from './wp-image-suggest';

export const WP_HTTP = Symbol('WP_HTTP');

const MSG = {
  noProduct: 'Không tìm thấy sản phẩm.',
  notCandidate: 'Sản phẩm này không nằm trong danh sách ứng viên ảnh WordPress.',
  partner: 'Sản phẩm của đối tác: đối tác tự sửa ảnh trong Cổng người bán, không sửa ở đây.',
  hasImages: 'Sản phẩm đã có ảnh, không ghi đè. Muốn đổi ảnh thì sửa trong trang sản phẩm.',
  badUrl: 'Có ảnh không nằm trong danh sách ảnh WordPress của sản phẩm này. Tải lại danh sách rồi chọn lại.',
  wpDown: 'Không đọc được ảnh từ WordPress. Trang cũ có thể đã tắt hoặc chặn truy cập.',
  alreadyApplied: 'Ảnh sản phẩm này đã được nạp từ WordPress. Muốn đổi thì sửa trong trang sản phẩm.',
} as const;

const WP_CACHE_TTL_MS = 10 * 60 * 1000;
const WP_LOOKUP_CONCURRENCY = 3;
const SUGGEST_NAME_MAX = 60;

export type WpRowState = 'PENDING' | 'SKIPPED' | 'APPLIED' | 'HAS_IMAGES';
/** NONE: sản phẩm đang rỗng ảnh nhưng WordPress không có gì đủ giống để gợi ý (không có thao tác duyệt, cần ảnh mới). */
export type WpRowTier = WpCandidateTier | 'NONE';

const NONE_LABEL = 'Chưa có gợi ý';
const NOTE_NO_MATCH = 'Chưa thấy sản phẩm nào ở WordPress đủ giống tên để gợi ý ảnh. Cần ảnh mới: tải lên ở trang sản phẩm.';
const NOTE_WP_DOWN = 'Chưa đọc được kho sản phẩm WordPress để gợi ý ảnh. Bấm "Tải lại" sau ít phút.';
const NOTE_APPLIED_BY_SUGGESTION = 'Ảnh đã được nạp từ WordPress theo gợi ý tên.';
const NOTE_HAS_IMAGES = 'Sản phẩm đã có ảnh.';

const clip = (s: string): string => (s.length > SUGGEST_NAME_MAX ? `${s.slice(0, SUGGEST_NAME_MAX - 1)}…` : s);
const suggestionNote = (found: readonly WpSuggestion[]): string =>
  `Gợi ý tự động theo tên, chưa ai kiểm bao bì: ${found.map((f) => `"${clip(f.name)}" (khớp ${Math.round(f.score * 100)}%)`).join('; ')}. Đối chiếu bao bì trước khi duyệt.`;

/** Ứng viên dựng từ gợi ý tên cho sản phẩm không nằm trong bảng làm tay; null khi WordPress không có gì đủ giống. Hạng luôn là CANDIDATE, không bao giờ EXACT. */
function suggestCandidate(product: { slug: string; name: string; brand: string }, matcher: WpMatcher): WpImageCandidate | null {
  const found = matcher({ name: product.name, brand: product.brand });
  return found.length === 0 ? null : { productSlug: product.slug, tier: 'CANDIDATE', sources: found.map((f) => f.source), note: suggestionNote(found) };
}

export interface WpImageRow {
  productId: string;
  productSlug: string;
  name: string;
  isActive: boolean;
  variations: string[];
  tier: WpRowTier;
  tierLabel: string;
  note: string;
  state: WpRowState;
  decidedBy: string | null;
  decidedAt: string | null;
  appliedCount: number | null;
  /** null khi chưa hỏi WordPress (danh sách mở nhanh, không gọi mạng). */
  wp: ResolvedWpProduct[] | null;
  /** Bộ ảnh mà "Duyệt" dùng khi không chọn tay; cùng luật với `applyWpCandidate` nên bảng duyệt không tự suy lại. */
  defaultImageUrls: string[] | null;
}

export interface WpImageListResponse {
  items: WpImageRow[];
  counts: Record<WpRowState, number>;
}

export interface WpImageActionResponse {
  productId: string;
  state: WpRowState;
  appliedCount?: number;
}

/**
 * Bàn duyệt ảnh WordPress cho sản phẩm chưa có ảnh (Admin → Sản phẩm). Chỉ đọc GET công khai của WordPress; ảnh được tải, nén rồi lưu vào
 * `products.images` (không hotlink). Không có endpoint nhận URL tuỳ ý: ảnh duyệt phải nằm trong danh sách WordPress đang trả cho đúng ứng viên.
 */
@Injectable()
export class WpImageSyncService {
  private readonly logger = new Logger(WpImageSyncService.name);
  private readonly http: WpHttp;
  private readonly cache = new Map<string, { at: number; value: ResolvedWpProduct }>();
  /** Mỗi lượt duyệt tải tới 8 ảnh nguồn (8 MB, 16 MP mỗi ảnh) qua sharp: nối đuôi để hai lượt đồng thời không cộng dồn RAM. */
  private tail: Promise<unknown> = Promise.resolve();
  private catalogCache: { at: number; value: WpCatalogItem[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageResize: ImageResizeService,
    @Optional() @Inject(WP_HTTP) http?: WpHttp,
  ) {
    this.http = http ?? nodeWpHttp;
  }

  async list(live: boolean): Promise<WpImageListResponse> {
    const candidates = WP_IMAGE_CANDIDATES;
    const slugs = candidates.map((c) => c.productSlug);
    const [products, empty, decisions] = await Promise.all([
      this.prisma.product.findMany({
        where: { slug: { in: slugs }, storefrontId: null },
        select: { id: true, slug: true, name: true, isActive: true, variations: { where: { isActive: true }, select: { name: true }, orderBy: VARIATION_ORDER_BY } },
      }),
      // Không tải cột images (base64 nhiều MB): chỉ cần biết sản phẩm nào đang rỗng.
      this.prisma.product.findMany({ where: { slug: { in: slugs }, images: { isEmpty: true } }, select: { slug: true } }),
      loadDecisions(this.prisma),
    ]);
    const bySlug = new Map(products.map((p) => [p.slug, p]));
    const emptySlugs = new Set(empty.map((p) => p.slug));

    const rows: WpImageRow[] = [];
    for (const candidate of candidates) {
      const product = bySlug.get(candidate.productSlug);
      if (!product) continue;
      const decision = decisions.get(candidate.productSlug);
      let state: WpRowState;
      if (decision?.decision === 'APPLIED') state = 'APPLIED';
      else if (!emptySlugs.has(candidate.productSlug)) state = 'HAS_IMAGES';
      else state = decision?.decision === 'SKIPPED' ? 'SKIPPED' : 'PENDING';
      rows.push({
        productId: product.id,
        productSlug: product.slug,
        name: product.name,
        isActive: product.isActive,
        variations: product.variations.map((v) => v.name),
        tier: candidate.tier,
        tierLabel: WP_TIER_LABELS[candidate.tier],
        note: candidate.note,
        state,
        decidedBy: decision?.by ?? null,
        decidedAt: decision?.at ?? null,
        appliedCount: decision?.decision === 'APPLIED' ? (decision.imageCount ?? null) : null,
        wp: null,
        defaultImageUrls: null,
      });
    }

    const candidateBySlug = new Map<string, WpImageCandidate>(candidates.map((c) => [c.productSlug, c]));
    if (live) {
      // Sản phẩm rỗng ảnh chưa có dòng làm tay: gợi ý theo tên (CANDIDATE) hoặc báo chưa có gợi ý (NONE). Chỉ ở chế độ live vì cần kho WordPress.
      const extra = await this.suggestedRows(decisions, new Set(slugs));
      rows.push(...extra.rows);
      for (const [slug, candidate] of extra.candidates) candidateBySlug.set(slug, candidate);

      const toResolve = rows.filter((r) => (r.state === 'PENDING' || r.state === 'SKIPPED') && candidateBySlug.has(r.productSlug));
      await this.pool(toResolve, async (row) => {
        const candidate = candidateBySlug.get(row.productSlug)!;
        row.wp = await Promise.all(candidate.sources.map((s) => this.resolveCached(s)));
        row.defaultImageUrls = pickImageUrls(candidate.tier, row.wp);
      });
    }

    const counts: Record<WpRowState, number> = { PENDING: 0, SKIPPED: 0, APPLIED: 0, HAS_IMAGES: 0 };
    for (const r of rows) counts[r.state] += 1;
    return { items: rows, counts };
  }

  async approve(adminId: string, productId: string, imageUrls?: string[]): Promise<WpImageActionResponse> {
    const { candidate } = await this.loadCandidate(productId);
    const resolved = await Promise.all(candidate.sources.map((s) => this.resolveCached(s)));
    if (imageUrls) {
      const allowed = new Set(resolved.flatMap((r) => r.imageUrls));
      if (imageUrls.length === 0 || imageUrls.length > PRODUCT_IMAGES_LIMIT || imageUrls.some((u) => !allowed.has(u))) {
        if (resolved.every((r) => r.error)) throw new BadGatewayException(MSG.wpDown);
        throw new BadRequestException(MSG.badUrl);
      }
    }

    const outcome = await this.serialize(() => applyWpCandidate({ store: this.prisma, http: this.http, resolved }, { candidate, imageUrls, actor: adminId }));
    if (outcome.status === 'FAILED') {
      this.logger.warn(`Nạp ảnh WordPress cho ${candidate.productSlug} thất bại: ${outcome.reason}`);
      throw new BadGatewayException(outcome.reason);
    }
    if (outcome.status === 'SKIPPED') {
      if (outcome.reason === 'PARTNER_OWNED') throw new ConflictException(MSG.partner);
      if (outcome.reason === 'PRODUCT_NOT_FOUND') throw new NotFoundException(MSG.noProduct);
      if (outcome.reason === 'HAS_IMAGES') throw new ConflictException(MSG.hasImages);
      throw new BadGatewayException(MSG.wpDown);
    }
    this.imageResize.invalidateRegistry();
    this.logger.log(`Admin ${adminId} nạp ${outcome.imageCount} ảnh WordPress cho sản phẩm ${productId} (${candidate.tier}).`);
    return { productId, state: 'APPLIED', appliedCount: outcome.imageCount };
  }

  /** Cùng hàng đợi với `approve`: kiểm rồi ghi quyết định không được chen vào giữa lúc một lượt duyệt đang ghi ảnh, nếu không SKIPPED đè lên APPLIED. */
  async skip(adminId: string, productId: string): Promise<WpImageActionResponse> {
    return this.serialize<WpImageActionResponse>(async () => {
      const { candidate, hasImages } = await this.loadCandidate(productId);
      if (hasImages) throw new ConflictException(MSG.hasImages);
      await this.assertNotApplied(candidate);
      await recordDecision(this.prisma, candidate.productSlug, { decision: 'SKIPPED', by: adminId, at: new Date().toISOString() });
      return { productId, state: 'SKIPPED' };
    });
  }

  /** Xem lại ứng viên đã bỏ qua. Ảnh đã nạp không gỡ ở đây (đó là sửa sản phẩm). Cùng hàng đợi với `approve` như `skip`. */
  async restore(productId: string): Promise<WpImageActionResponse> {
    return this.serialize<WpImageActionResponse>(async () => {
      const { candidate } = await this.loadCandidate(productId);
      await this.assertNotApplied(candidate);
      await clearDecision(this.prisma, candidate.productSlug);
      return { productId, state: 'PENDING' };
    });
  }

  /**
   * Dòng cho sản phẩm đang bán, rỗng ảnh, không nằm trong bảng làm tay (cộng sản phẩm đã có quyết định duyệt để dòng "Đã duyệt" không biến mất).
   * Có gợi ý theo tên thì hạng CANDIDATE kèm ứng viên để tải ảnh WordPress; không có thì hạng NONE và không có thao tác duyệt.
   */
  private async suggestedRows(decisions: ReadonlyMap<string, DecisionDetail>, curatedSlugs: ReadonlySet<string>): Promise<{ rows: WpImageRow[]; candidates: Map<string, WpImageCandidate> }> {
    const decidedSlugs = [...decisions.keys()].filter((s) => !curatedSlugs.has(s));
    const products = await this.prisma.product.findMany({
      where: { storefrontId: null, slug: { notIn: [...curatedSlugs] }, OR: [{ isActive: true, images: { isEmpty: true } }, { slug: { in: decidedSlugs } }] },
      select: { id: true, slug: true, name: true, brand: true, isActive: true, variations: { where: { isActive: true }, select: { name: true }, orderBy: VARIATION_ORDER_BY } },
      orderBy: { name: 'asc' },
    });
    const candidates = new Map<string, WpImageCandidate>();
    if (products.length === 0) return { rows: [], candidates };

    // Không tải cột images (base64 nhiều MB): chỉ cần biết sản phẩm nào đang rỗng.
    const empty = await this.prisma.product.findMany({ where: { slug: { in: products.map((p) => p.slug) }, images: { isEmpty: true } }, select: { slug: true } });
    const emptySlugs = new Set(empty.map((p) => p.slug));
    const stateOf = (slug: string): WpRowState => {
      const decision = decisions.get(slug)?.decision;
      if (decision === 'APPLIED') return 'APPLIED';
      if (!emptySlugs.has(slug)) return 'HAS_IMAGES';
      return decision === 'SKIPPED' ? 'SKIPPED' : 'PENDING';
    };
    const open = products.filter((p) => stateOf(p.slug) === 'PENDING' || stateOf(p.slug) === 'SKIPPED');
    const catalog = open.length > 0 ? await this.catalog() : null;
    const matcher = catalog ? buildWpMatcher(catalog) : null;

    const rows: WpImageRow[] = products.map((p) => {
      const state = stateOf(p.slug);
      const decision = decisions.get(p.slug);
      let tier: WpRowTier = 'NONE';
      let note = NOTE_HAS_IMAGES;
      if (state === 'APPLIED') {
        tier = 'CANDIDATE';
        note = NOTE_APPLIED_BY_SUGGESTION;
      } else if (state !== 'HAS_IMAGES') {
        const candidate = matcher ? suggestCandidate(p, matcher) : null;
        if (candidate) candidates.set(p.slug, candidate);
        tier = candidate ? 'CANDIDATE' : 'NONE';
        note = candidate?.note ?? (matcher ? NOTE_NO_MATCH : NOTE_WP_DOWN);
      }
      return {
        productId: p.id,
        productSlug: p.slug,
        name: p.name,
        isActive: p.isActive,
        variations: p.variations.map((v) => v.name),
        tier,
        tierLabel: tier === 'NONE' ? NONE_LABEL : WP_TIER_LABELS[tier],
        note,
        state,
        decidedBy: decision?.by ?? null,
        decidedAt: decision?.at ?? null,
        appliedCount: decision?.decision === 'APPLIED' ? (decision.imageCount ?? null) : null,
        wp: null,
        defaultImageUrls: null,
      };
    });
    // Dòng có gợi ý lên trước dòng không có; trong cùng nhóm giữ thứ tự tên.
    rows.sort((a, b) => Number(a.tier === 'NONE') - Number(b.tier === 'NONE'));
    return { rows, candidates };
  }

  private async catalog(): Promise<WpCatalogItem[] | null> {
    if (this.catalogCache && Date.now() - this.catalogCache.at < WP_CACHE_TTL_MS) return this.catalogCache.value;
    const value = await loadWpCatalog(this.http);
    // Lỗi (WordPress tắt, mạng chập chờn) không cache, như `resolveCached`.
    if (value) this.catalogCache = { at: Date.now(), value };
    return value;
  }

  /** Ứng viên theo gợi ý tên cho sản phẩm ngoài bảng làm tay. Sản phẩm đối tác hoặc đang tắt không có; kho WordPress không đọc được thì 502; không có gì giống thì coi như không phải ứng viên. */
  private async suggestFor(product: { slug: string; name: string; brand: string; isActive: boolean; storefrontId: string | null }): Promise<WpImageCandidate> {
    if (product.storefrontId !== null || !product.isActive) throw new NotFoundException(MSG.notCandidate);
    const catalog = await this.catalog();
    if (!catalog) throw new BadGatewayException(MSG.wpDown);
    const candidate = suggestCandidate(product, buildWpMatcher(catalog));
    if (!candidate) throw new NotFoundException(MSG.notCandidate);
    return candidate;
  }

  private async loadCandidate(productId: string): Promise<{ candidate: WpImageCandidate; hasImages: boolean }> {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { slug: true, name: true, brand: true, isActive: true, storefrontId: true } });
    if (!product) throw new NotFoundException(MSG.noProduct);
    const candidate = candidateForSlug(product.slug) ?? (await this.suggestFor(product));
    if (product.storefrontId !== null) throw new ConflictException(MSG.partner);
    const empty = await this.prisma.product.count({ where: { id: productId, images: { isEmpty: true } } });
    return { candidate, hasImages: empty === 0 };
  }

  private async assertNotApplied(candidate: WpImageCandidate): Promise<void> {
    const decisions = await loadDecisions(this.prisma);
    const d: { decision: WpDecision } | undefined = decisions.get(candidate.productSlug);
    if (d?.decision === 'APPLIED') throw new ConflictException(MSG.alreadyApplied);
  }

  private async resolveCached(source: { id: number; slug: string }): Promise<ResolvedWpProduct> {
    const hit = this.cache.get(source.slug);
    if (hit && Date.now() - hit.at < WP_CACHE_TTL_MS) return hit.value;
    const value = await resolveWpProduct(this.http, source);
    // Lỗi (WordPress tắt, mạng chập chờn) không cache: lần bấm "Tải lại" kế tiếp phải thử lại thật.
    if (!value.error) this.cache.set(source.slug, { at: Date.now(), value });
    return value;
  }

  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async pool<T>(items: readonly T[], worker: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const lanes = Array.from({ length: Math.min(WP_LOOKUP_CONCURRENCY, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]!);
    });
    await Promise.all(lanes);
  }
}
