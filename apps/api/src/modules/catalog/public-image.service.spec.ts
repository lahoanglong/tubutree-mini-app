import { NotFoundException } from '@nestjs/common';
import { publicImageVersion } from '../../common/public-image';
import { PublicImageService } from './public-image.service';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** `product`: dòng của findFirst (thumbnail); `images`: kết quả của truy vấn một phần tử `images[n]`. */
function make(rows: { product?: object | null; images?: (string | null)[]; brand?: object | null; course?: object | null }) {
  const prisma = {
    $queryRaw: jest.fn(async (q: { values: unknown[] }) => {
      const n = Number(q.values[0]) - 1;
      const image = rows.images?.[n];
      return image === undefined ? [] : [{ image }];
    }),
    product: { findFirst: jest.fn().mockResolvedValue(rows.product ?? null) },
    brand: { findFirst: jest.fn().mockResolvedValue(rows.brand ?? null) },
    course: { findFirst: jest.fn().mockResolvedValue(rows.course ?? null) },
  };
  return { svc: new PublicImageService(prisma as never), prisma };
}

describe('PublicImageService', () => {
  it('ảnh sản phẩm theo ô số: chỉ đọc đúng một phần tử bằng SQL tham số hoá, không đọc cả mảng', async () => {
    const { svc, prisma } = make({ images: [PNG, null, PNG] });
    const v = publicImageVersion('product', 'p1', 2, PNG);
    const ok = await svc.get('product', 'p1', '2', v);
    expect(ok).toMatchObject({ mime: 'image/png', versionOk: true });
    expect(ok.data.length).toBeGreaterThan(0);
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
    const q = prisma.$queryRaw.mock.calls[0]![0] as unknown as { sql: string; values: unknown[] };
    expect(q.sql).toMatch(/"images"\[\?::int\] AS image/);
    expect(q.sql).toContain(`"approvalStatus" = 'APPROVED' OR ("approvalStatus" = 'PENDING_REVIEW' AND "approvedAt" IS NOT NULL)`);
    expect(q.values).toEqual([3, 'p1']);
    expect((await svc.get('product', 'p1', '2', 'sai')).versionOk).toBe(false);
  });

  it('thumb với thumbnail base64: chỉ select cột thumbnail, không đụng mảng images', async () => {
    const { svc, prisma } = make({ product: { thumbnail: PNG } });
    expect((await svc.get('product', 'p1', 'thumb', publicImageVersion('product', 'p1', 'thumb', PNG))).versionOk).toBe(true);
    expect(prisma.product.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', OR: [{ approvalStatus: 'APPROVED' }, { approvalStatus: 'PENDING_REVIEW', approvedAt: { not: null } }] }, select: { thumbnail: true } });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('thumb với thumbnail không phải base64 (link hay tham chiếu ô 0): lấy đúng phần tử đầu của images', async () => {
    const { svc, prisma } = make({ product: { thumbnail: '/public-image/product/p1/0?v=x' }, images: [PNG] });
    expect((await svc.get('product', 'p1', 'thumb', undefined)).mime).toBe('image/png');
    expect((prisma.$queryRaw.mock.calls[0]![0] as unknown as { values: unknown[] }).values).toEqual([1, 'p1']);
  });

  it('sản phẩm không có (chưa từng được duyệt, hoặc không tồn tại) → 404, thumb không đọc images', async () => {
    const { svc, prisma } = make({});
    await expect(svc.get('product', 'p1', 'thumb', undefined)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    await expect(svc.get('product', 'p1', '0', undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('nhãn: ảnh câu chuyện theo số thứ tự storyImages, số lạ hoặc ngoài mảng thì 404', async () => {
    const { svc, prisma } = make({ brand: { storyImages: ['https://x.test/a.jpg', PNG] } });
    expect((await svc.get('brand', 'b1', '1', undefined)).mime).toBe('image/png');
    expect(prisma.brand.findFirst).toHaveBeenCalledWith({ where: { id: 'b1', isPublished: true }, select: { storyImages: true } });
    await expect(svc.get('brand', 'b1', '0', undefined)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.get('brand', 'b1', '5', undefined)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.get('brand', 'b1', '01', undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('nhãn: chỉ select đúng cột cần, và chỉ khi đã công bố; khoá học chỉ ô cover', async () => {
    const { svc, prisma } = make({ brand: { logoUrl: PNG }, course: { coverUrl: PNG } });
    expect((await svc.get('brand', 'b1', 'logo', undefined)).mime).toBe('image/png');
    expect(prisma.brand.findFirst).toHaveBeenCalledWith({ where: { id: 'b1', isPublished: true }, select: { logoUrl: true } });
    prisma.brand.findFirst.mockResolvedValue({ coverUrl: null });
    await expect(svc.get('brand', 'b1', 'cover', undefined)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.brand.findFirst).toHaveBeenLastCalledWith({ where: { id: 'b1', isPublished: true }, select: { coverUrl: true } });
    expect((await svc.get('academy', 'c1', 'cover', undefined)).mime).toBe('image/png');
    await expect(svc.get('academy', 'c1', 'logo', undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['loại lạ', 'user', '1', '0'],
    ['ô không phải số', 'product', 'p1', 'abc'],
    ['ô quá lớn', 'product', 'p1', '99'],
    ['ô có số 0 đứng đầu', 'product', 'p1', '00'],
    ['ô hex', 'product', 'p1', '0x0'],
    ['ô có khoảng trắng', 'product', 'p1', ' 0'],
  ])('404: %s', async (_l, kind, id, slot) => {
    await expect(make({ images: [PNG] }).svc.get(kind, id, slot, undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ảnh không phải raster (SVG) → 404', async () => {
    await expect(make({ images: ['data:image/svg+xml;base64,PHN2Zz4='] }).svc.get('product', 'p1', '0', undefined)).rejects.toBeInstanceOf(NotFoundException);
  });
});
