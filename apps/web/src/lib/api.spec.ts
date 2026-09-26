import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatSold, formatVnd } from './api';
import type { MerchantOrder, MerchantProduct } from './merchant-client';

describe('formatVnd', () => {
  it('format số nguyên kèm đ, phân cách nghìn kiểu VN', () => {
    expect(formatVnd(1_000_000)).toBe('1.000.000đ');
  });
});

describe('formatSold — kiểu Shopee', () => {
  it('null/undefined/0/âm → ẩn (null)', () => {
    expect(formatSold(null)).toBeNull();
    expect(formatSold(undefined)).toBeNull();
    expect(formatSold(0)).toBeNull();
    expect(formatSold(-5)).toBeNull();
  });

  it('< 1000 → hiện số thật', () => {
    expect(formatSold(1)).toBe('Đã bán 1');
    expect(formatSold(999)).toBe('Đã bán 999');
  });

  it('≥ 1000 và < 1 triệu → rút gọn "k+", bỏ .0 thừa', () => {
    expect(formatSold(1000)).toBe('Đã bán 1k+');
    expect(formatSold(1200)).toBe('Đã bán 1,2k+');
  });

  it('biên 999.999 (sát 1 triệu) → toFixed(1) làm tròn thành "1000k+" thay vì nhảy sang "1tr+" (quirk hiện tại, không phải bug chặn)', () => {
    expect(formatSold(999_999)).toBe('Đã bán 1000k+');
  });

  it('≥ 1 triệu → rút gọn "tr+"', () => {
    expect(formatSold(1_000_000)).toBe('Đã bán 1tr+');
    expect(formatSold(2_500_000)).toBe('Đã bán 2,5tr+');
  });

  it('NaN/không phải số hữu hạn → ẩn (null)', () => {
    expect(formatSold(Number.NaN)).toBeNull();
  });
});

describe('listReturnRequests & reviewReturnRequest client', () => {
  it('listReturnRequests gọi đúng endpoint với page/limit + status, giữ meta phân trang', async () => {
    const { listReturnRequests } = await import('./admin-client');
    const { vi: vitestVi } = await import('vitest');
    const mockFetch = vitestVi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'ret-1', status: 'REQUESTED' }], meta: { page: 1, limit: 100, total: 130 } }),
    });
    vitestVi.stubGlobal('fetch', mockFetch);
    const res = await listReturnRequests('REQUESTED');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/return-requests?page=1&limit=100&status=REQUESTED'),
      expect.any(Object),
    );
    expect(res.data).toHaveLength(1);
    // meta KHÔNG được bỏ: tab Đổi/Trả cần total để biết còn yêu cầu cũ hơn chưa tải.
    expect(res.meta.total).toBe(130);
    vitestVi.unstubAllGlobals();
  });

  it('hàng chờ duyệt gửi order=asc (chờ lâu nhất lên đầu trên MỌI trang); không truyền → không gửi order', async () => {
    const { listReturnRequests, listDealerApps } = await import('./admin-client');
    const { vi: vitestVi } = await import('vitest');
    const mockFetch = vitestVi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], meta: { page: 1, limit: 100, total: 0 } }),
    });
    vitestVi.stubGlobal('fetch', mockFetch);
    await listReturnRequests('REQUESTED', 1, undefined, 'asc');
    await listDealerApps('PENDING', 2, undefined, 'asc');
    await listDealerApps('APPROVED');
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain('/admin/return-requests?page=1&limit=100&status=REQUESTED&order=asc');
    expect(urls[1]).toContain('/admin/dealer-applications?page=2&limit=100&status=PENDING&order=asc');
    expect(urls[2]).not.toContain('order=');
    vitestVi.unstubAllGlobals();
  });

  it('reviewReturnRequest POST đúng id, approve và note', async () => {
    const { reviewReturnRequest } = await import('./admin-client');
    const { vi: vitestVi } = await import('vitest');
    const mockFetch = vitestVi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'ret-1', status: 'APPROVED' }),
    });
    vitestVi.stubGlobal('fetch', mockFetch);
    const data = await reviewReturnRequest('ret-1', true, 'Đã kiểm tra');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/return-requests/ret-1/review'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ approve: true, note: 'Đã kiểm tra' }),
      }),
    );
    expect(data.status).toBe('APPROVED');
    vitestVi.unstubAllGlobals();
  });
});

describe('admin dashboard & order management client', () => {
  it('getDashboardStats fetches /admin/dashboard/stats', async () => {
    const { getDashboardStats } = await import('./admin-client');
    const { vi: vitestVi } = await import('vitest');
    const mockStats = {
      totalRevenue: 50000000,
      totalOrders: 120,
      pendingOrders: 5,
      shippingOrders: 10,
      deliveredOrders: 100,
      cancelledOrders: 5,
      totalUsers: 300,
      totalAffiliates: 45,
      totalProducts: 28,
      plantedTreesCount: 85,
      recentOrders: [],
    };
    const mockFetch = vitestVi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockStats,
    });
    vitestVi.stubGlobal('fetch', mockFetch);
    const data = await getDashboardStats();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/dashboard/stats'),
      expect.any(Object),
    );
    expect(data.totalRevenue).toBe(50000000);
    expect(data.totalOrders).toBe(120);
    vitestVi.unstubAllGlobals();
  });

  it('updateOrderStatus sends PUT request with status and note', async () => {
    const { updateOrderStatus } = await import('./admin-client');
    const { vi: vitestVi } = await import('vitest');
    const mockFetch = vitestVi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'ord-123', code: 'TB-99', status: 'DELIVERED' }),
    });
    vitestVi.stubGlobal('fetch', mockFetch);
    const data = await updateOrderStatus('ord-123', 'DELIVERED', 'Giao thành công');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/orders/ord-123/status'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ status: 'DELIVERED', note: 'Giao thành công' }),
      }),
    );
    expect(data.status).toBe('DELIVERED');
    vitestVi.unstubAllGlobals();
  });

  it('listOrders includes search parameter when provided', async () => {
    const { listOrders } = await import('./admin-client');
    const { vi: vitestVi } = await import('vitest');
    const mockFetch = vitestVi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], meta: { page: 1, limit: 20, total: 0 } }),
    });
    vitestVi.stubGlobal('fetch', mockFetch);
    await listOrders(1, 'CONFIRMED', '0912345678');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('status=CONFIRMED&search=0912345678'),
      expect.any(Object),
    );
    vitestVi.unstubAllGlobals();
  });
});

/**
 * Cổng đối tác (/merchant): BE MerchantService.listMerchantOrders trả `paginated()` = `{ data, meta }`
 * nhưng client cũ khai `MerchantOrder[]` → trang gọi `ordersQ.data?.filter(...)` / `q.data.map(...)` trên
 * một OBJECT → TypeError, trắng trang với MỌI đại lý/CTV. listMyProducts cũng trả kèm meta
 * {ownTotal, resellTotal} mà client bỏ qua → số "Sản phẩm riêng" không bao giờ vượt 20.
 */
describe('merchant-client — khớp dạng phân trang của MerchantService', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(json: unknown) {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => json });
    vi.stubGlobal('fetch', f);
    return f;
  }

  const order = (code: string): MerchantOrder => ({
    id: `id-${code}`,
    code,
    status: 'CONFIRMED',
    total: 150000,
    createdAt: '2026-09-20T08:00:00.000Z',
    items: [{ id: 'i1', productName: 'Trà Oolong', unitPrice: 150000, quantity: 1, total: 150000 }],
  });

  it('listMerchantOrders gửi page/limit/status và trả {data, meta} — không phải mảng', async () => {
    const { listMerchantOrders } = await import('./merchant-client');
    const f = stubFetch({ data: [order('TB-1')], meta: { page: 2, limit: 20, total: 45 } });
    const res = await listMerchantOrders('CONFIRMED', 2);
    expect(f.mock.calls[0]![0]).toContain('/merchant/orders?page=2&limit=20&status=CONFIRMED');
    // Kiểu: `res.data` phải là MerchantOrder[] (client cũ khai cả response là MerchantOrder[] → tsc lỗi ở đây).
    const rows: MerchantOrder[] = res.data;
    expect(rows.map((o) => o.code)).toEqual(['TB-1']);
    expect(res.meta).toEqual({ page: 2, limit: 20, total: 45 });
  });

  it('listMerchantOrders không lọc trạng thái → không gửi status', async () => {
    const { listMerchantOrders } = await import('./merchant-client');
    const f = stubFetch({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    await listMerchantOrders();
    expect(f.mock.calls[0]![0]).toMatch(/\/merchant\/orders\?page=1&limit=20$/);
  });

  it('countMerchantOrders đọc meta.total (limit=1), không đếm trên trang đầu', async () => {
    const { countMerchantOrders } = await import('./merchant-client');
    const f = stubFetch({ data: [order('TB-9')], meta: { page: 1, limit: 1, total: 37 } });
    await expect(countMerchantOrders('CONFIRMED')).resolves.toBe(37);
    expect(f.mock.calls[0]![0]).toContain('/merchant/orders?page=1&limit=1&status=CONFIRMED');
  });

  it('getMerchantProducts gửi page/limit và giữ meta ownTotal/resellTotal', async () => {
    const { getMerchantProducts } = await import('./merchant-client');
    const p = { id: 'p1', name: 'SP', slug: 'sp', description: '', basePrice: 1, images: [], approvalStatus: 'APPROVED', createdAt: '' };
    const f = stubFetch({ ownProducts: [p], resellProducts: [], meta: { page: 3, limit: 20, ownTotal: 61, resellTotal: 4 } });
    const res = await getMerchantProducts(3);
    expect(f.mock.calls[0]![0]).toContain('/merchant/products?page=3&limit=20');
    const own: MerchantProduct[] = res.ownProducts;
    expect(own).toHaveLength(1);
    expect(res.meta.ownTotal).toBe(61);
    expect(res.meta.resellTotal).toBe(4);
  });
});

describe('pageRange — phân trang theo trang (cổng đối tác)', () => {
  it('trang giữa / trang cuối / rỗng', async () => {
    const { pageRange } = await import('./admin-client');
    expect(pageRange({ page: 2, limit: 20 }, 45, 20)).toEqual({
      label: 'Hiển thị 21–40/45',
      totalPages: 3,
      hasPrev: true,
      hasNext: true,
    });
    expect(pageRange({ page: 3, limit: 20 }, 45, 5)).toEqual({
      label: 'Hiển thị 41–45/45',
      totalPages: 3,
      hasPrev: true,
      hasNext: false,
    });
    expect(pageRange({ page: 1, limit: 20 }, 0, 0)).toEqual({
      label: 'Hiển thị 0/0',
      totalPages: 1,
      hasPrev: false,
      hasNext: false,
    });
  });
});

describe('CSV export utility', () => {
  it('generateOrdersCsvString formats orders correctly with headers and escaping', async () => {
    const { generateOrdersCsvString } = await import('./export-csv');
    const sampleOrders = [
      {
        id: 'ord-1',
        code: 'TB-001',
        status: 'DELIVERED',
        total: 350000,
        paymentMethod: 'COD',
        createdAt: '2026-09-01T10:00:00Z',
        note: 'Giao giờ hành chính, gọi trước',
        user: { id: 'u1', fullName: 'Nguyễn Văn A', phone: '0901234567' },
        items: [
          { id: 'i1', productName: 'Trà Oolong', unitPrice: 150000, quantity: 2, total: 300000, backorderedQty: 0 },
          { id: 'i2', productName: 'Bình giữ nhiệt', unitPrice: 50000, quantity: 1, total: 50000, backorderedQty: 0 },
        ],
      },
    ];

    const csv = generateOrdersCsvString(sampleOrders);
    expect(csv).toContain('Mã đơn hàng,Khách hàng,Số điện thoại,Tổng tiền (VNĐ)');
    expect(csv).toContain('TB-001');
    expect(csv).toContain('Nguyễn Văn A');
    expect(csv).toContain('0901234567');
    expect(csv).toContain('350000');
    expect(csv).toContain('COD (Tiền mặt)');
    expect(csv).toContain('Đã giao hàng');
    expect(csv).toContain('"Giao giờ hành chính, gọi trước"'); // comma escaped
    expect(csv).toContain(',3,'); // 2 + 1 = 3 items
  });

  it('generateUsersCsvString formats users correctly', async () => {
    const { generateUsersCsvString } = await import('./export-csv');
    const sampleUsers = [
      {
        id: 'user-1',
        fullName: 'Trần Thị B',
        phone: '0987654321',
        role: 'AFFILIATE',
        pointsBalance: 120,
        createdAt: '2026-08-15T08:30:00Z',
      },
    ];

    const csv = generateUsersCsvString(sampleUsers);
    expect(csv).toContain('User ID,Họ và tên,Số điện thoại,Vai trò,Điểm tích lũy');
    expect(csv).toContain('user-1');
    expect(csv).toContain('Trần Thị B');
    expect(csv).toContain('0987654321');
    expect(csv).toContain('AFFILIATE');
    expect(csv).toContain('120');
  });
});

