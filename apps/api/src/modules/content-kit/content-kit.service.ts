import { Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

export interface FaqEntryInput {
  q: string;
  a: string;
}

export interface UpsertContentKitInput {
  captions?: string[];
  usps?: string[];
  faqs?: FaqEntryInput[];
  videoUrls?: string[];
}

/**
 * CTV Content Kit (Bộ nội dung bán hàng) — thư viện bài mẫu/USP/FAQ/media theo từng sản phẩm.
 * Admin nạp nội dung; CTV lấy về đã TỰ CHÈN tên mình + link giới thiệu (placeholder
 * {ten_ctv}/{link} trong caption) để copy & chia sẻ ngay, không cần soạn tay.
 */
@Injectable()
export class ContentKitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  /** CTV: nội dung sản phẩm đã cá nhân hoá (tên CTV + link giới thiệu riêng). */
  async getForCtv(userId: string, productSlug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug: productSlug },
      select: { id: true, name: true, images: true },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');

    const [kit, user] = await Promise.all([
      this.prisma.productContentKit.findUnique({ where: { productId: product.id } }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { fullName: true, referralCode: true },
      }),
    ]);

    const baseUrl = await this.config.get<string>('app.miniapp_base_url', '');
    const link = `${baseUrl}/product/${productSlug}?ref=${user.referralCode}`;
    const ctvName = user.fullName?.trim() || 'Shop';
    const substitute = (text: string) =>
      text.replaceAll('{ten_ctv}', ctvName).replaceAll('{link}', link);

    return {
      productName: product.name,
      images: product.images,
      captions: (kit?.captions ?? []).map(substitute),
      usps: kit?.usps ?? [],
      faqs: (kit?.faqs as FaqEntryInput[] | null) ?? [],
      videoUrls: kit?.videoUrls ?? [],
      shareLink: link,
    };
  }

  /** Admin: nội dung gốc (chưa cá nhân hoá) để chỉnh sửa. */
  get(productId: string) {
    return this.prisma.productContentKit.findUnique({ where: { productId } });
  }

  /** Admin: tạo/cập nhật content kit cho 1 sản phẩm. */
  upsert(productId: string, dto: UpsertContentKitInput) {
    const data = {
      captions: dto.captions ?? [],
      usps: dto.usps ?? [],
      faqs: (dto.faqs as object | undefined) ?? undefined,
      videoUrls: dto.videoUrls ?? [],
    };
    return this.prisma.productContentKit.upsert({
      where: { productId },
      create: { productId, ...data },
      update: data,
    });
  }
}
