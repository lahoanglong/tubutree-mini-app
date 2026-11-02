import type { Page } from '@playwright/test';
import type { MockApi } from './mock-api';
import { CTV_TIERS } from './affiliate-mocks';

/** Gian hàng CTV mẫu cho các spec web của trình dựng (`/ctv/gian-hang`): mọi lời gọi /api/** từ trình duyệt đi qua mock. Dùng chung cho builder-polish và a11y-shop. */
const USER = { id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER', pointsBalance: 0, walletBalance: 0 };
const product = (n: number) => ({ id: `p${n}`, name: `Sản phẩm số ${n}`, slug: `sp-${n}`, brand: 'Tubu', basePrice: 120_000, salePrice: null, thumbnail: null, repVariationId: `v${n}`, inStock: true });

export interface BuilderMockOptions {
  /** Khối `c1` là Combo (3 món, giảm 10%): chi tiết khối có ô `%` và nút "Lưu" đang tắt (chưa đổi số). Mặc định khối thường 4 món. */
  combo?: boolean;
  /** Bậc của chủ shop (`GET /affiliate/tiers`); mặc định Tân binh (bậc thấp nhất, không huy hiệu ở đầu xem trước). */
  tier?: 'Tân binh' | 'Đồng' | 'Kim Cương';
  /** Tên gian hàng; mặc định "Cửa hàng Xanh". */
  title?: string;
  /** Admin đã duyệt gian hàng: đầu xem trước có tick và "CTV tuyển chọn". Mặc định chưa duyệt. */
  approved?: boolean;
}

export function mockBuilder(api: MockApi, { combo = false, tier = 'Tân binh', title = 'Cửa hàng Xanh', approved = false }: BuilderMockOptions = {}): void {
  const items = (combo ? [1, 2, 3] : [1, 2, 3, 4]).map((n, k) => ({ id: `i${n}`, productId: `p${n}`, note: null, isPinned: false, isHidden: false, hiddenReason: null, sortOrder: k, product: product(n) }));
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
  api.get('/affiliate/me', { isAffiliate: true, canRegister: true, canOpenStorefront: true, referralCode: 'AN123', walletBalance: 0 });
  const current = CTV_TIERS.allTiers.find((t) => t.name === tier)!;
  api.get('/affiliate/tiers', { ...CTV_TIERS, tier: { name: current.name, emoji: current.emoji } });
  api.get('/storefront/me', {
    id: 'sf1', slug: 'shop-aff-1', type: 'CTV', title, headerNote: null, avatarUrl: null, coverUrl: null, theme: 'default', themeColor: null,
    subdomain: null, isPublished: true, status: 'LIVE', approved, referralCode: 'AN123', subdomainEnabled: false, publicHiddenReason: null,
    collections: [{
      id: 'c1', title: combo ? 'Combo thử' : 'Bộ sưu tập A', kind: combo ? 'COMBO' : 'NORMAL', layout: combo ? 'GRID' : 'CAROUSEL', comboDiscountPct: combo ? 10 : null, sortOrder: 0,
      items,
    }],
  });
  api.get('/categories', []);
  api.get('/storefront/me/products', []);
  api.get('/storefront/me/stats', { orders7d: 0, orders30d: 0, revenue30d: 0, commission30d: 0, byProduct: [] });
  api.get('/storefront/me/quests', { quests: [], totalEarnedPoints: 0, level: 0, levelMax: 5 });
  api.get('/me/wishlist/ids', []);
  api.get('/flash-sales/active', []);
  api.get('/cart', { items: [], total: 0 });
}

/** Đặt cờ phiên khôi phục của web trước khi trang chạy (không có localStorage thì spec vẫn chạy, chỉ không có phiên). */
export async function setBuilderSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_web_session', '1');
    } catch {
      // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
    }
  });
}
