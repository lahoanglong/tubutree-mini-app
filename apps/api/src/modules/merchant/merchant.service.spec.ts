import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MerchantService } from './merchant.service';
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
        },
        storefront: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(createdStore),
        },
      });
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.getOrCreateStore('u2');
      expect(res.id).toBe('s-new');
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
      const store = { id: 's1', ownerUserId: 'u1', title: 'Xanh Shop', collections: [{ id: 'col1' }] };
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
    it('ném NotFoundException nếu đơn hàng không chứa sản phẩm của merchant', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        product: { findMany: jest.fn().mockResolvedValue([{ variations: [{ id: 'var-1' }] }]) },
        order: { findFirst: jest.fn().mockResolvedValue(null) },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.updateMerchantOrderStatus('u1', 'ord-99', 'PACKED')).rejects.toThrow(NotFoundException);
    });

    it('cập nhật trạng thái đơn hàng của kho đối tác thành công', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        product: { findMany: jest.fn().mockResolvedValue([{ variations: [{ id: 'var-1' }] }]) },
        order: { findFirst: jest.fn().mockResolvedValue({ id: 'ord-1' }) },
      });
      (orderStatus.setStatus as jest.Mock).mockResolvedValueOnce({ id: 'ord-1', status: 'PACKED' });
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.updateMerchantOrderStatus('u1', 'ord-1', 'PACKED');
      expect(res.status).toBe('PACKED');
      expect(orderStatus.setStatus).toHaveBeenCalledWith('ord-1', 'PACKED');
    });

    it('ném BadRequestException nếu trạng thái đơn hàng không hợp lệ', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
      });
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.updateMerchantOrderStatus('u1', 'ord-1', 'INVALID_STATUS')).rejects.toThrow(BadRequestException);
    });

    it('chuyển transition không hợp lệ (guard dùng chung với admin/pancake) → BadRequestException, không phải 500', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        product: { findMany: jest.fn().mockResolvedValue([{ variations: [{ id: 'var-1' }] }]) },
        order: { findFirst: jest.fn().mockResolvedValue({ id: 'ord-1' }) },
      });
      const { InvalidOrderTransitionError } = jest.requireActual('../orders/order-transition');
      (orderStatus.setStatus as jest.Mock).mockRejectedValueOnce(new InvalidOrderTransitionError('DELIVERED', 'CONFIRMED'));
      const svc = new MerchantService(prisma, orderStatus);
      await expect(svc.updateMerchantOrderStatus('u1', 'ord-1', 'CONFIRMED')).rejects.toThrow(BadRequestException);
    });

    it('cập nhật trạng thái đơn hàng theo storefrontSlug thành công', async () => {
      const store = { id: 's1', ownerUserId: 'u1', slug: 'shop1', subdomain: 'shop1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: { findFirst: jest.fn().mockResolvedValue(store) },
        product: { findMany: jest.fn().mockResolvedValue([]) },
        order: { findFirst: jest.fn().mockResolvedValue({ id: 'ord-sf-1' }) },
      });
      (orderStatus.setStatus as jest.Mock).mockResolvedValueOnce({ id: 'ord-sf-1', status: 'SHIPPING' });
      const svc = new MerchantService(prisma, orderStatus);
      const res = await svc.updateMerchantOrderStatus('u1', 'ord-sf-1', 'SHIPPING');
      expect(res.status).toBe('SHIPPING');
    });
  });

  describe('publishStore', () => {
    it('bật tắt xuất bản gian hàng đối tác thành công', async () => {
      const store = { id: 's1', ownerUserId: 'u1', collections: [] };
      const prisma = makePrisma({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'DEALER' }) },
        storefront: {
          findFirst: jest.fn().mockResolvedValue(store),
          update: jest.fn().mockImplementation(({ data }) => ({ ...store, ...data })),
        },
      });
      const svc = new MerchantService(prisma, orderStatus);
      const published = await svc.publishStore('u1', true);
      expect(published.isPublished).toBe(true);
      expect(published.publishedAt).toBeInstanceOf(Date);

      const unpublished = await svc.publishStore('u1', false);
      expect(unpublished.isPublished).toBe(false);
      expect(unpublished.publishedAt).toBeNull();
    });
  });
});

