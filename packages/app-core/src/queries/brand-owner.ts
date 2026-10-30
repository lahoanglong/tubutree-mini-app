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
/**
 * Các cờ nhẹ trên /auth/me, một lần gọi cho cả Cá nhân. ownsBrand: null = API cũ chưa có cờ (react-query cấm trả undefined), người gọi
 * giữ cách cũ. hasDeskPoint: nhân viên điểm đối tác (thường mang vai CUSTOMER) có quầy để mở; API cũ thiếu cờ thì coi là false.
 */
export interface AuthMeFlags {
  ownsBrand: boolean | null;
  hasDeskPoint: boolean;
}
export const authMeFlagsQuery = (http: HttpClient) => ({
  queryKey: ['auth-me', 'flags'] as const,
  queryFn: async (): Promise<AuthMeFlags> => {
    const me = await http.get<{ ownsBrand?: boolean; hasDeskPoint?: boolean }>('/auth/me');
    return { ownsBrand: me.ownsBrand ?? null, hasDeskPoint: me.hasDeskPoint === true };
  },
});
export const ownsBrandQuery = (http: HttpClient) => ({ ...authMeFlagsQuery(http), select: (f: AuthMeFlags): boolean | null => f.ownsBrand });
export const hasDeskPointQuery = (http: HttpClient) => ({ ...authMeFlagsQuery(http), select: (f: AuthMeFlags): boolean => f.hasDeskPoint });
export const ownedBrandSalesQuery = (http: HttpClient, period: BrandSalesPeriod) => ({
  queryKey: ['owned-brand-sales', period] as const,
  queryFn: () => getOwnedBrandSales(http, period),
});
