'use client';

import { apiFetch } from './client-api';

/** Địa giới (proxy Pancake). `code` = mã gửi khi đặt đơn (hệ "84_VN*"). */
export interface GeoOption {
  code: string;
  name: string;
}

export const getProvinces = () => apiFetch<GeoOption[]>('/geo/provinces');

export const getCommunes = (provinceCode: string) =>
  apiFetch<GeoOption[]>(`/geo/communes?provinceCode=${encodeURIComponent(provinceCode)}`);
