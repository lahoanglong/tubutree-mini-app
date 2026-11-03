import { BadRequestException } from '@nestjs/common';
import {
  normalizeSubdomain,
  normalizeCustomDomain,
  assertIdentifierAvailable,
  RESERVED_STOREFRONT_IDENTIFIERS,
} from './identifier-validation';

describe('normalizeSubdomain', () => {
  it('chuẩn hoá trim + lowercase', () => {
    expect(normalizeSubdomain('  Organic-Tea  ')).toBe('organic-tea');
  });

  it('quá ngắn hoặc chứa ký tự đặc biệt → BadRequestException', () => {
    expect(() => normalizeSubdomain('ab')).toThrow(BadRequestException);
    expect(() => normalizeSubdomain('brand_name!')).toThrow(BadRequestException);
  });

  it('thuộc từ khóa hệ thống → BadRequestException', () => {
    expect(() => normalizeSubdomain('admin')).toThrow(BadRequestException);
    expect(() => normalizeSubdomain('api')).toThrow(BadRequestException);
  });

  it('chứa dấu chấm (dạng tên miền) → BadRequestException — subdomain KHÔNG BAO GIỜ có chấm', () => {
    expect(() => normalizeSubdomain('shop.example.com')).toThrow(BadRequestException);
  });
});

describe('normalizeCustomDomain', () => {
  it('chuẩn hoá trim + lowercase, chấp nhận tên miền hợp lệ', () => {
    expect(normalizeCustomDomain('  Shop.TenCuaBan.vn  ')).toBe('shop.tencuaban.vn');
  });

  it('không có dấu chấm (giống subdomain trần) → BadRequestException — tách biệt 2 không gian tên', () => {
    expect(() => normalizeCustomDomain('organic-tea')).toThrow(BadRequestException);
  });

  it('label đầu trùng từ khóa hệ thống nhưng là tên miền khách tự sở hữu → KHÔNG chặn (khác không gian tên với subdomain)', () => {
    expect(() => normalizeCustomDomain('shop.example.com')).not.toThrow();
    expect(() => normalizeCustomDomain('admin.example.com')).not.toThrow();
  });

  it('domain hợp lệ nhiều cấp → OK', () => {
    expect(normalizeCustomDomain('shop.example.co.uk')).toBe('shop.example.co.uk');
  });
});

const noCodeOwner = { findFirst: jest.fn().mockResolvedValue(null) };

describe('assertIdentifierAvailable', () => {
  it('không có gian hàng nào khác trùng → không throw', async () => {
    const prisma = { storefront: { findFirst: jest.fn().mockResolvedValue(null) }, user: noCodeOwner };
    await expect(assertIdentifierAvailable(prisma as never, 'organic-tea', 's1')).resolves.toBeUndefined();
  });

  it('trùng slug của gian hàng KHÁC → throw (không chỉ kiểm trùng subdomain-với-subdomain)', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'other-store' });
    const prisma = { storefront: { findFirst }, user: noCodeOwner };
    await expect(assertIdentifierAvailable(prisma as never, 'organic-tea', 's1')).rejects.toThrow(
      'đã được sử dụng bởi gian hàng khác',
    );
    // Query PHẢI kiểm CẢ 3 cột, không chỉ subdomain
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ slug: 'organic-tea' }, { subdomain: 'organic-tea' }, { customDomain: 'organic-tea' }],
        NOT: { id: 's1' },
      },
    });
  });

  it('trùng chính gian hàng của mình (NOT id) → không throw', async () => {
    const prisma = { storefront: { findFirst: jest.fn().mockResolvedValue(null) }, user: noCodeOwner };
    await expect(assertIdentifierAvailable(prisma as never, 'organic-tea', 's1')).resolves.toBeUndefined();
  });
});

describe('RESERVED_STOREFRONT_IDENTIFIERS', () => {
  it('gộp đủ từ khóa của cả 2 danh sách cũ (merchant.service + storefront.service)', () => {
    for (const kw of ['admin', 'api', 'www', 'app', 'mail', 'staging', 'dev', 'static', 'cdn', 'auth', 'shop', 'tubutree', 'tubu', 'root', 'system', 'dashboard', 'demo']) {
      expect(RESERVED_STOREFRONT_IDENTIFIERS.has(kw)).toBe(true);
    }
  });
});

describe('từ dành riêng cho subdomain/slug (D3-02)', () => {
  it.each(['cskh', 'hotro', 'khuyenmai', 'zalo', 'hello', 'support', 'official', 'facebook', 'shopee', 'lazada', 'tiktok', 'chodeli'])(
    '"%s" giống tên kênh hỗ trợ/nền tảng, khách dễ nhầm là Tubu Tree → bị chặn',
    (word) => {
      expect(RESERVED_STOREFRONT_IDENTIFIERS.has(word)).toBe(true);
      expect(() => normalizeSubdomain(word)).toThrow(BadRequestException);
    },
  );

  it('chặn kể cả khi gõ HOA hoặc thừa khoảng trắng', () => {
    expect(() => normalizeSubdomain('  CSKH ')).toThrow(BadRequestException);
  });
});

describe('assertIdentifierAvailable — tên thương hiệu đang có', () => {
  const noStorefront = { findFirst: jest.fn().mockResolvedValue(null) };

  it('trùng slug hoặc tên của một thương hiệu → chặn (gian hàng CTV không được mạo danh thương hiệu)', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'b1' });
    const prisma = { storefront: noStorefront, user: noCodeOwner, brand: { findFirst } };
    // Chữ khách đọc: "thương hiệu" (Q5), không "vui lòng" (ux-copy D2).
    const err = await assertIdentifierAvailable(prisma as never, 'lamy', 's1').catch((e: Error) => e);
    expect((err as Error).message).toBe('"lamy" trùng tên một thương hiệu của Tubu Tree. Bạn chọn tên khác nhé.');
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ slug: 'lamy' }, { name: { equals: 'lamy', mode: 'insensitive' } }],
        NOT: { storefront: { id: 's1' } },
      },
      select: { id: true },
    });
  });

  it('thương hiệu không trùng → qua; thương hiệu gắn với CHÍNH gian hàng này được loại khỏi phép kiểm (NOT storefront.id)', async () => {
    const prisma = { storefront: noStorefront, user: noCodeOwner, brand: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(assertIdentifierAvailable(prisma as never, 'lamy', 's1')).resolves.toBeUndefined();
  });
});

describe('assertIdentifierAvailable — mã giới thiệu của người khác (DLSF-01)', () => {
  it('trùng mã giới thiệu của tài khoản khác (không phân biệt hoa thường) → chặn, loại chủ gian hàng ra khỏi phép kiểm', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'victim' });
    const prisma = { storefront: { findFirst: jest.fn().mockResolvedValue(null) }, user: { findFirst } };
    await expect(assertIdentifierAvailable(prisma as never, 'abc12345', 's1', undefined, 'attacker')).rejects.toThrow('trùng mã giới thiệu');
    expect(findFirst).toHaveBeenCalledWith({
      where: { referralCode: { equals: 'abc12345', mode: 'insensitive' }, NOT: { id: 'attacker' } },
      select: { id: true },
    });
  });

  it('không có tài khoản khác mang mã đó (kể cả chính chủ) → qua', async () => {
    const prisma = { storefront: { findFirst: jest.fn().mockResolvedValue(null) }, user: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(assertIdentifierAvailable(prisma as never, 'abc12345', 's1', undefined, 'owner')).resolves.toBeUndefined();
  });
});
