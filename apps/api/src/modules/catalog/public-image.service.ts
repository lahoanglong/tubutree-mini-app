import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { decodeServedImage } from '../../common/served-image';
import { isPublicImageKind, publicImageVersion, type PublicImageSlot } from '../../common/public-image';
import { timingSafeEqual } from 'node:crypto';

const same = (a: unknown, b: string) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Byte của ảnh base64 đang hiện công khai (đích của `publicImageRef`): sản phẩm đã duyệt, nhãn và khoá học đã công bố. */
@Injectable()
export class PublicImageService {
  constructor(private readonly prisma: PrismaService) {}

  async get(kind: string, id: string, slotRaw: string, version: unknown): Promise<{ mime: string; data: Buffer; versionOk: boolean }> {
    const notFound = () => new NotFoundException('Không tìm thấy ảnh.');
    if (!isPublicImageKind(kind)) throw notFound();
    let slot: PublicImageSlot;
    let image: string | null | undefined;
    if (kind === 'product') {
      const p = await this.prisma.product.findFirst({ where: { id, approvalStatus: 'APPROVED' }, select: { thumbnail: true, images: true } });
      if (slotRaw === 'thumb') {
        slot = 'thumb';
        image = p?.thumbnail?.startsWith('data:') ? p.thumbnail : p?.images[0];
      } else {
        const n = Number(slotRaw);
        if (!Number.isInteger(n) || n < 0 || n > 20) throw notFound();
        slot = n;
        image = p?.images[n];
      }
    } else if (kind === 'brand') {
      if (slotRaw !== 'logo' && slotRaw !== 'cover') throw notFound();
      slot = slotRaw;
      const b = await this.prisma.brand.findFirst({ where: { id, isPublished: true }, select: { logoUrl: true, coverUrl: true } });
      image = slotRaw === 'logo' ? b?.logoUrl : b?.coverUrl;
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
