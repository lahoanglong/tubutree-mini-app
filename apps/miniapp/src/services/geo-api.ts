import { api } from './api';

/** Địa giới (proxy Pancake). `code` = mã gửi khi đặt đơn (hệ "84_VN*"). */
export interface GeoOption {
  code: string;
  name: string;
}

export const getProvinces = () => api.get<GeoOption[]>('/geo/provinces').then((r) => r.data);

export const getCommunes = (provinceCode: string) =>
  api.get<GeoOption[]>('/geo/communes', { params: { provinceCode } }).then((r) => r.data);
