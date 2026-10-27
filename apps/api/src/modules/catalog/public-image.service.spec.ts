import { NotFoundException } from '@nestjs/common';
import { publicImageVersion } from '../../common/public-image';
import { PublicImageService } from './public-image.service';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function make(rows: { product?: object | null; brand?: object | null; course?: object | null }) {
  const prisma = {
    product: { findFirst: jest.fn().mockResolvedValue(rows.product ?? null) },
    brand: { findFirst: jest.fn().mockResolvedValue(rows.brand ?? null) },
    course: { findFirst: jest.fn().mockResolvedValue(rows.course ?? null) },
  };
  return { svc: new PublicImageService(prisma as never), prisma };
}

describe('PublicImageService', () => {
  it('ảnh sản phẩm đã duyệt: trả byte, mã v đúng thì versionOk', async () => {
    const { svc, prisma } = make({ product: { thumbnail: null, images: [PNG] } });
    const v = publicImageVersion('product', 'p1', 0, PNG);
    const ok = await svc.get('product', 'p1', '0', v);
    expect(ok).toMatchObject({ mime: 'image/png', versionOk: true });
    expect(ok.data.length).toBeGreaterThan(0);
    expect(prisma.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1', approvalStatus: 'APPROVED' } }));
    expect((await svc.get('product', 'p1', '0', 'sai')).versionOk).toBe(false);
  });

  it('thumb: thumbnail base64 nếu có, không thì ảnh đầu', async () => {
    const { svc } = make({ product: { thumbnail: '/public-image/product/p1/0?v=x', images: [PNG] } });
    expect((await svc.get('product', 'p1', 'thumb', undefined)).mime).toBe('image/png');
  });

  it('nhãn chỉ khi đã công bố; khoá học chỉ ô cover', async () => {
    const { svc, prisma } = make({ brand: { logoUrl: PNG, coverUrl: null }, course: { coverUrl: PNG } });
    expect((await svc.get('brand', 'b1', 'logo', undefined)).mime).toBe('image/png');
    expect(prisma.brand.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b1', isPublished: true } }));
    await expect(svc.get('brand', 'b1', 'cover', undefined)).rejects.toBeInstanceOf(NotFoundException);
    expect((await svc.get('academy', 'c1', 'cover', undefined)).mime).toBe('image/png');
    await expect(svc.get('academy', 'c1', 'logo', undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['loại lạ', 'user', '1', '0'],
    ['ô không phải số', 'product', 'p1', 'abc'],
    ['ô quá lớn', 'product', 'p1', '99'],
  ])('404: %s', async (_l, kind, id, slot) => {
    await expect(make({ product: { thumbnail: null, images: [PNG] } }).svc.get(kind, id, slot, undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('không có sản phẩm / ảnh không phải raster (SVG) → 404', async () => {
    await expect(make({}).svc.get('product', 'p1', '0', undefined)).rejects.toBeInstanceOf(NotFoundException);
    await expect(make({ product: { thumbnail: null, images: ['data:image/svg+xml;base64,PHN2Zz4='] } }).svc.get('product', 'p1', '0', undefined)).rejects.toBeInstanceOf(NotFoundException);
  });
});
