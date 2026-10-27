import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MERCHANT_SELF_SHIP_USE_FULFIL_TAB, MerchantService } from './merchant.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrderStatusService } from '../orders/order-status.service';

function makePrisma(overrides: Record<string, unknown> = {}): PrismaService {
  return overrides as unknown as PrismaService;
}

// updateMerchantOrderStatus giờ ủy quyền cho OrderStatusService (transition guard + side-effect
// điểm/hoa hồng dùng chung với admin/pancake) thay vì tự ghi status — xem merchant.service.ts.
const orderStatus = { setStatus: jest.fn() } as unknown as OrderStatusService;

describe('MerchantService', () => {
  describe('getOrCreateStore', () => {
    it('chặn role CUSTOMER không được tạo gian hàng', async () => {
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'CUSTOMER' }) },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.getOrCreateStore('u1')).rejects.toThrow(ForbiddenException);
    });

    it('trả về gian hàng hiện có nếu đã tồn tại', async () => {
      const existingStore = { id: 's1', ownerUserId: 'u1', title: 'Shop 1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(existingStore) },
      });
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.getOrCreateStore('u1');
      expect(res.id).toBe('s1');
    });

    it('tự động tạo gian hàng mới cho DEALER kèm bộ sưu tập mặc định', async () => {
      const createdStore = { id: 's-new', ownerUserId: 'u2', title: 'Gian hàng mới', collections: [] };
      const prisma = makePrisma({
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u2', role: 'DEALER', referralCode: 'DEALER01', fullName: 'Đại lý 1' }),
          findUnique: jest.fn().mockResolvedValue({ role: 'DEALER' }),
        },
        storefront: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(createdStore),
        },
        $executeRaw: jest.fn().mockResolvedValue(0),
      });
      (prisma as unknown as { $transaction: unknown }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.getOrCreateStore('u2');
      expect(res.id).toBe('s-new');
      expect((prisma.storefront.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ type: 'MERCHANT', isPartner: true });
    });

    it.each([
      ['Lã Hoàng Long', 'Gian hàng của Long L.'],
      ['0912345678', 'Gian hàng đối tác Tubu Tree'],
      ['🌸🌸', 'Gian hàng đối tác Tubu Tree'],
      [null, 'Gian hàng đối tác Tubu Tree'],
    ])('tên gian hàng mặc định không lộ họ tên đầy đủ hay số điện thoại: %s', async (fullName, title) => {
      const prisma = makePrisma({
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u2', role: 'DEALER', referralCode: 'DEALER01', fullName }),
          findUnique: jest.fn().mockResolvedValue({ role: 'DEALER' }),
        },
        storefront: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 's-new', collections: [] }),
        },
        $executeRaw: jest.fn().mockResolvedValue(0),
      });
      (prisma as unknown as { $transaction: unknown }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
      await new MerchantService(prisma, orderStatus).getOrCreateStore('u2');
      expect((prisma.storefront.create as jest.Mock).mock.calls[0][0].data.title).toBe(title);
    });

    it('gian hàng tự tạo là nháp: chưa có sản phẩm thì chưa hiện với khách, đăng bằng nút Đăng (D3-08)', async () => {
      const prisma = makePrisma({
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u2', role: 'DEALER', referralCode: 'DEALER01', fullName: 'Đại lý 1' }),
          findUnique: jest.fn().mockResolvedValue({ role: 'DEALER' }),
        },
        storefront: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 's-new', collections: [] }),
        },
        $executeRaw: jest.fn().mockResolvedValue(0),
      });
      (prisma as unknown as { $transaction: unknown }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
      await new MerchantService(prisma, orderStatus).getOrCreateStore('u2');
      const data = (prisma.storefront.create as jest.Mock).mock.calls[0][0].data;
      expect(data.isPublished).toBe(false);
      expect(data.publishedAt).toBeNull();
    });

    it('vai trò đọc lại dưới khoá chủ đã hết là đại lý → chọn loại theo vai trò mới, hoặc từ chối nếu không được mở gian hàng', async () => {
      const mk = (role: string) => {
        const prisma = makePrisma({
          user: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u2', role: 'DEALER', referralCode: 'D1', fullName: 'A' }),
            findUnique: jest.fn().mockResolvedValue({ role }),
          },
          storefront: {
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 's' }),
          },
          $executeRaw: jest.fn().mockResolvedValue(0),
        });
        (prisma as unknown as { $transaction: unknown }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
        return { prisma, svc: new MerchantService(prisma, orderStatus) };
      };
      const a = mk('AFFILIATE');
      await a.svc.getOrCreateStore('u2');
      expect((a.prisma.storefront.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ type: 'CTV', isPartner: false });
      const b = mk('CUSTOMER');
      await expect(b.svc.getOrCreateStore('u2')).rejects.toThrow(ForbiddenException);
      expect(b.prisma.storefront.create as jest.Mock).not.toHaveBeenCalled();
    });
  });

  describe('presentStore — link subdomain theo cờ (D3-11)', () => {
    const store = { id: 's1', slug: 'dai-ly', subdomain: 'dai-ly-xanh', customDomain: 'daily.vn', title: 'Đại lý' };
    const withFlag = (value: unknown) =>
      new MerchantService(makePrisma(), orderStatus, undefined, { get: async <T>(k: string, fb?: T) => (k === 'storefront.subdomain_enabled' ? value : fb) } as never);

    it('cờ tắt hoặc không có cấu hình: cổng đối tác không nhận subdomain và tên miền riêng', async () => {
      for (const svc of [new MerchantService(makePrisma(), orderStatus), withFlag(false), withFlag('true')]) {
        const r = await svc.presentStore(store);
        expect(r).toMatchObject({ subdomain: null, customDomain: null, subdomainEnabled: false, slug: 'dai-ly' });
      }
    });

    it('cờ bật (đúng boolean true): trả nguyên subdomain và tên miền riêng', async () => {
      expect(await withFlag(true).presentStore(store)).toMatchObject({ subdomain: 'dai-ly-xanh', customDomain: 'daily.vn', subdomainEnabled: true });
    });
  });

  describe('updateStore & subdomain rules', () => {
    it('chặn subdomain chứa ký tự đặc biệt hoặc quá ngắn', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.updateStore('u1', { subdomain: 'ab' })).rejects.toThrow(BadRequestException);
      await expect(svc.updateStore('u1', { subdomain: 'brand_name!' })).rejects.toThrow(BadRequestException);
    });

    it('chặn subdomain thuộc từ khóa cấm hệ thống (admin, api, www...)', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.updateStore('u1', { subdomain: 'admin' })).rejects.toThrow(BadRequestException);
      await expect(svc.updateStore('u1', { subdomain: 'api' })).rejects.toThrow(BadRequestException);
    });

    it('chặn subdomain nếu đã bị đối tác khác đăng ký', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(store) // Lần 1: tìm store của user
            .mockResolvedValueOnce({ id: 's-other', subdomain: 'organic-tea' }), // Lần 2: kiểm tra trùng
        },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.updateStore('u1', { subdomain: 'organic-tea' })).rejects.toThrow(BadRequestException);
    });

    it('lưu lại đúng subdomain đang có (cổng luôn gửi kèm): không kiểm từ khoá hay trùng, không ghi lại, vẫn lưu được trường khác', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [], subdomain: 'admin', customDomain: 'shop.mybrand.vn', title: 'Đại lý' };
      const update = jest.fn().mockImplementation(({ data }) => ({ ...store, ...data }));
      const findFirst = jest.fn().mockResolvedValue(store);
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst, update },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await svc.updateStore('u1', { subdomain: ' Admin ', customDomain: 'SHOP.mybrand.vn', headerNote: 'Giao nhanh' });
      expect(findFirst).toHaveBeenCalledTimes(1);
      const data = update.mock.calls[0][0].data;
      expect(data.headerNote).toBe('Giao nhanh');
      expect(data).not.toHaveProperty('subdomain');
      expect(data).not.toHaveProperty('customDomain');
    });

    describe('ảnh đại diện và ảnh bìa chỉ kiểm khi đổi', () => {
      const SVG = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
      const setup = (stored: Record<string, unknown>) => {
        const store = { id: 's1', ownerUserId: 'u1', collections: [], title: 'Đại lý', ...stored };
        const update = jest.fn().mockImplementation(({ data }) => ({ ...store, ...data }));
        const prisma = makePrisma({
          user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
          storefront: { findFirst: jest.fn().mockResolvedValue(store), update },
          product: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
        });
        return { svc: new MerchantService(prisma, orderStatus), update };
      };

      it('gian hàng cũ lưu ảnh http hoặc SVG: chỉ đổi tên, trang gửi lại đúng hai ảnh cũ vẫn lưu được', async () => {
        const { svc, update } = setup({ avatarUrl: 'http://old.example/a.png', coverUrl: SVG });
        await expect(svc.updateStore('u1', { title: 'Tên mới', avatarUrl: 'http://old.example/a.png', coverUrl: SVG })).resolves.toMatchObject({ title: 'Tên mới' });
        expect(update).toHaveBeenCalledTimes(1);
      });

      it.each([
        ['avatarUrl', 'http://other.example/b.png'],
        ['coverUrl', 'http://other.example/b.png'],
        ['avatarUrl', 'http://169.254.169.254/x'],
        ['coverUrl', SVG],
        ['avatarUrl', 'javascript:alert(1)'],
        ['coverUrl', 'https://u:p@evil.vn/a.png'],
      ])('đổi %s sang giá trị không an toàn (%s) → 400, không ghi', async (field, value) => {
        const { svc, update } = setup({ avatarUrl: 'http://old.example/a.png', coverUrl: 'http://old.example/c.png' });
        const attempt = svc.updateStore('u1', { [field]: value });
        await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
        await expect(attempt).rejects.toThrow(field);
        expect(update).not.toHaveBeenCalled();
      });

      it('đổi sang https, base64 raster hoặc chuỗi rỗng (xoá ảnh) vẫn được', async () => {
        for (const value of ['https://res.cloudinary.com/x/a.jpg', `data:image/jpeg;base64,${'A'.repeat(64)}`, '']) {
          const { svc } = setup({ avatarUrl: 'http://old.example/a.png' });
          await expect(svc.updateStore('u1', { avatarUrl: value })).resolves.toBeDefined();
        }
      });
    });

    it('đổi sang subdomain khác vẫn bị kiểm từ khoá hệ thống', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [], subdomain: 'dai-ly-xanh' };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
      });
      await expect(new MerchantService(prisma, orderStatus).updateStore('u1', { subdomain: 'admin' })).rejects.toThrow(BadRequestException);
    });

    it('cập nhật thành công subdomain, ngân hàng VietQR và địa chỉ kho', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const updatedStore = {
        ...store,
        subdomain: 'pure-green',
        bankName: 'Vietcombank',
        bankAccountNo: '1234567890',
        warehouseAddress: '123 Nguyễn Huệ, Q1, TP.HCM',
      };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: {
          findFirst: jest.fn().mockResolvedValueOnce(store).mockResolvedValueOnce(null),
          update: jest.fn().mockResolvedValue(updatedStore),
        },
      });
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.updateStore('u1', {
        subdomain: 'pure-green',
        bankName: 'Vietcombank',
        bankAccountNo: '1234567890',
        warehouseAddress: '123 Nguyễn Huệ, Q1, TP.HCM',
      });
      expect(res.subdomain).toBe('pure-green');
      expect(res.bankAccountNo).toBe('1234567890');
    });

    // P0-1 (docs/2026-09-08-review-progress.md): trước đây chỉ kiểm trùng subdomain-với-
    // subdomain — CTV có thể chiếm subdomain trùng SLUG (hay customDomain) của gian hàng khác,
    // khiến các truy vấn OR ở tầng đọc (resolve theo host, tra QR ngân hàng...) trả về nhầm
    // gian hàng. Kiểm trùng giờ phải CHÉO cả 3 cột.
    it('chặn subdomain nếu trùng SLUG (không phải subdomain) của gian hàng khác', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(store)
            .mockResolvedValueOnce({ id: 's-other', slug: 'organic-tea' }), // trùng SLUG, không phải subdomain
        },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.updateStore('u1', { subdomain: 'organic-tea' })).rejects.toThrow(BadRequestException);
    });

    it('chặn customDomain sai định dạng (không phải tên miền thật)', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.updateStore('u1', { customDomain: 'not-a-domain' })).rejects.toThrow(BadRequestException);
    });

    it('chặn customDomain trùng subdomain/slug của gian hàng khác', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(store)
            .mockResolvedValueOnce({ id: 's-other', customDomain: 'shop.victim.vn' }),
        },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.updateStore('u1', { customDomain: 'shop.victim.vn' })).rejects.toThrow(BadRequestException);
    });

    it('cập nhật customDomain hợp lệ, không trùng ai → thành công', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const update = jest.fn().mockImplementation(({ data }) => ({ id: 's1', ...data }));
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: {
          findFirst: jest.fn().mockResolvedValueOnce(store).mockResolvedValueOnce(null),
          update,
        },
      });
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.updateStore('u1', { customDomain: 'Shop.MyBrand.vn' });
      expect(res.customDomain).toBe('shop.mybrand.vn');
    });

    it('customDomain rỗng → xóa tên miền riêng (set null), không validate format', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const update = jest.fn().mockImplementation(({ data }) => ({ id: 's1', ...data }));
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store), update },
      });
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.updateStore('u1', { customDomain: '' });
      expect(res.customDomain).toBeNull();
    });
  });

  describe('createProduct (Merchant tự đăng)', () => {
    it('tạo sản phẩm với trạng thái PENDING_REVIEW chờ admin duyệt', async () => {
      const store = { id: 's1', type: 'MERCHANT', ownerUserId: 'u1', title: 'Xanh Shop', collections: [{ id: 'col1' }] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        storefrontItem: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({}) },
        product: {
          create: jest.fn().mockImplementation(({ data }) => ({
            id: 'prod-new',
            ...data,
          })),
        },
        $queryRaw: jest.fn().mockResolvedValue([{ type: 'MERCHANT', isPartner: true }]),
        $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
      });
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.createProduct('u1', {
        name: 'Trà Xanh Hữu Cơ',
        description: 'Trà búp tươi từ đồi chè Thái Nguyên',
        basePrice: 120000,
        images: ['https://example.com/tra.jpg'],
      });
      expect(res.name).toBe('Trà Xanh Hữu Cơ');
      expect(res.approvalStatus).toBe('PENDING_REVIEW');
      expect(res.storefrontId).toBe('s1');
    });
  });

  describe('addResellProduct & removeResellProduct', () => {
    it('chặn bán lại nếu sản phẩm chưa được duyệt', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [{ id: 'col1' }] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', isActive: true, approvalStatus: 'PENDING_REVIEW' }) },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.addResellProduct('u1', 'p1')).rejects.toThrow(BadRequestException);
    });

    it('thêm sản phẩm Tubu đã duyệt vào gian hàng bán lại thành công', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [{ id: 'col1' }] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        product: { findUnique: jest.fn().mockResolvedValue({ id: 'p2', isActive: true, approvalStatus: 'APPROVED' }) },
        storefrontItem: {
          findFirst: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(2),
          create: jest.fn().mockResolvedValue({ id: 'item-1', productId: 'p2' }),
        },
      });
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.addResellProduct('u1', 'p2');
      expect(res.productId).toBe('p2');
    });

    // P1-1 (docs/2026-09-08-review-progress.md): collectionId đến từ body, trước đây KHÔNG
    // check thuộc gian hàng của caller — id collection của gian hàng khác lộ qua trang public
    // (GET /storefront/public/:slug trả collections[].id) đủ để chèn sản phẩm vào gian hàng
    // NGƯỜI KHÁC.
    it('IDOR: collectionId thuộc gian hàng KHÁC → BadRequest, KHÔNG chèn sản phẩm', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [{ id: 'col-mine' }] };
      const create = jest.fn();
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        product: { findUnique: jest.fn().mockResolvedValue({ id: 'p2', isActive: true, approvalStatus: 'APPROVED' }) },
        storefrontItem: { findFirst: jest.fn(), count: jest.fn(), create },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.addResellProduct('u1', 'p2', 'col-victim')).rejects.toBeInstanceOf(BadRequestException);
      expect(create).not.toHaveBeenCalled();
    });

    it('collectionId thuộc đúng gian hàng của mình → thêm được bình thường', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [{ id: 'col-mine' }, { id: 'col-2' }] };
      const create = jest.fn().mockResolvedValue({ id: 'item-2', productId: 'p2' });
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        product: { findUnique: jest.fn().mockResolvedValue({ id: 'p2', isActive: true, approvalStatus: 'APPROVED' }) },
        storefrontItem: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create },
      });
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.addResellProduct('u1', 'p2', 'col-2');
      expect(res.productId).toBe('p2');
    });
  });

  describe('updateMerchantOrderStatus', () => {
    // P0 A5-03 = A6-02 (docs/audit-2026-09): chỉ ADMIN mới còn được tự chuyển trạng thái qua
    // /merchant (xem describe 'chặn tự chuyển trạng thái' bên dưới) — các test hành vi CŨ (guard
    // transition, validate status, resolve theo storefrontSlug...) đổi fixture sang ADMIN để tách
    // riêng khỏi guard vai trò mới, không đổi ý nghĩa của từng test.
    it('ném NotFoundException nếu đơn hàng không chứa sản phẩm của merchant', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'ADMIN' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        variation: { findMany: jest.fn().mockResolvedValue([{ id: 'var-1' }]) },
        merchantPancakeLink: { findMany: jest.fn().mockResolvedValue([]) },
        order: { findFirst: jest.fn().mockResolvedValue(null) },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.updateMerchantOrderStatus('u1', 'ord-99', 'PACKED')).rejects.toThrow(NotFoundException);
    });

    it('cập nhật trạng thái đơn hàng của kho đối tác thành công (ADMIN)', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'ADMIN' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        variation: { findMany: jest.fn().mockResolvedValue([{ id: 'var-1' }]) },
        merchantPancakeLink: { findMany: jest.fn().mockResolvedValue([]) },
        order: { findFirst: jest.fn().mockResolvedValue({ id: 'ord-1' }) },
      });
      (orderStatus.setStatus as jest.Mock).mockResolvedValueOnce({ id: 'ord-1', status: 'PACKED' });
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.updateMerchantOrderStatus('u1', 'ord-1', 'PACKED');
      expect(res.status).toBe('PACKED');
      expect(orderStatus.setStatus).toHaveBeenCalledWith('ord-1', 'PACKED', {
        actorType: 'MERCHANT',
        actorId: expect.any(String),
      });
    });

    it('ném BadRequestException nếu trạng thái đơn hàng không hợp lệ', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'ADMIN' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.updateMerchantOrderStatus('u1', 'ord-1', 'INVALID_STATUS')).rejects.toThrow(BadRequestException);
    });

    it('chuyển transition không hợp lệ (guard dùng chung với admin/pancake) → BadRequestException, không phải 500', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'ADMIN' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        variation: { findMany: jest.fn().mockResolvedValue([{ id: 'var-1' }]) },
        merchantPancakeLink: { findMany: jest.fn().mockResolvedValue([]) },
        order: { findFirst: jest.fn().mockResolvedValue({ id: 'ord-1' }) },
      });
      const { InvalidOrderTransitionError } = jest.requireActual('../orders/order-transition');
      (orderStatus.setStatus as jest.Mock).mockRejectedValueOnce(new InvalidOrderTransitionError('DELIVERED', 'CONFIRMED'));
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.updateMerchantOrderStatus('u1', 'ord-1', 'CONFIRMED')).rejects.toThrow(BadRequestException);
    });

    it('cập nhật trạng thái đơn hàng theo storefrontSlug thành công (ADMIN)', async () => {
      const store = { id: 's1', ownerUserId: 'u1', slug: 'shop1', subdomain: 'shop1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'ADMIN' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        variation: { findMany: jest.fn().mockResolvedValue([]) },
        merchantPancakeLink: { findMany: jest.fn().mockResolvedValue([]) },
        order: { findFirst: jest.fn().mockResolvedValue({ id: 'ord-sf-1' }) },
      });
      (orderStatus.setStatus as jest.Mock).mockResolvedValueOnce({ id: 'ord-sf-1', status: 'SHIPPING' });
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.updateMerchantOrderStatus('u1', 'ord-sf-1', 'SHIPPING');
      expect(res.status).toBe('SHIPPING');
    });
  });

  // P0 A5-03 = A6-02 (docs/audit-2026-09/05-ctv-dealer-staff.md, 06-web.md): CTV/đại lý tự bấm
  // chuyển đơn "Đã đóng gói→Đang giao→Đã giao" (cả CANCELLED/RETURNED) cho MỌI đơn gắn gian hàng
  // của mình — kể cả đơn do kho Tubu thật sự xử lý (mọi đơn đều bị đẩy Pancake vô điều kiện, xem
  // A5-34: checkout.service.ts không rẽ nhánh theo storefront/product nguồn gốc) — nên không có
  // tín hiệu nào trong schema để xác minh "đối tác tự giao hàng thật". Mặc định AN TOÀN: chặn hẳn
  // tự chuyển trạng thái qua /merchant cho DEALER lẫn AFFILIATE, chỉ ADMIN mới được (đã có toàn
  // quyền qua /admin sẵn).
  describe('updateMerchantOrderStatus — chặn tự chuyển trạng thái (P0 A5-03=A6-02)', () => {
    const ownOrderMocks = {
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', type: 'MERCHANT', ownerUserId: 'u1', collections: [] }) },
      variation: { findMany: jest.fn().mockResolvedValue([]) },
      merchantPancakeLink: { findMany: jest.fn().mockResolvedValue([]) },
      order: { findFirst: jest.fn().mockResolvedValue({ id: 'ord-1' }) },
    };

    it('chặn AFFILIATE (CTV) tự chuyển trạng thái đơn — 403, không được tự "giao ảo"', async () => {
      const freshOrderStatus = { setStatus: jest.fn() } as unknown as OrderStatusService;
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ctv-1', role: 'AFFILIATE' }) },
        ...ownOrderMocks,
      });
      const svc = new MerchantService(prisma, freshOrderStatus);
      await expect(svc.updateMerchantOrderStatus('ctv-1', 'ord-1', 'DELIVERED')).rejects.toThrow(ForbiddenException);
      expect(freshOrderStatus.setStatus).not.toHaveBeenCalled();
    });

    it('chặn DEALER tự chuyển trạng thái đơn — chưa có cờ "tự giao hàng đã xác minh" nào trong schema', async () => {
      const freshOrderStatus = { setStatus: jest.fn() } as unknown as OrderStatusService;
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'dealer-1', role: 'DEALER' }) },
        ...ownOrderMocks,
      });
      const svc = new MerchantService(prisma, freshOrderStatus);
      await expect(svc.updateMerchantOrderStatus('dealer-1', 'ord-1', 'PACKED')).rejects.toThrow(ForbiddenException);
      expect(freshOrderStatus.setStatus).not.toHaveBeenCalled();
    });

    it('vẫn chặn AFFILIATE/DEALER kể cả với trạng thái đích không hợp lệ (auth-check chạy trước validate status)', async () => {
      const freshOrderStatus = { setStatus: jest.fn() } as unknown as OrderStatusService;
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ctv-1', role: 'AFFILIATE' }) },
        ...ownOrderMocks,
      });
      const svc = new MerchantService(prisma, freshOrderStatus);
      await expect(svc.updateMerchantOrderStatus('ctv-1', 'ord-1', 'NOT_A_STATUS')).rejects.toThrow(ForbiddenException);
    });

    it('đơn shop TỰ GIAO của chính mình → 403 chỉ sang tab "Đơn cần giao", không nói "do kho Tubu xử lý"', async () => {
      const freshOrderStatus = { setStatus: jest.fn() } as unknown as OrderStatusService;
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        ...ownOrderMocks,
        order: { findFirst: jest.fn().mockResolvedValue({ id: 'ord-1', fulfiller: 'MERCHANT', fulfillerStorefrontId: 's1' }) },
      });
      const svc = new MerchantService(prisma, freshOrderStatus);
      const err = await svc.updateMerchantOrderStatus('u1', 'ord-1', 'DELIVERED').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toBe(MERCHANT_SELF_SHIP_USE_FULFIL_TAB);
      expect(err.message).not.toContain('kho Tubu');
      expect(freshOrderStatus.setStatus).not.toHaveBeenCalled();
    });

    it('đơn do kho Tubu giao (fulfiller TUBU) vẫn giữ câu "do kho Tubu Tree xử lý"', async () => {
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        ...ownOrderMocks,
        order: { findFirst: jest.fn().mockResolvedValue({ id: 'ord-1', fulfiller: 'TUBU', fulfillerStorefrontId: null }) },
      });
      const svc = new MerchantService(prisma, { setStatus: jest.fn() } as unknown as OrderStatusService);
      await expect(svc.updateMerchantOrderStatus('u1', 'ord-1', 'DELIVERED')).rejects.toThrow(/do kho Tubu Tree xử lý/);
    });

    it('đơn không thuộc gian hàng của người gọi → 404 "Không tìm thấy đơn của gian hàng bạn.", không lộ đơn có tồn tại', async () => {
      const freshOrderStatus = { setStatus: jest.fn() } as unknown as OrderStatusService;
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'dealer-2', role: 'DEALER' }) },
        ...ownOrderMocks,
        order: { findFirst: jest.fn().mockResolvedValue(null) },
      });
      const svc = new MerchantService(prisma, freshOrderStatus);
      await expect(svc.updateMerchantOrderStatus('dealer-2', 'ord-1', 'DELIVERED')).rejects.toThrow(
        new NotFoundException('Không tìm thấy đơn của gian hàng bạn.'),
      );
      expect(freshOrderStatus.setStatus).not.toHaveBeenCalled();
    });
  });

  // P0 A5-05 (docs/audit-2026-09): đăng ký CTV (AFFILIATE) chỉ 1 chạm, không duyệt, nhưng
  // `listMyProducts` trước đây trả nguyên `variations: true` — gồm `dealerPrices` (giá sỉ mọi bậc
  // đại lý) và `affiliateRate` — cho BẤT KỲ ai tự đăng ký CTV. DEALER (admin duyệt hồ sơ) vẫn cần
  // các trường này vì đó là tính năng có chủ đích ở /dealer.
  describe('listMyProducts — A5-05 ẩn giá sỉ/hoa hồng nội bộ khỏi caller AFFILIATE', () => {
    const store = { id: 's1', ownerUserId: 'u1', collections: [] };
    const variation = {
      id: 'var-1',
      sku: 'SKU1',
      name: 'Mặc định',
      retailPrice: 100000,
      salePrice: null,
      dealerPrices: { tier_silver: 90000, tier_gold: 85000 },
      affiliateRate: 10,
      stock: 5,
      reservedStock: 0,
    };
    const ownProduct = { id: 'p1', name: 'SP riêng của gian hàng', variations: [variation] };
    const resellProductRow = { id: 'p2', name: 'SP Tubu bán lại', variations: [variation] };

    function makeProductsPrisma(role: string) {
      return makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        product: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([ownProduct]),
        },
        storefrontItem: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([{ id: 'item-1', product: resellProductRow }]),
        },
        orderItem: { groupBy: jest.fn().mockResolvedValue([]) },
      });
    }

    it('AFFILIATE: variations không còn dealerPrices/affiliateRate ở cả own lẫn resell, nhưng vẫn giữ tồn kho thật', async () => {
      const svc = new MerchantService(makeProductsPrisma('AFFILIATE'), orderStatus);
      const res = await svc.listMyProducts('u1');

      expect(JSON.stringify(res)).not.toContain('dealerPrices');
      expect(JSON.stringify(res)).not.toContain('affiliateRate');
      expect(res.ownProducts[0]!.variations[0]).not.toHaveProperty('dealerPrices');
      expect(res.ownProducts[0]!.variations[0]).not.toHaveProperty('affiliateRate');
      expect(res.resellProducts[0]!.variations[0]).not.toHaveProperty('dealerPrices');
      expect(res.resellProducts[0]!.variations[0]).not.toHaveProperty('affiliateRate');
      // Tồn kho thật vẫn cần để CTV biết SP còn bán được không.
      expect(res.ownProducts[0]!.variations[0]!.stock).toBe(5);
      expect(res.ownProducts[0]!.variations[0]!.retailPrice).toBe(100000);
    });

    it('DEALER: vẫn thấy dealerPrices/affiliateRate như cũ (tính năng có chủ đích ở /dealer)', async () => {
      const svc = new MerchantService(makeProductsPrisma('DEALER'), orderStatus);
      const res = await svc.listMyProducts('u1');

      expect(res.ownProducts[0]!.variations[0]).toHaveProperty('dealerPrices');
      expect(res.ownProducts[0]!.variations[0]).toHaveProperty('affiliateRate');
      expect(res.resellProducts[0]!.variations[0]).toHaveProperty('dealerPrices');
    });

    it('R2-MERCHANT-9: kèm số đơn vị khách đã đặt mà chưa gửi (đã trừ khỏi ô tồn kho) để form ghi rõ', async () => {
      const prisma = makeProductsPrisma('DEALER') as unknown as { orderItem: { groupBy: jest.Mock } };
      prisma.orderItem.groupBy.mockResolvedValue([{ variationId: 'var-1', _sum: { quantity: 2 } }]);
      const res = await new MerchantService(prisma as unknown as PrismaService, orderStatus).listMyProducts('u1');
      expect(res.ownProducts[0]).toMatchObject({ heldQty: 2 });
      const where = prisma.orderItem.groupBy.mock.calls[0][0].where;
      expect(where).toEqual({
        variationId: { in: ['var-1'] },
        order: { fulfiller: 'MERCHANT', fulfillerStorefrontId: 's1', status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'] } },
      });
    });

    it('ADMIN: vẫn thấy dealerPrices/affiliateRate như cũ', async () => {
      const svc = new MerchantService(makeProductsPrisma('ADMIN'), orderStatus);
      const res = await svc.listMyProducts('u1');

      expect(res.ownProducts[0]!.variations[0]).toHaveProperty('dealerPrices');
      expect(res.ownProducts[0]!.variations[0]).toHaveProperty('affiliateRate');
    });
  });

  // P0 A5-04 = A6-36 (docs/audit-2026-09): `GET /merchant/orders` trả tên/SĐT/địa chỉ giao đầy đủ
  // của khách cho CTV — kể cả khách chỉ "chạm" link 3 ngày. Không có tín hiệu nào phân biệt "đối
  // tác tự giao hàng thật" khỏi "CTV referral, kho Tubu giao" (xem A5-34 + describe chặn tự chuyển
  // trạng thái ở trên) nên áp dụng CÙNG mặc định an toàn: che PII cho mọi caller không phải ADMIN.
  describe('listMerchantOrders — A5-04=A6-36 che PII khách hàng', () => {
    const store = { id: 's1', ownerUserId: 'u1', slug: 'shop1', subdomain: 'shop1', collections: [] };
    const rawOrder = {
      id: 'ord-1',
      code: 'TB0001',
      status: 'DELIVERED',
      user: { id: 'cust-1', fullName: 'Nguyễn Văn An', phone: '0901234567' },
      items: [],
      shippingAddress: {
        recipient: 'Nguyễn Văn An',
        phone: '0901234567',
        street: '12 Lê Lợi',
        ward: 'Phường Bến Nghé',
        district: 'Quận 1',
        province: 'TP.HCM',
      },
    };

    function makeOrdersPrisma(role: string) {
      return makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        variation: { findMany: jest.fn().mockResolvedValue([]) },
        merchantPancakeLink: { findMany: jest.fn().mockResolvedValue([]) },
        order: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([rawOrder]),
        },
      });
    }

    it('AFFILIATE (CTV): che tên/SĐT khách + rút gọn địa chỉ về phường/quận/tỉnh', async () => {
      const svc = new MerchantService(makeOrdersPrisma('AFFILIATE'), orderStatus);
      const res = await svc.listMerchantOrders('u1');
      const order = res.data[0] as unknown as typeof rawOrder;

      expect(order.user?.fullName).not.toBe('Nguyễn Văn An');
      expect(order.user?.fullName).toContain('***');
      expect(order.user?.phone).not.toBe('0901234567');
      expect(JSON.stringify(order)).not.toContain('0901234567');
      expect(JSON.stringify(order)).not.toContain('12 Lê Lợi');
      expect(order.shippingAddress).not.toHaveProperty('street');
      expect(order.shippingAddress).not.toHaveProperty('recipient');
      expect(order.shippingAddress).not.toHaveProperty('phone');
      expect((order.shippingAddress as { province: string }).province).toBe('TP.HCM');
    });

    it('DEALER: cũng bị che PII (chưa có tín hiệu tự-giao-hàng đã xác thực nào — xem A5-34)', async () => {
      const svc = new MerchantService(makeOrdersPrisma('DEALER'), orderStatus);
      const res = await svc.listMerchantOrders('u1');
      const order = res.data[0] as unknown as typeof rawOrder;

      expect(JSON.stringify(order)).not.toContain('0901234567');
      expect(JSON.stringify(order)).not.toContain('12 Lê Lợi');
    });

    it('R5-PARTNER-6: gian hàng đối tác (MERCHANT) không nhận tài khoản người mua dưới bất kỳ dạng nào, kể cả bản đã che', async () => {
      const partnerStore = { ...store, type: 'MERCHANT' };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(partnerStore) },
        variation: { findMany: jest.fn().mockResolvedValue([]) },
        merchantPancakeLink: { findMany: jest.fn().mockResolvedValue([]) },
        order: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([rawOrder]) },
      });
      const res = await new MerchantService(prisma, orderStatus).listMerchantOrders('u1');
      const order = res.data[0] as unknown as Record<string, unknown>;
      expect(order).not.toHaveProperty('user');
      const json = JSON.stringify(res);
      for (const leaked of ['0901234567', '090****567', 'Nguyễn Văn An', 'An***', 'cust-1', '12 Lê Lợi']) {
        expect(json).not.toContain(leaked);
      }
      expect(order.shippingAddress).toEqual({ ward: 'Phường Bến Nghé', district: 'Quận 1', province: 'TP.HCM' });
    });

    it('ADMIN: vẫn thấy đầy đủ tên/SĐT/địa chỉ để vận hành', async () => {
      const svc = new MerchantService(makeOrdersPrisma('ADMIN'), orderStatus);
      const res = await svc.listMerchantOrders('u1');
      const order = res.data[0] as unknown as typeof rawOrder;

      expect(order.user?.fullName).toBe('Nguyễn Văn An');
      expect(order.user?.phone).toBe('0901234567');
      expect((order.shippingAddress as { street: string }).street).toBe('12 Lê Lợi');
    });
  });

  // C-040: đặc tả `maskFullName` (che tên khách trong đơn gian hàng). Khác `maskName` của game:
  // tách theo MỌI khoảng trắng (\\s+) và tên trống/toàn khoảng trắng ra tên mặc định "Khách Tubu".
  describe('listMerchantOrders — che tên khách (đặc tả maskFullName, C-040)', () => {
    const CASES: [string, string | null, string][] = [
      ['null -> mặc định', null, 'Khách Tubu'],
      ['rỗng -> mặc định', '', 'Khách Tubu'],
      ['chỉ khoảng trắng -> mặc định', '   ', 'Khách Tubu'],
      ['một từ', 'Long', 'Long***'],
      ['nhiều từ -> từ cuối', 'Lã Hoàng Long', 'Long***'],
      ['thừa khoảng trắng đầu/cuối', '  Nguyễn An  ', 'An***'],
      ['hai dấu cách liền nhau', 'Lã  Long', 'Long***'],
      ['tab giữa tên -> tách', 'Lã\tLong', 'Long***'],
      ['nbsp giữa tên -> tách', 'Lã\u00a0Long', 'Long***'],
    ];

    it.each(CASES)('%s', async (_label, fullName, expected) => {
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'AFFILIATE' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue({ id: 's1', ownerUserId: 'u1', slug: 'shop1', subdomain: 'shop1', collections: [] }) },
        variation: { findMany: jest.fn().mockResolvedValue([]) },
        merchantPancakeLink: { findMany: jest.fn().mockResolvedValue([]) },
        order: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([
            { id: 'ord-1', code: 'TB0001', status: 'DELIVERED', user: { id: 'c1', fullName, phone: '0901234567' }, shippingAddress: null, items: [] },
          ]),
        },
      });
      const res = await new MerchantService(prisma, orderStatus).listMerchantOrders('u1');
      expect((res.data[0] as unknown as { user: { fullName: string } }).user.fullName).toBe(expected);
    });
  });

  // C-013 (A5N-02): findMany dùng include nên trả mọi cột scalar của Order cho CTV — lộ
  // invoiceRequest (MST/email), note nội bộ, userId, referrerUserId, endCustomerKey (SĐT người
  // nhận lên-hộ). Phải chọn field tường minh (whitelist), không vá từng trường.
  describe('listMerchantOrders — C-013 chỉ trả field tường minh', () => {
    const store = { id: 's1', ownerUserId: 'u1', slug: 'shop1', subdomain: 'shop1', collections: [] };
    const FORBIDDEN = [
      'invoiceRequest',
      'invoiceUrl',
      'invoiceStatus',
      'note',
      'userId',
      'referrerUserId',
      'endCustomerKey',
      'idempotencyKey',
      'pancakeOrderId',
      'paymentTxnId',
      'commission',
      'recyclingNote',
      'gomdonOrderId',
    ];

    function setup(role: string) {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        variation: { findMany: jest.fn().mockResolvedValue([]) },
        merchantPancakeLink: { findMany: jest.fn().mockResolvedValue([]) },
        order: { count: jest.fn().mockResolvedValue(0), findMany },
      });
      return { svc: new MerchantService(prisma, orderStatus), findMany };
    }

    it.each(['AFFILIATE', 'DEALER', 'ADMIN'])('%s: findMany dùng select tường minh, không include', async (role) => {
      const { svc, findMany } = setup(role);
      await svc.listMerchantOrders('u1');
      const args = findMany.mock.calls[0]![0] as Record<string, unknown>;
      expect(args).toHaveProperty('select');
      expect(args).not.toHaveProperty('include');
    });

    it('select không chứa field nhạy cảm (đơn, user lồng, item)', async () => {
      const { svc, findMany } = setup('AFFILIATE');
      await svc.listMerchantOrders('u1');
      const select = (findMany.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
      for (const k of FORBIDDEN) expect(select).not.toHaveProperty(k);
      const user = (select.user as { select: Record<string, unknown> }).select;
      expect(user).not.toHaveProperty('id');
      const item = (select.items as { select: Record<string, unknown> }).select;
      expect(item).not.toHaveProperty('flashSaleItemId');
    });

    it('select vẫn đủ field mà bảng đơn của FE CTV đang dùng', async () => {
      const { svc, findMany } = setup('AFFILIATE');
      await svc.listMerchantOrders('u1');
      const select = (findMany.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
      for (const k of ['id', 'code', 'status', 'total', 'createdAt', 'shippingAddress', 'user', 'items']) {
        expect(select).toHaveProperty(k);
      }
      expect((select.user as { select: object }).select).toEqual({ fullName: true, phone: true });
      const item = (select.items as { select: Record<string, unknown> }).select;
      for (const k of ['id', 'productName', 'variationName', 'unitPrice', 'quantity', 'backorderedQty']) {
        expect(item).toHaveProperty(k);
      }
    });
  });

  // R2-MERCHANT-5: sau khi liên kết mã Pancake, gian hàng không được thấy đơn cũ của SKU đó hay hàng của nhãn khác trong đơn.
  describe('listMerchantOrders — gian hàng đối tác chỉ thấy dòng hàng của mình, trong thời gian liên kết', () => {
    const LINKED_AT = new Date('2026-10-10T00:00:00Z');
    const MSTORE = { id: 'sf-m', ownerUserId: 'u1', type: 'MERCHANT', collections: [] };
    const line = (id: string, variationId: string, total: number) => ({
      id,
      variationId,
      productName: id,
      productSlug: id,
      variationName: 'V',
      unitPrice: total,
      quantity: 1,
      total,
    });
    function setup(orders: unknown[]) {
      const findMany = jest.fn().mockResolvedValue(orders);
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(MSTORE) },
        variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v-own' }, { id: 'v-pk' }]) },
        merchantPancakeLink: {
          findMany: jest.fn().mockResolvedValue([{ variationId: 'v-pk', linkedAt: LINKED_AT, unlinkedAt: null }]),
        },
        order: { count: jest.fn().mockResolvedValue(orders.length), findMany },
      });
      return { svc: new MerchantService(prisma, orderStatus), findMany };
    }

    it('lọc đơn: biến thể tự tạo bất kỳ lúc nào, biến thể Pancake chỉ từ lúc liên kết; không còn lọc theo storefrontId', async () => {
      const { svc, findMany } = setup([]);
      await svc.listMerchantOrders('u1');
      expect(findMany.mock.calls[0][0].where).toEqual({
        OR: [
          { items: { some: { variationId: { in: ['v-own'] } } } },
          { createdAt: { gte: LINKED_AT }, items: { some: { variationId: 'v-pk' } } },
        ],
      });
    });

    it('đơn Tubu giao có hàng nhãn khác: chỉ trả dòng của gian hàng, ẩn tổng đơn, không lộ variationId', async () => {
      const order = {
        id: 'o1',
        code: 'TUBU1',
        createdAt: new Date('2026-10-12T00:00:00Z'),
        fulfiller: 'TUBU',
        fulfillerStorefrontId: null,
        subtotal: 263_000,
        discount: 0,
        shippingFee: 0,
        total: 263_000,
        user: null,
        shippingAddress: null,
        items: [line('Trà', 'v-pk', 65_000), line('Dầu tràm Cobote', 'v-other', 198_000)],
      };
      const { svc } = setup([order]);
      const res = await svc.listMerchantOrders('u1');
      const o = res.data[0] as Record<string, unknown> & { items: Record<string, unknown>[] };
      expect(o.items.map((i) => i.productName)).toEqual(['Trà']);
      expect(o).toMatchObject({ total: null, subtotal: null, discount: null, shippingFee: null, ownTotal: 65_000, partial: true });
      expect(o).not.toHaveProperty('fulfiller');
      expect(JSON.stringify(o)).not.toContain('Cobote');
      expect(JSON.stringify(o)).not.toContain('v-pk');
    });

    it('đơn gian hàng tự giao: giữ nguyên tổng và đánh dấu selfFulfilled để màn hình chỉ sang tab Đơn cần giao', async () => {
      const order = {
        id: 'o2',
        code: 'TUBU2',
        createdAt: new Date('2026-10-12T00:00:00Z'),
        fulfiller: 'MERCHANT',
        fulfillerStorefrontId: 'sf-m',
        total: 115_000,
        user: null,
        shippingAddress: null,
        items: [line('Xà phòng', 'v-own', 90_000)],
      };
      const { svc } = setup([order]);
      const res = await svc.listMerchantOrders('u1');
      expect(res.data[0]).toMatchObject({ total: 115_000, selfFulfilled: true, partial: false });
    });
  });

  describe('setOrdersPaused — "Tạm nghỉ" (R2-MERCHANT-13)', () => {
    function setup(store: Record<string, unknown>, role = 'AFFILIATE') {
      const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...store, ...data }));
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role }), findUnique: jest.fn().mockResolvedValue({ role }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store), update },
        userAdminEvent: { create: jest.fn().mockResolvedValue({}) },
        $queryRaw: jest.fn().mockResolvedValue([{ isPartner: false }]),
      });
      (prisma as unknown as { $transaction: unknown }).$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
      return { svc: new MerchantService(prisma, orderStatus), update };
    }

    it('bật thì ghi mốc tạm nghỉ (giữ mốc cũ nếu đang nghỉ), tắt thì xoá', async () => {
      const since = new Date('2026-10-01T00:00:00Z');
      const a = setup({ id: 'sf-m', type: 'MERCHANT', ownerUserId: 'u1', ordersPausedAt: null, collections: [] });
      await a.svc.setOrdersPaused('u1', true);
      expect(a.update.mock.calls[0][0].data.ordersPausedAt).toBeInstanceOf(Date);
      const b = setup({ id: 'sf-m', type: 'MERCHANT', ownerUserId: 'u1', ordersPausedAt: since, collections: [] });
      await b.svc.setOrdersPaused('u1', true);
      expect(b.update.mock.calls[0][0].data.ordersPausedAt).toBe(since);
      await b.svc.setOrdersPaused('u1', false);
      expect(b.update.mock.calls[1][0].data.ordersPausedAt).toBeNull();
    });

    it('gian hàng CTV không có hàng tự giao → 403', async () => {
      const { svc } = setup({ id: 'sf-c', type: 'CTV', ownerUserId: 'u1', collections: [] });
      await expect(svc.setOrdersPaused('u1', true)).rejects.toThrow(ForbiddenException);
    });

    it('đại lý còn gian hàng loại CTV vẫn bật được tạm nghỉ, loại gian hàng giữ nguyên', async () => {
      const { svc, update } = setup({ id: 'sf-c', type: 'CTV', ownerUserId: 'u1', collections: [] }, 'DEALER');
      await svc.setOrdersPaused('u1', true);
      expect(update.mock.calls[0][0].data).not.toHaveProperty('type');
    });
  });

  describe('updateStore — đổi tên gian hàng (R2-MERCHANT-7), kho gửi hàng chỉ cho gian hàng tự giao (SELLER-8)', () => {
    function setup(store: Record<string, unknown>, role = 'AFFILIATE', roleAfterLock = role) {
      const storefrontUpdate = jest.fn().mockResolvedValue({ ...store });
      const productUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
      const userAdminEventCreate = jest.fn().mockResolvedValue({});
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role }), findUnique: jest.fn().mockResolvedValue({ role: roleAfterLock }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store), update: storefrontUpdate },
        product: { updateMany: productUpdateMany },
        userAdminEvent: { create: userAdminEventCreate },
        $queryRaw: jest.fn().mockResolvedValue([{ isPartner: false }]),
        $transaction: jest.fn((arg: Promise<unknown>[] | ((tx: unknown) => unknown)) =>
          Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
        ),
      });
      return { svc: new MerchantService(prisma, orderStatus), storefrontUpdate, productUpdateMany, userAdminEventCreate };
    }

    it('đổi tên → tên nhãn của sản phẩm tự đăng (đang mang tên cũ) đổi theo', async () => {
      const { svc, productUpdateMany } = setup({ id: 'sf-m', type: 'MERCHANT', ownerUserId: 'u1', title: 'Shop A', collections: [] });
      await svc.updateStore('u1', { title: 'Vườn Xanh' });
      expect(productUpdateMany).toHaveBeenCalledWith({ where: { storefrontId: 'sf-m', brand: 'Shop A' }, data: { brand: 'Vườn Xanh' } });
    });

    it('gian hàng CTV: không lưu kho gửi hàng/SĐT kho (trang công khai không lộ SĐT)', async () => {
      const { svc, storefrontUpdate, productUpdateMany } = setup({ id: 'sf-c', type: 'CTV', ownerUserId: 'u1', title: 'CTV', collections: [] });
      await svc.updateStore('u1', { warehousePhone: '0955555555', warehouseAddress: '1 Lê Lợi' } as never);
      const data = storefrontUpdate.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('warehousePhone');
      expect(data).not.toHaveProperty('warehouseAddress');
      expect(productUpdateMany).not.toHaveBeenCalled();
    });

    it('đại lý còn gian hàng loại CTV: lưu được kho gửi hàng, không đổi loại gian hàng', async () => {
      const { svc, storefrontUpdate } = setup({ id: 'sf-c', type: 'CTV', isPartner: true, ownerUserId: 'u1', title: 'CTV', collections: [] }, 'DEALER');
      await svc.updateStore('u1', { warehousePhone: '0955555555' } as never);
      const data = storefrontUpdate.mock.calls[0][0].data;
      expect(data).toHaveProperty('warehousePhone', '0955555555');
      expect(data).not.toHaveProperty('type');
    });

    it('đại lý có gian hàng CTV chưa có cờ: lần vào Cổng đầu tiên bật isPartner, không đổi loại', async () => {
      const { svc, storefrontUpdate, userAdminEventCreate } = setup({ id: 'sf-c', type: 'CTV', isPartner: false, ownerUserId: 'u1', title: 'CTV', collections: [] }, 'DEALER');
      await svc.updateStore('u1', { warehousePhone: '0955555555' } as never);
      expect(storefrontUpdate.mock.calls[0][0]).toEqual({ where: { id: 'sf-c' }, data: { isPartner: true } });
      expect(userAdminEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'u1', kind: 'STOREFRONT_PARTNER', fromValue: 'false', toValue: 'true', reason: 'sf-c', actorId: 'u1' }),
      });
      expect(storefrontUpdate.mock.calls[1][0].data).toHaveProperty('warehousePhone', '0955555555');
      expect(storefrontUpdate.mock.calls.every(([a]) => !('type' in a.data))).toBe(true);
    });

    it('chủ đã hết là đại lý khi gian hàng bị khoá (thu hồi chen vào trước): không bật cờ', async () => {
      const { svc, storefrontUpdate } = setup({ id: 'sf-c', type: 'CTV', isPartner: false, ownerUserId: 'u1', title: 'CTV', collections: [] }, 'DEALER', 'CUSTOMER');
      await svc.updateStore('u1', { title: 'Mới' });
      expect(storefrontUpdate.mock.calls.every(([a]) => !('isPartner' in a.data))).toBe(true);
    });

    it('CTV thường (không phải đại lý) không được bật cờ', async () => {
      const { svc, storefrontUpdate } = setup({ id: 'sf-c', type: 'CTV', isPartner: false, ownerUserId: 'u1', title: 'CTV', collections: [] }, 'AFFILIATE');
      await svc.updateStore('u1', { title: 'Mới' });
      expect(storefrontUpdate.mock.calls.every(([a]) => !('isPartner' in a.data))).toBe(true);
    });
  });

  describe('publishStore', () => {
    const publishPrisma = (store: Record<string, unknown>, itemCount: number) => {
      const update = jest.fn().mockImplementation(({ data }) => ({ ...store, ...data }));
      return {
        update,
        prisma: makePrisma({
          user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
          storefront: { findFirst: jest.fn().mockResolvedValue(store), update },
          storefrontItem: { count: jest.fn().mockResolvedValue(itemCount) },
          product: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
        }),
      };
    };

    it('gian hàng đang bị admin gỡ: đối tác không tự đăng lại được, qua cả publishStore lẫn updateStore', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [], takenDownAt: new Date(), takenDownReason: 'Ảnh bìa vi phạm' };
      const { prisma, update } = publishPrisma(store, 3);
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.publishStore('u1', true)).rejects.toThrow(/Ảnh bìa vi phạm/);
      await expect(svc.updateStore('u1', { isPublished: true })).rejects.toBeInstanceOf(ForbiddenException);
      expect(update).not.toHaveBeenCalled();
    });

    it('gian hàng chưa có sản phẩm nào: chưa đăng được; ẩn gian hàng thì luôn được', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [], takenDownAt: null, takenDownReason: null };
      const { prisma, update } = publishPrisma(store, 0);
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.publishStore('u1', true)).rejects.toThrow('ít nhất 1 sản phẩm');
      await expect(svc.updateStore('u1', { isPublished: true })).rejects.toBeInstanceOf(BadRequestException);
      expect(update).not.toHaveBeenCalled();
    });

    it('gian hàng cũ đang đăng mà chưa có sản phẩm: đổi tên qua /merchant (luôn gửi isPublished) vẫn lưu được và giữ nguyên mốc đăng', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [], isPublished: true, publishedAt: new Date('2026-09-01'), takenDownAt: null, title: 'Cũ' };
      const { prisma, update } = publishPrisma(store, 0);
      const r = await new MerchantService(prisma, orderStatus).updateStore('u1', { title: 'Tên mới', isPublished: true });
      expect(r.title).toBe('Tên mới');
      const data = update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('publishedAt');
      expect(data).not.toHaveProperty('isPublished');
    });

    it('gian hàng đang bị gỡ (nháp, còn mốc đăng) lưu hồ sơ với isPublished=false: không xoá mốc đăng để admin đăng lại được', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [], isPublished: false, publishedAt: new Date('2026-09-01'), takenDownAt: new Date(), takenDownReason: 'x', title: 'Cũ' };
      const { prisma, update } = publishPrisma(store, 3);
      await new MerchantService(prisma, orderStatus).updateStore('u1', { title: 'Tên mới', isPublished: false });
      expect(update.mock.calls[0][0].data).not.toHaveProperty('publishedAt');
    });

    it('chuyển từ nháp sang đăng: kiểm đủ điều kiện và ghi mốc đăng; chuyển từ đăng sang ẩn: xoá mốc đăng', async () => {
      const draft = { id: 's1', ownerUserId: 'u1', collections: [], isPublished: false, publishedAt: null, takenDownAt: null };
      const a = publishPrisma(draft, 2);
      await new MerchantService(a.prisma, orderStatus).updateStore('u1', { isPublished: true });
      expect(a.update.mock.calls[0][0].data).toMatchObject({ isPublished: true, publishedAt: expect.any(Date) });
      const live = { ...draft, isPublished: true, publishedAt: new Date() };
      const b = publishPrisma(live, 0);
      await new MerchantService(b.prisma, orderStatus).updateStore('u1', { isPublished: false });
      expect(b.update.mock.calls[0][0].data).toMatchObject({ isPublished: false, publishedAt: null });
    });

    it('publishStore(true) trên gian hàng cũ đang đăng mà rỗng: không lỗi, không ghi lại mốc đăng', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [], isPublished: true, publishedAt: new Date('2026-09-01'), takenDownAt: null };
      const { prisma, update } = publishPrisma(store, 0);
      await expect(new MerchantService(prisma, orderStatus).publishStore('u1', true)).resolves.toBeDefined();
      expect(update.mock.calls[0]?.[0].data ?? {}).not.toHaveProperty('publishedAt');
    });

    it('lệnh đăng chỉ chạy khi gian hàng chưa bị gỡ (admin gỡ chen giữa không bị ghi đè)', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [], takenDownAt: null, takenDownReason: null };
      const { prisma, update } = publishPrisma(store, 1);
      await new MerchantService(prisma, orderStatus).publishStore('u1', true);
      expect(update.mock.calls[0][0].where).toEqual({ id: 's1', takenDownAt: null });
    });

    it('bật tắt xuất bản gian hàng đối tác thành công', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: {
          findFirst: jest.fn().mockResolvedValue(store),
          update: jest.fn().mockImplementation(({ data }) => ({ ...store, ...data })),
        },
        storefrontItem: { count: jest.fn().mockResolvedValue(2) },
      });
      const svc = new MerchantService(prisma, orderStatus);
      const published = await svc.publishStore('u1', true);
      expect(published.isPublished).toBe(true);
      expect(published.publishedAt).toBeInstanceOf(Date);

      const live = { ...store, isPublished: true, publishedAt: new Date() };
      const livePrisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(live), update: jest.fn().mockImplementation(({ data }) => ({ ...live, ...data })) },
      });
      const unpublished = await new MerchantService(livePrisma, orderStatus).publishStore('u1', false);
      expect(unpublished.isPublished).toBe(false);
      expect(unpublished.publishedAt).toBeNull();
    });
  });
});

