import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { CARD_VARIATION_SELECT } from '../catalog/card-select';
import { cardPrices, VARIATION_ORDER_BY } from '../catalog/variation-order';
import { fallbackKitCopy } from './content-kit-fallback-notice';

/** Giá đang bán của thẻ sản phẩm (`cardPrices`): giá giảm khi có và thấp hơn giá gốc; giá lỗi thì 0. */
function sellingPrice(base: number | null | undefined, sale: number | null | undefined): number {
  const b = typeof base === 'number' && Number.isFinite(base) && base > 0 ? base : 0;
  return typeof sale === 'number' && sale > 0 && (b === 0 || sale < b) ? sale : b;
}

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
      select: {
        id: true,
        name: true,
        images: true,
        isActive: true,
        affiliateBlocked: true,
        basePrice: true,
        salePrice: true,
        brand: true,
        brandRef: { select: { name: true } },
        // Pancake ghi giá bán vào phân loại chứ không vào Product.salePrice: ảnh và câu mẫu ghi đúng giá thẻ/trang chi tiết.
        variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY, select: CARD_VARIATION_SELECT },
      },
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

    // URL gốc Mini App (zalo.me/s/<Mini App ID>): /product/:slug là route của Mini App. Bỏ "/" cuối để admin gõ thừa không sinh "//product".
    const rawBase: unknown = await this.config.get<string>('app.miniapp_base_url', '');
    const baseUrl = typeof rawBase === 'string' ? rawBase.trim().replace(/\/+$/, '') : '';
    const link = `${baseUrl}/product/${productSlug}?ref=${user.referralCode}`;
    const ctvName = user.fullName?.trim() || 'Shop';
    // 1 lần quét duy nhất bằng regex + hàm thay thế (KHÔNG dùng 2 lần .replaceAll string nối
    // tiếp): tránh (a) lượt thay thế sau khớp nhầm vào text vừa được chèn bởi lượt trước (vd
    // fullName chứa chuỗi "{link}"), và (b) $-pattern đặc biệt của replace() (vd fullName="$&")
    // làm sai lệch nội dung khi dùng replacement dạng string.
    const substitute = (text: string) =>
      text.replace(/\{ten_ctv\}|\{link\}/g, (m) => (m === '{ten_ctv}' ? ctvName : link));

    const card = cardPrices(product, product.variations);
    const priceVnd = sellingPrice(card.basePrice, card.salePrice);
    const brandName = product.brandRef?.name?.trim() || product.brand?.trim() || null;
    // Admin chưa soạn bài mẫu/điểm bán hàng thì dựng câu an toàn từ tên, thương hiệu, giá: CTV vẫn có câu kèm link giới thiệu để gửi ngay.
    const fallback = fallbackKitCopy({ productName: product.name, brandName, priceVnd, ctvName: user.fullName?.trim() || null, link });
    const captions = (kit?.captions ?? []).map(substitute);
    const usps = kit?.usps ?? [];

    return {
      productName: product.name,
      brandName,
      priceVnd,
      referralCode: user.referralCode,
      images: product.images,
      captions: captions.length > 0 ? captions : fallback.captions,
      usps: usps.length > 0 ? usps : fallback.usps,
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
      // Lưu object thuần {q, a}: dto.faqs qua ValidationPipe là thể hiện lớp DTO.
      faqs: (dto.faqs?.map((f) => ({ q: f.q, a: f.a })) as object | undefined) ?? undefined,
      videoUrls: dto.videoUrls ?? [],
    };
    return this.prisma.productContentKit.upsert({
      where: { productId },
      create: { productId, ...data },
      update: data,
    });
  }
}
