import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

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
      select: { id: true, name: true, images: true, isActive: true, affiliateBlocked: true },
    });
    // Nhất quán với storefront/brand: SP ngừng bán hoặc bị chặn affiliate thì KHÔNG được tạo
    // nội dung quảng bá (kèm link giới thiệu) cho nó — coi như không tồn tại với CTV.
    if (!product || !product.isActive || product.affiliateBlocked) {
      throw new NotFoundException('Không tìm thấy sản phẩm.');
    }

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
    // 1 lần quét duy nhất bằng regex + hàm thay thế (KHÔNG dùng 2 lần .replaceAll string nối
    // tiếp): tránh (a) lượt thay thế sau khớp nhầm vào text vừa được chèn bởi lượt trước (vd
    // fullName chứa chuỗi "{link}"), và (b) $-pattern đặc biệt của replace() (vd fullName="$&")
    // làm sai lệch nội dung khi dùng replacement dạng string.
    const substitute = (text: string) =>
      text.replace(/\{ten_ctv\}|\{link\}/g, (m) => (m === '{ten_ctv}' ? ctvName : link));

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
