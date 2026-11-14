import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SEO_DESC_MAX, SEO_TITLE_MAX, buildMetaDesc, buildMetaTitle, claimsOutsideName, draftSeo, isBlank, seoTextProblems, type SeoDraft, type SeoProductInput } from './seo-enrich.core';

export { SEO_DESC_MAX, SEO_TITLE_MAX, buildMetaDesc, buildMetaTitle, draftSeo, type SeoDraft, type SeoProductInput };

/** Trần số sản phẩm một lần đọc/ghi. Catalog nhà Tubu hiện ~111 SP đang bán nên trần này chỉ để bảo vệ máy chủ. */
export const SEO_LIST_MAX = 2000;
export const SEO_APPLY_MAX_BATCH = 200;

export interface SeoRowDto {
  id: string;
  slug: string;
  name: string;
  brand: string;
  metaTitle: string | null;
  metaDesc: string | null;
  titleLength: number;
  descLength: number;
  missingTitle: boolean;
  missingDesc: boolean;
  tooLongTitle: boolean;
  tooLongDesc: boolean;
  /** Bản nháp dựng từ dữ liệu thật của sản phẩm, luôn tính mới (không đè lên giá trị đang lưu cho tới khi admin duyệt). */
  suggested: SeoDraft;
}

export interface SeoListResponse {
  rows: SeoRowDto[];
  total: number;
  /** Số sản phẩm thiếu `metaTitle` hoặc `metaDesc`. */
  missing: number;
  truncated: boolean;
}

export interface SeoApplyItem {
  productId: string;
  metaTitle: string;
  metaDesc: string;
}

export interface SeoApplyResponse {
  updated: number;
  /** Mã sản phẩm không ghi: không tồn tại, của đối tác, hoặc vừa bị xoá giữa chừng. */
  skippedIds: string[];
}

/**
 * Bổ sung SEO (`metaTitle`, `metaDesc`) cho sản phẩm nhà Tubu đang bán: dựng bản nháp từ dữ liệu thật (xem `seo-enrich.core`), admin xem rồi duyệt ghi.
 * `list` chỉ đọc. `apply` kiểm lại từng chữ admin gửi (trống, độ dài, mã HTML, tuyên bố y tế/chứng nhận ngoài tên sản phẩm) rồi ghi cả lô trong một giao dịch.
 */
@Injectable()
export class SeoEnrichService {
  private readonly logger = new Logger(SeoEnrichService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<SeoListResponse> {
    const found = await this.prisma.product.findMany({
      where: { storefrontId: null, isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: SEO_LIST_MAX + 1,
      select: {
        id: true,
        slug: true,
        name: true,
        brand: true,
        shortDesc: true,
        description: true,
        metaTitle: true,
        metaDesc: true,
        variations: { select: { name: true, isActive: true } },
      },
    });
    const truncated = found.length > SEO_LIST_MAX;
    const rows: SeoRowDto[] = found.slice(0, SEO_LIST_MAX).map((p) => {
      const titleLength = p.metaTitle?.trim().length ?? 0;
      const descLength = p.metaDesc?.trim().length ?? 0;
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        brand: p.brand,
        metaTitle: p.metaTitle,
        metaDesc: p.metaDesc,
        titleLength,
        descLength,
        missingTitle: isBlank(p.metaTitle),
        missingDesc: isBlank(p.metaDesc),
        tooLongTitle: titleLength > SEO_TITLE_MAX,
        tooLongDesc: descLength > SEO_DESC_MAX,
        suggested: draftSeo(p, { onlyMissing: false }),
      };
    });
    return { rows, total: rows.length, missing: rows.filter((r) => r.missingTitle || r.missingDesc).length, truncated };
  }

  async apply(adminId: string, items: readonly SeoApplyItem[]): Promise<SeoApplyResponse> {
    const found = await this.prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) } },
      select: { id: true, name: true, brand: true, storefrontId: true },
    });
    const house = new Map(found.filter((p) => p.storefrontId === null).map((p) => [p.id, p]));

    const reasons: string[] = [];
    for (const item of items) {
      const row = house.get(item.productId);
      const who = row ? `"${row.name}"` : `sản phẩm ${item.productId}`;
      const problems = [...seoTextProblems('Tiêu đề SEO', item.metaTitle, SEO_TITLE_MAX), ...seoTextProblems('Mô tả SEO', item.metaDesc, SEO_DESC_MAX)];
      if (row && problems.length === 0) {
        for (const [label, text] of [['Tiêu đề SEO', item.metaTitle], ['Mô tả SEO', item.metaDesc]] as const) {
          if (claimsOutsideName(text, row.name, row.brand).length > 0) problems.push(`${label} có tuyên bố y tế, chứng nhận hoặc "hữu cơ/thiên nhiên" không nằm trong tên sản phẩm.`);
        }
      }
      for (const p of problems) reasons.push(`${who}: ${p}`);
    }
    if (reasons.length > 0) throw new BadRequestException(reasons.join(' '));

    const toWrite = items.filter((i) => house.has(i.productId));
    const counts = await this.prisma.$transaction(
      toWrite.map((i) =>
        this.prisma.product.updateMany({
          where: { id: i.productId, storefrontId: null },
          data: { metaTitle: i.metaTitle.replace(/\s+/g, ' ').trim(), metaDesc: i.metaDesc.replace(/\s+/g, ' ').trim() },
        }),
      ),
    );
    const skippedIds = items.map((i) => i.productId).filter((id) => !house.has(id));
    let updated = 0;
    counts.forEach((c, idx) => {
      if (c.count > 0) updated += c.count;
      else skippedIds.push(toWrite[idx]!.productId);
    });
    this.logger.warn(`Admin ${adminId} duyệt SEO cho ${updated} sản phẩm${skippedIds.length > 0 ? `, bỏ qua ${skippedIds.length}` : ''}.`);
    return { updated, skippedIds };
  }
}
