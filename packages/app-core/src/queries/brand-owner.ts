import type { HttpClient } from '../http';
import { errorStatus } from '../api/error-status';
import { getOwnedBrand, getOwnedBrandSales, type BrandSalesPeriod } from '../api/brand-owner';

export const ownedBrandQuery = (http: HttpClient) => ({
  queryKey: ['owned-brand'] as const,
  queryFn: () => getOwnedBrand(http),
});
// Khoá riêng cho menu hồ sơ: 404 nghĩa là không sở hữu nhãn (bình thường), còn màn quản lý nhãn coi 404 là "chưa có nhãn".
export const ownedBrandProfileQuery = (http: HttpClient) => ({
  queryKey: ['owned-brand', 'profile'] as const,
  queryFn: () =>
    getOwnedBrand(http).catch((e: unknown) => {
      if (errorStatus(e) === 404) return null;
      throw e;
    }),
});
// Cờ ownsBrand trên /auth/me: null = API cũ chưa có cờ (react-query cấm trả undefined), người gọi giữ cách cũ.
export const ownsBrandQuery = (http: HttpClient) => ({
  queryKey: ['auth-me', 'owns-brand'] as const,
  queryFn: async (): Promise<boolean | null> => {
    const me = await http.get<{ ownsBrand?: boolean }>('/auth/me');
    return me.ownsBrand ?? null;
  },
});
export const ownedBrandSalesQuery = (http: HttpClient, period: BrandSalesPeriod) => ({
  queryKey: ['owned-brand-sales', period] as const,
  queryFn: () => getOwnedBrandSales(http, period),
});
