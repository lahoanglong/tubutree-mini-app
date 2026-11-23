import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { claimsIn } from '@tubutree/shared-types';
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

  // app.miniapp_base_url là URL gốc MINI APP (zalo.me/s/<Mini App ID>), nơi /product/:slug là route thật (apps/miniapp
  // components/app.tsx). Link tuyệt đối do API dựng vì vậy đi vào Mini App và phải giữ /product/; chỉ khi base trống,
  // API trả đường dẫn tương đối của Mini App và Mini App tự ghép domain WEB (đổi sang /san-pham/<slug>).
  it('base URL là Mini App: {link} trong bài mẫu và shareLink cùng là URL tuyệt đối vào /product/<slug> của Mini App', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trà xanh', images: [], isActive: true, affiliateBlocked: false });
    (prisma as any).productContentKit.findUnique.mockResolvedValue({ captions: ['Mua tại {link}'], usps: [], faqs: null, videoUrls: [] });
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: 'A', referralCode: 'CODE1' });

    const out = await new ContentKitService(prisma, makeConfig('https://zalo.me/s/123')).getForCtv('u1', 'tra-xanh');

    expect(out.shareLink).toBe('https://zalo.me/s/123/product/tra-xanh?ref=CODE1');
    expect(out.captions).toEqual(['Mua tại https://zalo.me/s/123/product/tra-xanh?ref=CODE1']);
  });

  it('base URL cấu hình có dấu "/" ở cuối: không sinh "//product"', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trà xanh', images: [], isActive: true, affiliateBlocked: false });
    (prisma as any).productContentKit.findUnique.mockResolvedValue(null);
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: 'A', referralCode: 'CODE1' });

    const out = await new ContentKitService(prisma, makeConfig('https://zalo.me/s/123//')).getForCtv('u1', 'tra-xanh');

    expect(out.shareLink).toBe('https://zalo.me/s/123/product/tra-xanh?ref=CODE1');
  });

  it('config lưu giá trị không phải chuỗi (null, số): coi như chưa cấu hình, trả đường dẫn tương đối, không lỗi', async () => {
    for (const bad of [null, 0, { url: 'x' }]) {
      const prisma = makePrisma();
      (prisma as any).product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trà xanh', images: [], isActive: true, affiliateBlocked: false });
      (prisma as any).productContentKit.findUnique.mockResolvedValue(null);
      (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: 'A', referralCode: 'CODE1' });

      const out = await new ContentKitService(prisma, makeConfig(bad as unknown as string)).getForCtv('u1', 'tra-xanh');

      expect(out.shareLink).toBe('/product/tra-xanh?ref=CODE1');
    }
  });

  it('kit null → bài mẫu và điểm bán hàng dựng sẵn (tên, thương hiệu, giá, tên CTV, link giới thiệu), faqs/video rỗng', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({
      id: 'p1', name: 'Trà xanh', images: ['img1.jpg'], isActive: true, affiliateBlocked: false,
      basePrice: 150000, salePrice: 129000, brand: 'Cũ', brandRef: { name: 'Tubu Farm' },
    });
    (prisma as any).productContentKit.findUnique.mockResolvedValue(null);
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: 'Nguyễn Văn A', referralCode: 'ABC123' });

    const svc = new ContentKitService(prisma, makeConfig());
    const out = await svc.getForCtv('u1', 'tra-xanh');

    expect(out.captions).toEqual([
      'Trà xanh của Tubu Farm đang bán tại Tubu Tree, giá 129.000đ. Xem chi tiết và đặt hàng: /product/tra-xanh?ref=ABC123',
      'Mình là Nguyễn Văn A, đang giới thiệu Trà xanh (129.000đ). Thông tin chi tiết và cách dùng có trên trang sản phẩm: /product/tra-xanh?ref=ABC123',
      'Bạn cần Trà xanh thì đặt qua link này để mình hỗ trợ đơn hàng nhé: /product/tra-xanh?ref=ABC123',
    ]);
    expect(out.usps).toEqual([
      'Thương hiệu Tubu Farm, bán trên Tubu Tree',
      'Giá đang bán 129.000đ',
      'Đặt trực tuyến, giao tận nơi',
      'Thông tin chi tiết và cách dùng có trên trang sản phẩm',
    ]);
    expect(out.faqs).toEqual([]);
    expect(out.videoUrls).toEqual([]);
    expect(out.shareLink).toBe('/product/tra-xanh?ref=ABC123');
    expect(out.productName).toBe('Trà xanh');
    expect(out.priceVnd).toBe(129000);
    expect(out.brandName).toBe('Tubu Farm');
    expect(out.referralCode).toBe('ABC123');
  });

  it('bài mẫu dựng sẵn không có tuyên bố công dụng/chứng nhận (claimsIn strict) và luôn mang link giới thiệu', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({
      id: 'p1', name: 'Nước rửa chén Bồ hòn 500ml', images: [], isActive: true, affiliateBlocked: false,
      basePrice: 89000, salePrice: null, brand: 'Ecocare', brandRef: null,
    });
    (prisma as any).productContentKit.findUnique.mockResolvedValue(null);
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: 'Lan', referralCode: 'LAN1' });

    const out = await new ContentKitService(prisma, makeConfig('https://zalo.me/s/123')).getForCtv('u1', 'nrc');

    for (const line of [...out.captions, ...out.usps]) expect(claimsIn(line, 'strict')).toEqual([]);
    for (const c of out.captions) expect(c).toContain('https://zalo.me/s/123/product/nrc?ref=LAN1');
    expect(out.priceVnd).toBe(89000);
    expect(out.brandName).toBe('Ecocare');
  });

  it('chưa có giá hay thương hiệu: câu dựng sẵn bỏ phần đó, không in "0đ" hay "của null"', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({
      id: 'p1', name: 'Trà xanh', images: [], isActive: true, affiliateBlocked: false, basePrice: 0, salePrice: null, brand: ' ', brandRef: null,
    });
    (prisma as any).productContentKit.findUnique.mockResolvedValue(null);
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: null, referralCode: 'X1' });

    const out = await new ContentKitService(prisma, makeConfig()).getForCtv('u1', 'tra-xanh');

    expect(out.priceVnd).toBe(0);
    expect(out.brandName).toBeNull();
    expect(out.captions[0]).toBe('Trà xanh đang bán tại Tubu Tree. Xem chi tiết và đặt hàng: /product/tra-xanh?ref=X1');
    expect(out.captions[1]).toBe('Mình đang giới thiệu Trà xanh. Thông tin chi tiết và cách dùng có trên trang sản phẩm: /product/tra-xanh?ref=X1');
    expect(out.usps).toEqual(['Đặt trực tuyến, giao tận nơi', 'Thông tin chi tiết và cách dùng có trên trang sản phẩm']);
    expect([...out.captions, ...out.usps].join(' ')).not.toMatch(/0đ|null|undefined/);
  });

  it('kit có điểm bán hàng nhưng chưa có bài mẫu: chỉ bài mẫu dùng câu dựng sẵn, điểm bán hàng của admin giữ nguyên', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({
      id: 'p1', name: 'Trà xanh', images: [], isActive: true, affiliateBlocked: false, basePrice: 100000, salePrice: 120000, brand: 'B', brandRef: null,
    });
    (prisma as any).productContentKit.findUnique.mockResolvedValue({ captions: [], usps: ['Do admin soạn'], faqs: null, videoUrls: [] });
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: 'A', referralCode: 'C1' });

    const out = await new ContentKitService(prisma, makeConfig()).getForCtv('u1', 'tra-xanh');

    expect(out.usps).toEqual(['Do admin soạn']);
    expect(out.captions).toHaveLength(3);
    // Giá giảm cao hơn giá gốc là dữ liệu lỗi: lấy giá gốc như khối hoa hồng nổi bật.
    expect(out.priceVnd).toBe(100000);
    expect(out.captions[0]).toContain('giá 100.000đ');
  });

  it('Pancake: giá bán nằm ở phân loại đại diện còn hàng (không ở Product.salePrice) → ảnh và câu mẫu ghi đúng giá thẻ sản phẩm', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({
      id: 'p1', name: 'Trà xanh', images: [], isActive: true, affiliateBlocked: false, basePrice: 150000, salePrice: null, brand: 'B', brandRef: null,
      variations: [
        { id: 'v-het', sku: 'A', retailPrice: 90000, salePrice: null, stock: 0 },
        { id: 'v-sale', sku: 'B', retailPrice: 150000, salePrice: 119000, stock: 5 },
      ],
    });
    (prisma as any).productContentKit.findUnique.mockResolvedValue(null);
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: 'A', referralCode: 'C1' });

    const out = await new ContentKitService(prisma, makeConfig()).getForCtv('u1', 'tra-xanh');

    expect(out.priceVnd).toBe(119000);
    expect(out.captions[0]).toContain('giá 119.000đ');
    expect(out.usps).toContain('Giá đang bán 119.000đ');
    expect((prisma as any).product.findUnique.mock.calls[0][0].select.variations).toMatchObject({ where: { isActive: true } });
  });

  it('tên sản phẩm hay tên CTV chứa "{link}"/"$&" không bị thay lần hai trong câu dựng sẵn', async () => {
    const prisma = makePrisma();
    (prisma as any).product.findUnique.mockResolvedValue({
      id: 'p1', name: 'Hộp {link} $&', images: [], isActive: true, affiliateBlocked: false, basePrice: 1000, salePrice: null, brand: '', brandRef: null,
    });
    (prisma as any).productContentKit.findUnique.mockResolvedValue(null);
    (prisma as any).user.findUniqueOrThrow.mockResolvedValue({ fullName: '{ten_ctv}', referralCode: 'C1' });

    const out = await new ContentKitService(prisma, makeConfig()).getForCtv('u1', 'hop');

    expect(out.captions[1]).toBe('Mình là {ten_ctv}, đang giới thiệu Hộp {link} $& (1.000đ). Thông tin chi tiết và cách dùng có trên trang sản phẩm: /product/hop?ref=C1');
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

describe('ContentKitService.upsert: faqs lưu dạng object thuần', () => {
  it('đổi thể hiện lớp DTO thành {q, a} thuần', async () => {
    class FaqDto {
      q = 'Ship bao lâu?';
      a = '2 ngày';
    }
    const prisma = makePrisma();
    (prisma as any).productContentKit.upsert.mockResolvedValue({ id: 'k1' });
    const svc = new ContentKitService(prisma, makeConfig());
    await svc.upsert('p1', { faqs: [new FaqDto()] });
    const faqs = (prisma as any).productContentKit.upsert.mock.calls[0][0].update.faqs as unknown[];
    expect(faqs).toEqual([{ q: 'Ship bao lâu?', a: '2 ngày' }]);
    expect(Object.getPrototypeOf(faqs[0])).toBe(Object.prototype);
  });
});
