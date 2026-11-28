import { afterEach, describe, expect, it, vi } from 'vitest';

const revalidates: (number | undefined)[] = [];
let failAll = false;
let failBest = false;
let failFlash = false;
let failCampaigns = false;
let failCombos = false;
let comboList: { id: string; endAt: string }[] | null = null;
const comboLimits: (number | undefined)[] = [];
let campaignList: { id: string; endAt: string }[] | null = null;
let flashList: { itemId: string; endAt: string }[] | null = null;
const productCalls: Record<string, unknown>[] = [];
let brandCalls = 0;
const campaignPlacements: string[] = [];

vi.mock('@/lib/core-http-server', () => ({
  createServerHttp: (init?: { revalidate?: number }) => {
    revalidates.push(init?.revalidate);
    return {
      get: async (path: string) => {
        if (failAll) throw new Error(`API ${path} không sẵn sàng`);
        if (path.startsWith('/products')) return { data: [], meta: { page: 1, limit: 12, total: 0 } };
        if (path.includes('/config/public')) return { freeshipThreshold: 350000 };
        if (path === '/flash-sales/active') {
          if (failFlash) throw new Error('x');
          return flashList ?? flashItems;
        }
        return [];
      },
    };
  },
}));
const flashItems = [{ itemId: 'i1', endAt: '2099-01-01T00:00:00Z' }];
const bestSellerRows = [{ id: 'b1' }];
const comboItems = [{ id: 'cb1', endAt: '2099-01-01T00:00:00Z' }];
vi.mock('@tubutree/app-core/api/bundle', () => ({
  HOME_COMBOS_LIMIT: 4,
  fetchHomeCombos: async (_http: unknown, limit?: number) => {
    comboLimits.push(limit);
    if (failAll || failCombos) throw new Error('x');
    return comboList ?? comboItems;
  },
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
  fetchBrands: async () => { brandCalls += 1; if (failAll) throw new Error('x'); return []; },
  fetchCategories: async () => { if (failAll) throw new Error('x'); return []; },
  fetchProducts: async (_http: unknown, query: Record<string, unknown>) => {
    productCalls.push(query);
    if (failAll) throw new Error('x');
    return { data: [], meta: { page: 1, limit: 12, total: 0 } };
  },
}));
vi.mock('@tubutree/app-core/queries/config', () => ({ publicConfigQuery: () => ({ queryFn: async () => { if (failAll) throw new Error('x'); return { freeshipThreshold: 350000 }; } }) }));
vi.mock('@tubutree/app-core/queries/home', () => ({ homeBestSellerQuery: () => ({ queryFn: async () => { if (failAll || failBest) throw new Error('x'); return bestSellerRows; } }) }));

import { BUILD_GAP_REVALIDATE_S, CAMPAIGN_REVALIDATE_S, COMBO_REVALIDATE_S, FLASH_REVALIDATE_S, loadHomeInitial } from './home-initial';

afterEach(() => {
  productCalls.length = 0;
  brandCalls = 0;
  revalidates.length = 0;
  failAll = false;
  failBest = false;
  failFlash = false;
  failCampaigns = false;
  failCombos = false;
  comboList = null;
  comboLimits.length = 0;
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

  it('runtime khi riêng Bán chạy lỗi (Danh mục vẫn về): không ném, bỏ phần Bán chạy để client tự tải lại', async () => {
    failBest = true;
    const initial = await loadHomeInitial();
    expect(initial.bestSellers).toBeUndefined();
    expect(initial.categories).toEqual([]);
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

describe('loadHomeInitial: lưới Gợi ý không tải ở máy chủ, thương hiệu có (W47)', () => {
  it('không xin trang 1 của lưới Gợi ý (HTML đầu không vẽ), chỉ trả hạt giống ngày VN; xin danh sách thương hiệu một lần để HTML đầu biết có vẽ thanh chip không', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T18:00:00Z'));
    try {
      const initial = await loadHomeInitial();
      expect(productCalls).toEqual([]);
      expect(brandCalls).toBe(1);
      expect(initial).not.toHaveProperty('suggest');
      expect(initial.brands).toEqual([]);
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

describe('loadHomeInitial: kệ combo có trong HTML đầu', () => {
  it('xin combo phía máy chủ với đúng số combo của kệ và hạn ngắn, để kệ không chen vào sau hydrate và Bán chạy nhất chống trùng được ngay lần vẽ đầu', async () => {
    const initial = await loadHomeInitial();
    expect(initial.combos).toEqual(comboItems);
    expect(comboLimits).toEqual([4]);
    expect(revalidates).toContain(COMBO_REVALIDATE_S);
  });

  it('lỗi riêng phần combo thì bỏ phần đó (client tự tải), các phần khác vẫn có', async () => {
    failCombos = true;
    const initial = await loadHomeInitial();
    expect(initial.combos).toBeUndefined();
    expect(initial.bestSellers).toEqual(bestSellerRows);
  });

  it('bỏ combo đã hết hạn khỏi bản dựng sẵn (trang ISR có thể cũ): kệ và món Bán chạy nhất không đổi sau hydrate', async () => {
    comboList = [
      { id: 'old', endAt: '2000-01-01T00:00:00Z' },
      { id: 'live', endAt: '2099-01-01T00:00:00Z' },
    ];
    expect((await loadHomeInitial()).combos).toEqual([comboList[1]]);
  });

  it('ghi lúc lấy combo (combosAt) để hydrate hỏi lại khi HTML ISR đã cũ; combo lỗi thì không có mốc', async () => {
    const before = Date.now();
    const initial = await loadHomeInitial();
    expect(initial.combosAt).toBeGreaterThanOrEqual(before);
    expect(initial.combosAt).toBeLessThanOrEqual(Date.now());
    failCombos = true;
    expect((await loadHomeInitial()).combosAt).toBeUndefined();
  });

  it('không có combo nào thì trả mảng rỗng (khác undefined: server đã hỏi và không có)', async () => {
    comboList = [];
    expect((await loadHomeInitial()).combos).toEqual([]);
  });

  it('next build khi chỉ combo thiếu: vẫn thêm lệnh hạn ngắn để trang làm mới sớm', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    failCombos = true;
    await loadHomeInitial();
    expect(revalidates).toContain(BUILD_GAP_REVALIDATE_S);
  });
});
