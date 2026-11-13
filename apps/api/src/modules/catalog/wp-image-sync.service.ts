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
  nodeWpHttp,
  pickImageUrls,
  recordDecision,
  resolveWpProduct,
  type ResolvedWpProduct,
  type WpCandidateTier,
  type WpDecision,
  type WpHttp,
  type WpImageCandidate,
} from './wp-image-sync.core';

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

export type WpRowState = 'PENDING' | 'SKIPPED' | 'APPLIED' | 'HAS_IMAGES';

export interface WpImageRow {
  productId: string;
  productSlug: string;
  name: string;
  isActive: boolean;
  variations: string[];
  tier: WpCandidateTier;
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

    if (live) {
      const toResolve = rows.filter((r) => r.state === 'PENDING' || r.state === 'SKIPPED');
      await this.pool(toResolve, async (row) => {
        const candidate = this.candidateOf(row.productSlug);
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

  private candidateOf(slug: string): WpImageCandidate {
    const c = candidateForSlug(slug);
    if (!c) throw new NotFoundException(MSG.notCandidate);
    return c;
  }

  private async loadCandidate(productId: string): Promise<{ candidate: WpImageCandidate; hasImages: boolean }> {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { slug: true, storefrontId: true } });
    if (!product) throw new NotFoundException(MSG.noProduct);
    const candidate = candidateForSlug(product.slug);
    if (!candidate) throw new NotFoundException(MSG.notCandidate);
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
