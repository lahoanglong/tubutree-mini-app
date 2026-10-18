import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StorefrontAdminService } from './storefront-admin.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { NotificationsService } from '../notifications/notifications.service';

const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
const affiliate = { commissionEligibleRoles: async () => new Set(['AFFILIATE', 'DEALER']) } as unknown as AffiliateService;

const row = (over: Record<string, unknown> = {}) => ({
  id: 's1', slug: 'linh', title: 'Shop Linh', type: 'CTV', isPartner: false, isPublished: true, publishedAt: new Date('2026-10-01'),
  approvedAt: null, takenDownAt: null, takenDownReason: null, createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-10-02'),
  ownerUserId: 'u1', owner: { id: 'u1', fullName: 'Linh', phone: '0900000001', role: 'AFFILIATE', isBlocked: false },
  collections: [{ _count: { items: 2 } }, { _count: { items: 1 } }],
  ...over,
});

function setup(over: { storefront?: Record<string, jest.Mock> } = {}) {
  const storefront = {
    findMany: jest.fn().mockResolvedValue([row()]),
    count: jest.fn().mockResolvedValue(1),
    findUnique: jest.fn().mockResolvedValue(row()),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    ...over.storefront,
  };
  const notify = jest.fn().mockResolvedValue(undefined);
  const svc = new StorefrontAdminService(
    { storefront } as unknown as PrismaService,
    config,
    affiliate,
    { notify } as unknown as NotificationsService,
  );
  return { svc, storefront, notify };
}

describe('StorefrontAdminService.list', () => {
  it('trả dòng gọn: số sản phẩm, đã duyệt chưa, có hiện với khách không, thông tin chủ', async () => {
    const { svc } = setup();
    const r = await svc.list({ page: 1, limit: 20 });
    expect(r.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(r.data[0]).toMatchObject({
      id: 's1', title: 'Shop Linh', itemCount: 3, approved: false, publicVisible: true, hiddenReason: null,
      owner: { id: 'u1', fullName: 'Linh', phone: '0900000001', role: 'AFFILIATE' },
    });
  });

  it('không kéo ảnh bìa/avatar (có thể là base64 1,5MB) vào danh sách', async () => {
    const { svc, storefront } = setup();
    await svc.list({ page: 1, limit: 20 });
    const args = storefront.findMany.mock.calls[0][0];
    expect(args.select ?? {}).not.toHaveProperty('avatarUrl');
    expect(args.select ?? {}).not.toHaveProperty('coverUrl');
    expect(args.select).toBeDefined();
  });

  it.each([
    ['PUBLISHED', { isPublished: true, takenDownAt: null }],
    ['DRAFT', { isPublished: false, takenDownAt: null }],
    ['TAKEN_DOWN', { takenDownAt: { not: null } }],
    ['PENDING_APPROVAL', { isPublished: true, takenDownAt: null, type: 'CTV', isPartner: false, approvedAt: null }],
  ] as const)('lọc trạng thái %s', async (status, expected) => {
    const { svc, storefront } = setup();
    await svc.list({ page: 1, limit: 20, status });
    expect(storefront.findMany.mock.calls[0][0].where.AND).toContainEqual(expected);
    expect(storefront.count.mock.calls[0][0].where.AND).toContainEqual(expected);
  });

  it('lọc loại và tìm theo tên, mã, tên hoặc SĐT của chủ (không phân biệt hoa/thường)', async () => {
    const { svc, storefront } = setup();
    await svc.list({ page: 1, limit: 20, type: 'MERCHANT', q: ' Linh ' });
    const and = storefront.findMany.mock.calls[0][0].where.AND;
    expect(and).toContainEqual({ type: 'MERCHANT' });
    const search = and.find((c: Record<string, unknown>) => 'OR' in c);
    expect(JSON.stringify(search)).toContain('"contains":"Linh"');
    expect(JSON.stringify(search)).toContain('phone');
  });

  it('gian hàng đang đăng nhưng chủ bị khoá: publicVisible false kèm lý do để admin hiểu vì sao khách không thấy', async () => {
    const { svc } = setup({ storefront: { findMany: jest.fn().mockResolvedValue([row({ owner: { id: 'u1', fullName: 'Linh', phone: null, role: 'AFFILIATE', isBlocked: true } })]) } });
    const r = await svc.list({ page: 1, limit: 20 });
    expect(r.data[0]).toMatchObject({ publicVisible: false });
    expect(r.data[0]!.hiddenReason).toContain('khoá');
  });
});

describe('StorefrontAdminService.takeDown', () => {
  it('gỡ đăng kèm lý do: ẩn gian hàng, ghi ai gỡ và lúc nào, rồi báo chủ gian hàng', async () => {
    const { svc, storefront, notify } = setup();
    await svc.takeDown('admin1', 's1', '  Dùng ảnh của nhãn khác  ');
    const call = storefront.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 's1', takenDownAt: null });
    expect(call.data).toMatchObject({ isPublished: false, takenDownReason: 'Dùng ảnh của nhãn khác', takenDownById: 'admin1' });
    expect(call.data.takenDownAt).toBeInstanceOf(Date);
    expect(notify).toHaveBeenCalledWith('u1', 'STOREFRONT_TAKEN_DOWN', { store: 'Shop Linh', reason: 'Dùng ảnh của nhãn khác' });
  });

  it('không có lý do thì từ chối (chủ phải biết sửa gì)', async () => {
    const { svc, storefront } = setup();
    await expect(svc.takeDown('admin1', 's1', '   ')).rejects.toBeInstanceOf(BadRequestException);
    expect(storefront.updateMany).not.toHaveBeenCalled();
  });

  it('gian hàng không tồn tại → 404', async () => {
    const { svc } = setup({ storefront: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(svc.takeDown('admin1', 'nope', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đã bị gỡ rồi (bấm lại hoặc hai admin cùng bấm): không ghi đè lý do cũ và không báo chủ lần hai', async () => {
    const { svc, notify } = setup({
      storefront: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findUnique: jest.fn().mockResolvedValue(row({ takenDownAt: new Date(), takenDownReason: 'Lý do cũ', isPublished: false })) },
    });
    const r = await svc.takeDown('admin2', 's1', 'Lý do mới');
    expect(r.takenDownReason).toBe('Lý do cũ');
    expect(notify).not.toHaveBeenCalled();
  });

  it('gian hàng không có chủ (nhãn hàng): vẫn gỡ được, không có ai để báo', async () => {
    const { svc, notify } = setup({ storefront: { findUnique: jest.fn().mockResolvedValue(row({ ownerUserId: null, owner: null })) } });
    await svc.takeDown('admin1', 's1', 'x');
    expect(notify).not.toHaveBeenCalled();
  });

  it('báo chủ lỗi thì việc gỡ vẫn thành công', async () => {
    const { svc, notify } = setup();
    notify.mockRejectedValue(new Error('queue down'));
    await expect(svc.takeDown('admin1', 's1', 'x')).resolves.toBeDefined();
  });
});

describe('StorefrontAdminService.reinstate', () => {
  it('đăng lại: bỏ dấu gỡ, khôi phục trạng thái đăng trước đó (đã từng đăng thì hiện lại) và báo chủ', async () => {
    const { svc, storefront, notify } = setup();
    await svc.reinstate('admin1', 's1');
    const first = storefront.updateMany.mock.calls[0][0];
    expect(first.where).toEqual({ id: 's1', takenDownAt: { not: null }, publishedAt: { not: null } });
    expect(first.data).toEqual({ takenDownAt: null, takenDownReason: null, takenDownById: null, isPublished: true });
    expect(notify).toHaveBeenCalledWith('u1', 'STOREFRONT_REINSTATED', { store: 'Shop Linh' });
  });

  it('gian hàng bị gỡ khi còn nháp (chưa từng đăng): chỉ bỏ dấu gỡ, vẫn là nháp', async () => {
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const { svc, storefront } = setup({ storefront: { updateMany } });
    await svc.reinstate('admin1', 's1');
    expect(storefront.updateMany.mock.calls[1][0].where).toEqual({ id: 's1', takenDownAt: { not: null }, publishedAt: null });
    expect(storefront.updateMany.mock.calls[1][0].data).toEqual({ takenDownAt: null, takenDownReason: null, takenDownById: null });
  });

  it('không bị gỡ: không làm gì, không báo chủ', async () => {
    const { svc, notify } = setup({ storefront: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } });
    await svc.reinstate('admin1', 's1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('gian hàng không tồn tại → 404', async () => {
    const { svc } = setup({ storefront: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(svc.reinstate('admin1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('StorefrontAdminService.setApproved', () => {
  it('duyệt lần đầu: ghi ai duyệt và lúc nào, báo chủ', async () => {
    const { svc, storefront, notify } = setup();
    await svc.setApproved('admin1', 's1', true);
    const call = storefront.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 's1', approvedAt: null });
    expect(call.data.approvedById).toBe('admin1');
    expect(call.data.approvedAt).toBeInstanceOf(Date);
    expect(notify).toHaveBeenCalledWith('u1', 'STOREFRONT_APPROVED', { store: 'Shop Linh' });
  });

  it('duyệt gian hàng đã duyệt: không đổi mốc duyệt cũ, không báo lại', async () => {
    const { svc, notify } = setup({ storefront: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findUnique: jest.fn().mockResolvedValue(row({ approvedAt: new Date() })) } });
    await svc.setApproved('admin1', 's1', true);
    expect(notify).not.toHaveBeenCalled();
  });

  it('bỏ duyệt: xoá mốc duyệt, không báo chủ', async () => {
    const { svc, storefront, notify } = setup();
    await svc.setApproved('admin1', 's1', false);
    const call = storefront.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 's1', approvedAt: { not: null } });
    expect(call.data).toEqual({ approvedAt: null, approvedById: null });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('StorefrontAdminService.detail', () => {
  it('trả hồ sơ đầy đủ để duyệt: ảnh, lời giới thiệu, bộ sưu tập kèm sản phẩm, ai gỡ/duyệt', async () => {
    const full = row({
      headerNote: 'Hàng sạch', avatarUrl: 'https://x/a.jpg', coverUrl: 'https://x/c.jpg', subdomain: 'linh-xanh',
      approvedById: 'admin9', takenDownById: null,
      collections: [{ id: 'c1', title: 'Nổi bật', kind: 'NORMAL', items: [{ id: 'i1', note: 'Dùng tốt', isHidden: false, isPinned: true, product: { id: 'p1', name: 'Bình nước', slug: 'binh-nuoc', thumbnail: null } }] }],
    });
    const { svc } = setup({ storefront: { findUnique: jest.fn().mockResolvedValue(full) } });
    const d = await svc.detail('s1');
    expect(d).toMatchObject({ headerNote: 'Hàng sạch', avatarUrl: 'https://x/a.jpg', subdomain: 'linh-xanh', itemCount: 1 });
    expect(d.collections[0]!.items[0]).toMatchObject({ productName: 'Bình nước', note: 'Dùng tốt', isPinned: true });
  });

  it('không tồn tại → 404', async () => {
    const { svc } = setup({ storefront: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(svc.detail('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
