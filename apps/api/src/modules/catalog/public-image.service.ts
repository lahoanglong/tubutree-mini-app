import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decodeServedImage } from '../../common/served-image';
import { isPublicImageKind, publicImageVersion, type PublicImageSlot } from '../../common/public-image';
import { timingSafeEqual } from 'node:crypto';

const same = (a: unknown, b: string) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Byte của ảnh base64 đang hiện công khai (đích của `publicImageRef`): sản phẩm đã duyệt, nhãn và khoá học đã công bố.
 * Mỗi lần chỉ đọc đúng một ảnh từ Postgres: mảng `images` của sản phẩm có thể nặng hàng chục MB, một trang danh mục xin cả chục ảnh.
 *
 * Sản phẩm đang chờ duyệt lại (đối tác đổi mã/liên kết) vẫn phát ảnh nếu từng được duyệt (`approvedAt`): giỏ, đơn cũ và hàng đã mua
 * của khách vẫn có ảnh như trước khi ảnh đi qua endpoint này. Sản phẩm chưa từng được duyệt, bị từ chối, hoặc đã đổi ảnh chờ duyệt lại (`approvedAt` bị xoá) thì không.
 */
const EVER_PUBLIC = Prisma.sql`("approvalStatus" = 'APPROVED' OR ("approvalStatus" = 'PENDING_REVIEW' AND "approvedAt" IS NOT NULL))`;

@Injectable()
export class PublicImageService {
  constructor(private readonly prisma: PrismaService) {}

  /** Phần tử thứ `index` (từ 0) của images, tham số hoá, không kéo cả mảng. */
  private async productImage(id: string, index: number): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ image: string | null }[]>(
      Prisma.sql`SELECT "images"[${index + 1}::int] AS image FROM "products" WHERE "id" = ${id} AND ${EVER_PUBLIC} LIMIT 1`,
    );
    return rows[0]?.image ?? null;
  }

  async get(kind: string, id: string, slotRaw: string, version: unknown): Promise<{ mime: string; data: Buffer; versionOk: boolean }> {
    const notFound = () => new NotFoundException('Không tìm thấy ảnh.');
    if (!isPublicImageKind(kind)) throw notFound();
    let slot: PublicImageSlot;
    let image: string | null | undefined;
    if (kind === 'product') {
      if (slotRaw === 'thumb') {
        slot = 'thumb';
        const p = await this.prisma.product.findFirst({ where: { id, OR: [{ approvalStatus: 'APPROVED' }, { approvalStatus: 'PENDING_REVIEW', approvedAt: { not: null } }] }, select: { thumbnail: true } });
        image = p ? (p.thumbnail?.startsWith('data:') ? p.thumbnail : await this.productImage(id, 0)) : null;
      } else {
        if (!/^(0|[1-9]\d?)$/.test(slotRaw)) throw notFound();
        const n = Number(slotRaw);
        if (n > 20) throw notFound();
        slot = n;
        image = await this.productImage(id, n);
      }
    } else if (kind === 'brand') {
      if (slotRaw !== 'logo' && slotRaw !== 'cover') throw notFound();
      slot = slotRaw;
      const field = slotRaw === 'logo' ? 'logoUrl' : 'coverUrl';
      const b = await this.prisma.brand.findFirst({ where: { id, isPublished: true }, select: { [field]: true } });
      image = (b as Record<string, string | null> | null)?.[field];
    } else {
      if (slotRaw !== 'cover') throw notFound();
      slot = 'cover';
      const c = await this.prisma.course.findFirst({ where: { id, isPublished: true }, select: { coverUrl: true } });
      image = c?.coverUrl;
    }
    const decoded = decodeServedImage(image);
    if (!image || !decoded) throw notFound();
    return { ...decoded, versionOk: same(version, publicImageVersion(kind, id, slot, image)) };
  }
}
