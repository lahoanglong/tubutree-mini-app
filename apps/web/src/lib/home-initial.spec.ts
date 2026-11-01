import { afterEach, describe, expect, it, vi } from 'vitest';

const revalidates: (number | undefined)[] = [];
let failAll = false;
let failFlash = false;
let failCampaigns = false;
let campaignList: { id: string; endAt: string }[] | null = null;
let flashList: { itemId: string; endAt: string }[] | null = null;
const productCalls: Record<string, unknown>[] = [];
const campaignPlacements: string[] = [];

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
const bestSellerRows = [{ id: 'b1' }];
vi.mock('@tubutree/app-core/api/flash-sale', () => ({
  fetchActiveFlashSales: async () => { if (failAll || failFlash) throw new Error('x'); return flashList ?? flashItems; },
}));
const campaignItems = [{ id: 'cp1', endAt: '2099-01-01T00:00:00Z' }];
vi.mock('@tubutree/app-core/api/campaign', () => ({
  fetchCampaigns: async (_http: unknown, placement: string) => {
    campaignPlacements.push(placement);
    if (failAll || failCampaigns) throw new Error('x');
    return campaignList ?? campaignItems;
  },
}));
vi.mock('@tubutree/app-core/api/catalog', () => ({
  fetchBrands: async () => { if (failAll) throw new Error('x'); return []; },
  fetchCategories: async () => { if (failAll) throw new Error('x'); return []; },
  fetchProducts: async (_http: unknown, query: Record<string, unknown>) => {
    productCalls.push(query);
    if (failAll) throw new Error('x');
    return { data: [], meta: { page: 1, limit: 12, total: 0 } };
  },
}));
vi.mock('@tubutree/app-core/queries/config', () => ({ publicConfigQuery: () => ({ queryFn: async () => { if (failAll) throw new Error('x'); return { freeshipThreshold: 350000 }; } }) }));
vi.mock('@tubutree/app-core/queries/home', () => ({ homeBestSellerQuery: () => ({ queryFn: async () => { if (failAll) throw new Error('x'); return bestSellerRows; } }) }));

import { BUILD_GAP_REVALIDATE_S, CAMPAIGN_REVALIDATE_S, FLASH_REVALIDATE_S, loadHomeInitial } from './home-initial';

afterEach(() => {
  productCalls.length = 0;
  revalidates.length = 0;
  failAll = false;
  failFlash = false;
  failCampaigns = false;
  campaignList = null;
  campaignPlacements.length = 0;
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

  it('lỗi riêng phần Giờ vàng thì bỏ phần đó, các phần khác vẫn có', async () => {
    failFlash = true;
    const initial = await loadHomeInitial();
    expect(initial.flash).toBeUndefined();
    expect(initial.bestSellers).toEqual(bestSellerRows);
    expect(initial.categories).toEqual([]);
  });

  it('bỏ suất đã hết giờ khỏi bản dựng sẵn (trang ISR có thể cũ) để khối không hiện giá hết hạn rồi biến mất', async () => {
    flashList = [
      { itemId: 'old', endAt: '2000-01-01T00:00:00Z' },
      { itemId: 'live', endAt: '2099-01-01T00:00:00Z' },
    ];
    expect((await loadHomeInitial()).flash).toEqual([flashList[1]]);
  });
});

describe('loadHomeInitial: trang 1 của Gợi ý hôm nay', () => {
  it('xin trang 1 kèm hạt giống ngày VN và trả hạt giống đó để client dùng đúng khoá dữ liệu dựng sẵn', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T18:00:00Z'));
    try {
      const initial = await loadHomeInitial();
      expect(productCalls).toEqual([expect.objectContaining({ page: 1, seed: '20261101' })]);
      expect(initial.suggestSeed).toBe('20261101');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('loadHomeInitial: banner chiến dịch có trong HTML đầu', () => {
  it('xin banner HOME_TOP phía máy chủ với hạn ngắn để banner không chen vào sau hydrate làm cả trang nhảy', async () => {
    const initial = await loadHomeInitial();
    expect(initial.campaigns).toEqual(campaignItems);
    expect(campaignPlacements).toEqual(['HOME_TOP']);
    expect(revalidates).toContain(CAMPAIGN_REVALIDATE_S);
  });

  it('lỗi riêng phần banner thì bỏ phần đó, các phần khác vẫn có', async () => {
    failCampaigns = true;
    const initial = await loadHomeInitial();
    expect(initial.campaigns).toBeUndefined();
    expect(initial.bestSellers).toEqual(bestSellerRows);
  });

  it('bỏ chiến dịch đã hết hạn khỏi bản dựng sẵn (trang ISR có thể cũ): khối không hiện rồi biến mất', async () => {
    campaignList = [
      { id: 'old', endAt: '2000-01-01T00:00:00Z' },
      { id: 'live', endAt: '2099-01-01T00:00:00Z' },
    ];
    expect((await loadHomeInitial()).campaigns).toEqual([campaignList[1]]);
  });

  it('không có chiến dịch nào thì trả mảng rỗng (khác undefined: server đã hỏi và không có banner)', async () => {
    campaignList = [];
    expect((await loadHomeInitial()).campaigns).toEqual([]);
  });

  it('next build khi chỉ banner thiếu: vẫn thêm lệnh hạn ngắn để trang làm mới sớm', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    failCampaigns = true;
    await loadHomeInitial();
    expect(revalidates).toContain(BUILD_GAP_REVALIDATE_S);
  });
});
