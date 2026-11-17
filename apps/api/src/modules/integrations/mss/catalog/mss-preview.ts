import { Controller, Get, Header, Injectable, Logger, NotFoundException, Optional, Query, ServiceUnavailableException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../../common/decorators/public.decorator';
import { PrismaService } from '../../../../prisma/prisma.service';
import { CatalogService } from '../../../catalog/catalog.service';
import type { MssEnrichmentPayload } from '../../../catalog/mss-enrichment';
import { MssFlagsService } from '../mss-flags';
import { MssClient, MssRequestError } from '../mss.client';
import { parseMssProductDoc } from './mss-catalog-doc';
import { mssMediaHosts } from './mss-media';
import { verifyMssPreviewToken } from './mss-preview-token';

/** Thân lỗi ổn định cho trang `_preview` của web: hết hạn/sai token và không tìm thấy đều là 404 (không nói sai ở đâu). */
export const MSS_PREVIEW_EXPIRED = { error: 'preview_expired', message: 'Phiên xem trước đã hết hạn, mở lại từ MSS' } as const;
export const MSS_PREVIEW_UNAVAILABLE = { error: 'preview_unavailable', message: 'MSS chưa trả được bản nháp, thử lại sau' } as const;

@Injectable()
export class MssPreviewService {
  private readonly logger = new Logger(MssPreviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: MssFlagsService,
    private readonly client: MssClient,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  /**
   * Trang sản phẩm dựng từ dữ liệu Tubu (giá, tồn, biến thể, đánh giá) cộng nội dung NHÁP của MSS, đúng dạng `GET /products/:slug`.
   * Bản nháp lấy trực tiếp từ MSS theo token, không lưu ở đâu. Token sai/hết hạn thì 404 mà không gọi MSS.
   */
  async product(token: unknown) {
    const env = this.flags.env();
    const claims = verifyMssPreviewToken(token, env.inboundSecret ? [env.inboundSecret, env.inboundSecretPrev] : []);
    if (!claims || !this.flags.configured()) throw new NotFoundException(MSS_PREVIEW_EXPIRED);
    let data: unknown;
    try {
      const res = await this.client.request('GET', `/catalog/preview?token=${encodeURIComponent(token as string)}`, { op: 'GET catalog/preview' });
      data = res.data;
    } catch (err) {
      if (err instanceof MssRequestError && (err.status === 401 || err.status === 404 || err.status === 410)) throw new NotFoundException(MSS_PREVIEW_EXPIRED);
      this.logger.warn(`Không lấy được bản nháp MSS: ${err instanceof MssRequestError ? err.kind : err instanceof Error ? err.message : err}`);
      throw new ServiceUnavailableException(MSS_PREVIEW_UNAVAILABLE);
    }
    const parsed = parseMssProductDoc(data, { mediaHosts: mssMediaHosts(), preview: true });
    // Bản MSS trả phải đúng sản phẩm của token: MSS lỗi trả nhầm sản phẩm thì không hiện nội dung của sản phẩm khác.
    if (!parsed.ok || parsed.doc.pancakeProductId !== claims.pid) throw new ServiceUnavailableException(MSS_PREVIEW_UNAVAILABLE);
    const product = await this.prisma.product.findUnique({ where: { pancakeId: claims.pid }, select: { slug: true } });
    if (!product) throw new NotFoundException({ error: 'not_found', message: 'Sản phẩm chưa có trên Tubu' });
    const payload = await this.withCategories(parsed.doc.payload, parsed.doc.categorySlugs);
    const catalog = this.moduleRef?.get(CatalogService, { strict: false });
    if (!catalog) throw new ServiceUnavailableException(MSS_PREVIEW_UNAVAILABLE);
    const pdp = await catalog.getBySlug(product.slug, { enrichment: payload });
    return { ...pdp, preview: { version: claims.ver, expiresAt: new Date(claims.exp * 1000).toISOString() } };
  }

  private async withCategories(payload: MssEnrichmentPayload, slugs: string[] | null): Promise<MssEnrichmentPayload> {
    if (slugs === null) return payload;
    const rows = slugs.length ? await this.prisma.category.findMany({ where: { slug: { in: slugs } }, select: { id: true } }) : [];
    return { ...payload, categoryIds: slugs.length > 0 && rows.length === 0 ? null : rows.map((r) => r.id) };
  }
}

/**
 * Bản xem trước cho người soạn ở MSS (hợp đồng mục 1.5). Công khai nhưng chỉ mở bằng token MSS ký; không lưu bộ đệm, không cho máy tìm
 * kiếm lập chỉ mục. Trang web `/san-pham/_preview` gọi đường này từ máy chủ.
 */
@Controller('mss/preview')
export class MssPreviewController {
  constructor(private readonly preview: MssPreviewService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('product')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  product(@Query('token') token: string) {
    return this.preview.product(token);
  }
}
