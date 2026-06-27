import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BrandService, slugifyVi } from './brand.service';

describe('slugifyVi', () => {
  it('xử lý nguyên âm có móc ư/ơ + dấu thanh + đ', () => {
    // "Dừa Bến Tre" dựng từ unicode escape để chắc chắn không phụ thuộc encoding file
    const dua = 'Dừa Bến Tre'; // Dừa Bến Tre
    expect(slugifyVi(dua)).toBe('dua-ben-tre');
    expect(slugifyVi('Hương Đồng')).toBe('huong-dong'); // "Hương Đồng"
    expect(slugifyVi('  Nhãn  Test!! ')).toBe('nhan-test');
  });

  it('xử lý ư/ơ dạng ATOMIC (U+01B0/U+01A1 — không decompose dưới NFD)', () => {
    // "Vườn" dựng từ codepoint atomic: V + ư(U+01B0) + ờ(U+1EDD) + n
    const vuon = 'V' + String.fromCharCode(0x01b0) + String.fromCharCode(0x1edd) + 'n';
    expect(slugifyVi(vuon)).toBe('vuon');
    // ơ atomic đơn lẻ
    expect(slugifyVi('H' + String.fromCharCode(0x01a1) + 'a')).toBe('hoa');
  });
});

function makePrisma(overrides: any = {}) {
  return {
    brand: { findFirst: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    product: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    brandPromotion: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    dealerReward: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    variation: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUniqueOrThrow: jest.fn() },
    brandFollow: { create: jest.fn(), deleteMany: jest.fn().mockResolvedValue({ count: 0 }), findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

describe('BrandService.getPublicBySlug', () => {
  const NOW = new Date('2026-06-27T00:00:00Z');

  it('ném NotFound khi brand chưa published', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue(null);
    const svc = new BrandService(prisma);
    await expect(svc.getPublicBySlug('khong-co', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chỉ trả cert verified=true', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({
      id: 'b1', slug: 'sachi', name: 'Sachi', logoUrl: null, coverUrl: null, tagline: 't',
      story: null, storyImages: [], origin: 'Bến Tre', isVerified: true, followerCount: 5,
      certifications: [
        { code: 'ORG', label: 'Hữu cơ', verified: true, proofUrl: 'u' },
        { code: 'FAKE', label: 'Giả', verified: false },
      ],
    });
    const svc = new BrandService(prisma);
    const out = await svc.getPublicBySlug('sachi', NOW);
    expect(out.certifications).toHaveLength(1);
    expect(out.certifications[0]?.code).toBe('ORG');
  });

  it('lọc promotions theo isActive + khoảng thời gian', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({
      id: 'b1', slug: 'sachi', name: 'Sachi', certifications: [], storyImages: [], isVerified: false, followerCount: 0,
    });
    prisma.brandPromotion.findMany.mockResolvedValue([
      { id: 'p1', title: 'MUA 2 TẶNG 1', subtitle: null, themeColor: null, couponCode: null, startAt: new Date('2026-06-01'), endAt: new Date('2026-07-01') },
    ]);
    const svc = new BrandService(prisma);
    const out = await svc.getPublicBySlug('sachi', NOW);
    expect(prisma.brandPromotion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ brandId: 'b1', isActive: true, startAt: { lte: NOW }, endAt: { gte: NOW } }),
    }));
    expect(out.promotions).toHaveLength(1);
  });

  it('KHÔNG bao giờ kèm affiliateRate/commission trong payload public', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1', slug: 'sachi', name: 'Sachi', certifications: [], storyImages: [], isVerified: false, followerCount: 0 });
    prisma.product.findMany.mockResolvedValue([
      { id: 'pr1', name: 'Dầu gội', slug: 'dau-goi', thumbnail: null, basePrice: 100000, salePrice: null, ratingAvg: 4.5, reviewCount: 3 },
    ]);
    const svc = new BrandService(prisma);
    const out = await svc.getPublicBySlug('sachi', NOW);
    expect(JSON.stringify(out)).not.toMatch(/affiliateRate|commission/i);
  });

  it('gộp dealerReward của nhãn + toàn shop (brandId null)', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1', slug: 'sachi', name: 'Sachi', certifications: [], storyImages: [], isVerified: false, followerCount: 0 });
    prisma.dealerReward.findMany.mockResolvedValue([{ id: 'd1', type: 'TOUR', title: 'Tour', description: null, threshold: 50000000, period: 'QUARTER' }]);
    const svc = new BrandService(prisma);
    const out = await svc.getPublicBySlug('sachi', NOW);
    expect(prisma.dealerReward.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ brandId: 'b1' }, { brandId: null }], isActive: true }),
    }));
    expect(out.dealerRewards).toHaveLength(1);
  });
});

describe('BrandService.getShareToEarn', () => {
  it('trả eligible=false nếu user không phải AFFILIATE', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1', slug: 'sachi' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ role: 'CUSTOMER', referralCode: 'X' });
    const svc = new BrandService(prisma);
    const out = await svc.getShareToEarn('sachi', 'u1');
    expect(out.eligible).toBe(false);
    expect((out as any).maxAffiliateRate).toBeUndefined();
  });

  it('trả maxAffiliateRate (cao nhất SP nhãn) + referralCode cho AFFILIATE', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1', slug: 'sachi' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ role: 'AFFILIATE', referralCode: 'LINH123' });
    prisma.variation.findMany.mockResolvedValue([{ affiliateRate: 8 }, { affiliateRate: 12 }, { affiliateRate: null }]);
    const svc = new BrandService(prisma);
    const out = await svc.getShareToEarn('sachi', 'u1');
    expect(out).toEqual({ eligible: true, maxAffiliateRate: 12, referralCode: 'LINH123', brandSlug: 'sachi' });
  });
});

describe('BrandService admin', () => {
  it('createBrand slugify tên tiếng Việt', async () => {
    const prisma = makePrisma();
    prisma.brand.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'b1', ...data }));
    const svc = new BrandService(prisma);
    const out = await svc.createBrand({ name: 'Dừa Bến Tre' });
    expect(out.slug).toBe('dua-ben-tre');
  });

  it('verifyBrand set isVerified', async () => {
    const prisma = makePrisma();
    prisma.brand.update.mockResolvedValue({ id: 'b1', isVerified: true });
    const svc = new BrandService(prisma);
    await svc.verifyBrand('b1', true);
    expect(prisma.brand.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { isVerified: true } });
  });

  it('createPromotion gắn brandId + ép Date', async () => {
    const prisma = makePrisma();
    prisma.brandPromotion.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'p1', ...data }));
    const svc = new BrandService(prisma);
    const out = await svc.createPromotion('b1', { title: 'Sale', startAt: '2026-06-01', endAt: '2026-07-01' });
    expect(out.brandId).toBe('b1');
    expect(out.startAt).toBeInstanceOf(Date);
  });

  it('createDealerReward giữ type', async () => {
    const prisma = makePrisma();
    prisma.dealerReward.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'd1', ...data }));
    const svc = new BrandService(prisma);
    const out = await svc.createDealerReward({ type: 'TOUR', title: 'Tour Phú Quốc', threshold: 50000000 });
    expect(out.type).toBe('TOUR');
    expect(out.period).toBe('QUARTER');
  });
});

describe('BrandService gán sản phẩm vào nhãn', () => {
  it('attachProducts set brandId cho các productId (sau khi brand tồn tại)', async () => {
    const prisma = makePrisma();
    prisma.brand.findUniqueOrThrow.mockResolvedValue({ id: 'b1' });
    prisma.product.updateMany.mockResolvedValue({ count: 2 });
    const svc = new BrandService(prisma);
    const out = await svc.attachProducts('b1', ['p1', 'p2']);
    expect(prisma.product.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['p1', 'p2'] } }, data: { brandId: 'b1' } });
    expect(out).toEqual({ attached: 2 });
  });

  it('attachProducts ném BadRequest nếu danh sách rỗng', async () => {
    const prisma = makePrisma();
    prisma.brand.findUniqueOrThrow.mockResolvedValue({ id: 'b1' });
    const svc = new BrandService(prisma);
    await expect(svc.attachProducts('b1', [])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('detachProducts chỉ gỡ SP đang thuộc đúng nhãn này (where brandId)', async () => {
    const prisma = makePrisma();
    prisma.product.updateMany.mockResolvedValue({ count: 1 });
    const svc = new BrandService(prisma);
    const out = await svc.detachProducts('b1', ['p1']);
    expect(prisma.product.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['p1'] }, brandId: 'b1' }, data: { brandId: null } });
    expect(out).toEqual({ detached: 1 });
  });

  it('linkProductsByName gán theo Product.brand == brand.name', async () => {
    const prisma = makePrisma();
    prisma.brand.findUniqueOrThrow.mockResolvedValue({ id: 'b1', name: 'Sachi' });
    prisma.product.updateMany.mockResolvedValue({ count: 5 });
    const svc = new BrandService(prisma);
    const out = await svc.linkProductsByName('b1');
    expect(prisma.product.updateMany).toHaveBeenCalledWith({ where: { brand: 'Sachi' }, data: { brandId: 'b1' } });
    expect(out).toEqual({ linked: 5 });
  });

  it('listBrandProducts truy vấn theo brandId', async () => {
    const prisma = makePrisma();
    prisma.product.findMany.mockResolvedValue([{ id: 'p1', name: 'X' }]);
    const svc = new BrandService(prisma);
    const out = await svc.listBrandProducts('b1');
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { brandId: 'b1' } }));
    expect(out).toHaveLength(1);
  });
});

describe('BrandService follow nhãn', () => {
  it('followBrand: tạo follow + tăng followerCount (transaction)', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1' });
    prisma.brand.findUniqueOrThrow.mockResolvedValue({ followerCount: 6 });
    const svc = new BrandService(prisma);
    const out = await svc.followBrand('u1', 'sachi');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(out).toEqual({ following: true, followerCount: 6 });
  });

  it('followBrand idempotent: đã follow (P2002) → no-op, không ném', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1' });
    prisma.brand.findUniqueOrThrow.mockResolvedValue({ followerCount: 6 });
    const { Prisma } = require('@prisma/client');
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    const svc = new BrandService(prisma);
    const out = await svc.followBrand('u1', 'sachi');
    expect(out.following).toBe(true);
  });

  it('followBrand NotFound nếu nhãn chưa publish', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue(null);
    const svc = new BrandService(prisma);
    await expect(svc.followBrand('u1', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('unfollowBrand: xoá + giảm count khi đang follow', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1' });
    prisma.brandFollow.deleteMany.mockResolvedValue({ count: 1 });
    prisma.brand.update.mockResolvedValue({});
    prisma.brand.findUniqueOrThrow.mockResolvedValue({ followerCount: 5 });
    const svc = new BrandService(prisma);
    const out = await svc.unfollowBrand('u1', 'sachi');
    expect(prisma.brand.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { followerCount: { decrement: 1 } } });
    expect(out).toEqual({ following: false, followerCount: 5 });
  });

  it('unfollowBrand: chưa follow (count 0) → KHÔNG giảm count', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1' });
    prisma.brandFollow.deleteMany.mockResolvedValue({ count: 0 });
    prisma.brand.findUniqueOrThrow.mockResolvedValue({ followerCount: 5 });
    const svc = new BrandService(prisma);
    await svc.unfollowBrand('u1', 'sachi');
    expect(prisma.brand.update).not.toHaveBeenCalled();
  });

  it('followState trả following + followerCount', async () => {
    const prisma = makePrisma();
    prisma.brand.findFirst.mockResolvedValue({ id: 'b1', followerCount: 9 });
    prisma.brandFollow.findUnique.mockResolvedValue({ id: 'f1' });
    const svc = new BrandService(prisma);
    const out = await svc.followState('u1', 'sachi');
    expect(out).toEqual({ following: true, followerCount: 9 });
  });
});
