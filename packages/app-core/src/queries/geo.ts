import type { HttpClient } from '../http';
import { getCommunes, getProvinces } from '../api/geo';

/** Hai trang Mini App đang dùng khoá khác nhau cho tỉnh (`geo-provinces` ở bộ chọn địa chỉ, `['geo','provinces']` ở form Đổi rác); đây là khoá của bộ chọn địa chỉ. */
export const provincesQuery = (http: HttpClient) => ({ queryKey: ['geo-provinces'] as const, queryFn: () => getProvinces(http) });
export const communesQuery = (http: HttpClient, provinceCode: string) => ({
  queryKey: ['geo-communes', provinceCode] as const,
  queryFn: () => getCommunes(http, provinceCode),
});
