import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { ContentKitService } from './content-kit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

function makeConfig(base = ''): SystemConfigService {
  return {
    get: async <T>(key: string, fb?: T): Promise<T> =>
      (key === 'app.miniapp_base_url' ? (base as unknown as T) : (fb as T)),
  } as unknown as SystemConfigService;
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    product: { findUnique: jest.fn() },
    productContentKit: { findUnique: jest.fn(), upsert: jest.fn() },
    user: { findUniqueOrThrow: jest.fn() },
    ...overrides,
  } as unknown as PrismaService;
}

describe('ContentKitService.getForCtv', () => {
  it('thay {ten_ctv} bằng tên CTV và {link} bằng link chia sẻ trong mọi caption', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trà xanh', images: ['img1.jpg'], isActive: true, affiliateBlocked: false });
    (prisma as any).productContentKit.findUnique.mockResolvedValue({
      captions: ['Xin chào {ten_ctv}, mua ngay {link}', 'Ưu đãi hôm nay {link} nhé {ten_ctv} ơi'],
      usps: ['Sạch, an toàn'],
      faqs: [{ q: 'Ship bao lâu?', a: '2 ngày' }],
      videoUrls: ['v1.mp4'],
    });
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: 'Nguyễn Văn A', referralCode: 'ABC123' });

    const svc = new ContentKitService(prisma, makeConfig());
    const out = await svc.getForCtv('u1', 'tra-xanh');

    expect(out.shareLink).toBe('/product/tra-xanh?ref=ABC123');
    expect(out.captions).toEqual([
      'Xin chào Nguyễn Văn A, mua ngay /product/tra-xanh?ref=ABC123',
      'Ưu đãi hôm nay /product/tra-xanh?ref=ABC123 nhé Nguyễn Văn A ơi',
    ]);
    expect(out.productName).toBe('Trà xanh');
    expect(out.images).toEqual(['img1.jpg']);
    expect(out.usps).toEqual(['Sạch, an toàn']);
    expect(out.faqs).toEqual([{ q: 'Ship bao lâu?', a: '2 ngày' }]);
    expect(out.videoUrls).toEqual(['v1.mp4']);
  });

  it('dùng base URL từ config app.miniapp_base_url khi có cấu hình', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trà xanh', images: [], isActive: true, affiliateBlocked: false });
    (prisma as any).productContentKit.findUnique.mockResolvedValue(null);
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: 'A', referralCode: 'CODE1' });

    const svc = new ContentKitService(prisma, makeConfig('https://zalo.me/s/123'));
    const out = await svc.getForCtv('u1', 'tra-xanh');

    expect(out.shareLink).toBe('https://zalo.me/s/123/product/tra-xanh?ref=CODE1');
  });

  it('kit null → trả mảng rỗng nhưng vẫn dựng đúng shareLink', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trà xanh', images: ['img1.jpg'], isActive: true, affiliateBlocked: false });
    (prisma as any).productContentKit.findUnique.mockResolvedValue(null);
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: 'Nguyễn Văn A', referralCode: 'ABC123' });

    const svc = new ContentKitService(prisma, makeConfig());
    const out = await svc.getForCtv('u1', 'tra-xanh');

    expect(out.captions).toEqual([]);
    expect(out.usps).toEqual([]);
    expect(out.faqs).toEqual([]);
    expect(out.videoUrls).toEqual([]);
    expect(out.shareLink).toBe('/product/tra-xanh?ref=ABC123');
    expect(out.productName).toBe('Trà xanh');
  });

  it('user chưa có tên → dùng "Shop" thay cho {ten_ctv}', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trà xanh', images: [], isActive: true, affiliateBlocked: false });
    (prisma as any).productContentKit.findUnique.mockResolvedValue({
      captions: ['Chào từ {ten_ctv}!'],
      usps: [],
      faqs: null,
      videoUrls: [],
    });
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: null, referralCode: 'XYZ' });

    const svc = new ContentKitService(prisma, makeConfig());
    const out = await svc.getForCtv('u1', 'tra-xanh');

    expect(out.captions).toEqual(['Chào từ Shop!']);
  });

  it('fullName trùng literal "{link}" không làm hỏng caption (không double-substitute)', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trà xanh', images: [], isActive: true, affiliateBlocked: false });
    (prisma as any).productContentKit.findUnique.mockResolvedValue({
      captions: ['Chào từ {ten_ctv}, xem {link}'],
      usps: [], faqs: null, videoUrls: [],
    });
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: '{link} Shop', referralCode: 'XYZ' });

    const svc = new ContentKitService(prisma, makeConfig());
    const out = await svc.getForCtv('u1', 'tra-xanh');

    expect(out.captions).toEqual(['Chào từ {link} Shop, xem /product/tra-xanh?ref=XYZ']);
  });

  it('fullName là chuỗi $-pattern đặc biệt ("$&") không làm sai lệch caption', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trà xanh', images: [], isActive: true, affiliateBlocked: false });
    (prisma as any).productContentKit.findUnique.mockResolvedValue({
      captions: ['Chào từ {ten_ctv}!'],
      usps: [], faqs: null, videoUrls: [],
    });
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: '$&', referralCode: 'XYZ' });

    const svc = new ContentKitService(prisma, makeConfig());
    const out = await svc.getForCtv('u1', 'tra-xanh');

    expect(out.captions).toEqual(['Chào từ $&!']);
  });

  it('sản phẩm không tồn tại → NotFoundException', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue(null);

    const svc = new ContentKitService(prisma, makeConfig());
    await expect(svc.getForCtv('u1', 'khong-ton-tai')).rejects.toThrow(NotFoundException);
  });

  it('sản phẩm isActive=false → NotFoundException (không tạo nội dung quảng bá cho SP ngừng bán)', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trà xanh', images: [], isActive: false, affiliateBlocked: false });

    const svc = new ContentKitService(prisma, makeConfig());
    await expect(svc.getForCtv('u1', 'tra-xanh')).rejects.toThrow(NotFoundException);
  });

  it('sản phẩm affiliateBlocked=true → NotFoundException (không lộ link chia sẻ cho SP bị chặn affiliate)', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trà xanh', images: [], isActive: true, affiliateBlocked: true });

    const svc = new ContentKitService(prisma, makeConfig());
    await expect(svc.getForCtv('u1', 'tra-xanh')).rejects.toThrow(NotFoundException);
  });
});

describe('ContentKitService.upsert (admin)', () => {
  it('upsert với default mảng rỗng khi không truyền captions/usps/videoUrls', async () => {
    const prisma = makePrisma();
    (prisma as any).productContentKit.upsert.mockResolvedValue({ id: 'k1', productId: 'p1' });

    const svc = new ContentKitService(prisma, makeConfig());
    await svc.upsert('p1', {});

    expect((prisma as any).productContentKit.upsert).toHaveBeenCalledWith({
      where: { productId: 'p1' },
      create: { productId: 'p1', captions: [], usps: [], faqs: undefined, videoUrls: [] },
      update: { captions: [], usps: [], faqs: undefined, videoUrls: [] },
    });
  });

  it('upsert giữ nguyên dữ liệu truyền vào (captions/usps/faqs/videoUrls)', async () => {
    const prisma = makePrisma();
    (prisma as any).productContentKit.upsert.mockResolvedValue({ id: 'k1', productId: 'p1' });
    const dto = {
      captions: ['A', 'B'],
      usps: ['Sạch'],
      faqs: [{ q: 'Q1', a: 'A1' }],
      videoUrls: ['v.mp4'],
    };

    const svc = new ContentKitService(prisma, makeConfig());
    await svc.upsert('p1', dto);

    expect((prisma as any).productContentKit.upsert).toHaveBeenCalledWith({
      where: { productId: 'p1' },
      create: { productId: 'p1', ...dto },
      update: { ...dto },
    });
  });
});

describe('ContentKitService.get (admin)', () => {
  it('trả null khi sản phẩm chưa có content kit', async () => {
    const prisma = makePrisma();
    (prisma as any).productContentKit.findUnique.mockResolvedValue(null);
    const svc = new ContentKitService(prisma, makeConfig());
    await expect(svc.get('p1')).resolves.toBeNull();
  });

  it('trả kit hiện có', async () => {
    const prisma = makePrisma();
    const kit = { id: 'k1', productId: 'p1', captions: ['a'], usps: [], faqs: null, videoUrls: [] };
    (prisma as any).productContentKit.findUnique.mockResolvedValue(kit);
    const svc = new ContentKitService(prisma, makeConfig());
    await expect(svc.get('p1')).resolves.toEqual(kit);
  });
});
