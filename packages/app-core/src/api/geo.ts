import type { HttpClient } from '../http';

/** Địa giới (proxy Pancake). `code` = mã gửi khi đặt đơn (hệ "84_VN*"). */
export interface GeoOption {
  code: string;
  name: string;
}

export const getProvinces = (http: HttpClient) => http.get<GeoOption[]>('/geo/provinces');

export const getCommunes = (http: HttpClient, provinceCode: string) =>
  http.get<GeoOption[]>('/geo/communes', { query: { provinceCode } });
