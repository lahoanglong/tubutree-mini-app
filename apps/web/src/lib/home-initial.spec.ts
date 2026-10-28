import { afterEach, describe, expect, it, vi } from 'vitest';

const revalidates: (number | undefined)[] = [];
let failAll = false;

vi.mock('@/lib/core-http-server', () => ({
  createServerHttp: (init?: { revalidate?: number }) => {
    revalidates.push(init?.revalidate);
    return {
      get: async (path: string) => {
        if (failAll) throw new Error(`API ${path} không sẵn sàng`);
        if (path.startsWith('/products')) return { data: [], meta: { page: 1, limit: 12, total: 0 } };
        if (path.includes('/config/public')) return { freeshipThreshold: 350000 };
        return [];
      },
    };
  },
}));
const flashItems = [{ itemId: 'i1', endAt: '2099-01-01T00:00:00Z' }];
vi.mock('@tubutree/app-core/api/flash-sale', () => ({
  fetchActiveFlashSales: async () => { if (failAll) throw new Error('x'); return flashItems; },
}));
vi.mock('@tubutree/app-core/api/catalog', () => ({
  fetchBrands: async () => { if (failAll) throw new Error('x'); return []; },
  fetchCategories: async () => { if (failAll) throw new Error('x'); return []; },
  fetchProducts: async () => { if (failAll) throw new Error('x'); return { data: [], meta: { page: 1, limit: 12, total: 0 } }; },
}));
vi.mock('@tubutree/app-core/queries/config', () => ({ publicConfigQuery: () => ({ queryFn: async () => { if (failAll) throw new Error('x'); return { freeshipThreshold: 350000 }; } }) }));
vi.mock('@tubutree/app-core/queries/home', () => ({ homeBestSellerQuery: () => ({ queryFn: async () => { if (failAll) throw new Error('x'); return []; } }) }));

import { BUILD_GAP_REVALIDATE_S, FLASH_REVALIDATE_S, loadHomeInitial } from './home-initial';

afterEach(() => {
  revalidates.length = 0;
  failAll = false;
  vi.unstubAllEnvs();
});

describe('loadHomeInitial: bản dựng sẵn thiếu dữ liệu', () => {
  it('next build khi API chưa lên: thêm lệnh fetch hạn ngắn để trang làm mới sớm', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    failAll = true;
    const initial = await loadHomeInitial();
    expect(initial.publicConfig).toBeUndefined();
    expect(revalidates).toContain(BUILD_GAP_REVALIDATE_S);
  });

  it('next build khi API đã lên: giữ hạn mặc định', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    await loadHomeInitial();
    expect(revalidates).not.toContain(BUILD_GAP_REVALIDATE_S);
  });

  it('runtime khi API sập hẳn: ném để Next giữ bản cũ', async () => {
    failAll = true;
    await expect(loadHomeInitial()).rejects.toThrow();
  });
});

describe('loadHomeInitial: Giờ vàng có trong HTML đầu', () => {
  it('tải /flash-sales/active phía máy chủ với hạn ngắn để khối Giờ vàng không chen vào sau hydrate', async () => {
    const initial = await loadHomeInitial();
    expect(initial.flash).toEqual(flashItems);
    expect(revalidates).toContain(FLASH_REVALIDATE_S);
  });

  it('lỗi riêng phần Giờ vàng thì bỏ phần đó, không làm hỏng trang', async () => {
    failAll = true;
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    expect((await loadHomeInitial()).flash).toBeUndefined();
  });
});
