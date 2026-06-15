import { Injectable } from '@nestjs/common';
import { PancakeClient } from './pancake.client';

/** DTO địa giới rút gọn cho FE. `code` = mã gửi Pancake khi đặt đơn. */
export interface GeoOption {
  code: string;
  name: string;
}

/**
 * Tra cứu địa giới (Tỉnh → Phường/Xã) PROXY từ Pancake, cache in-memory.
 * Location gần như tĩnh → cache lâu (24h) để FE mở form địa chỉ không gọi Pancake mỗi lần.
 * Trả mã ĐÚNG hệ Pancake ("84_VN*") nên đặt đơn không lỗi location.
 */
@Injectable()
export class GeoService {
  private static readonly TTL_MS = 24 * 60 * 60 * 1000;
  private provincesCache: { at: number; data: GeoOption[] } | null = null;
  private provincesInflight: Promise<GeoOption[]> | null = null;
  private readonly communesCache = new Map<string, { at: number; data: GeoOption[] }>();
  // Dedup request đang bay cùng tham số → cold cache không bắn N lần lên Pancake (thundering herd).
  private readonly communesInflight = new Map<string, Promise<GeoOption[]>>();

  constructor(private readonly pancake: PancakeClient) {}

  async provinces(): Promise<GeoOption[]> {
    if (this.provincesCache && Date.now() - this.provincesCache.at < GeoService.TTL_MS) {
      return this.provincesCache.data;
    }
    if (this.provincesInflight) return this.provincesInflight;
    this.provincesInflight = (async () => {
      const list = await this.pancake.fetchProvinces();
      const data = list
        // Dùng new_id (hệ 2 cấp) làm code; bỏ tỉnh thiếu new_id.
        .filter((p) => p.new_id)
        .map((p) => ({ code: p.new_id as string, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      this.provincesCache = { at: Date.now(), data };
      return data;
    })().finally(() => {
      this.provincesInflight = null;
    });
    return this.provincesInflight;
  }

  async communes(provinceCode: string): Promise<GeoOption[]> {
    const cached = this.communesCache.get(provinceCode);
    if (cached && Date.now() - cached.at < GeoService.TTL_MS) return cached.data;
    const inflight = this.communesInflight.get(provinceCode);
    if (inflight) return inflight;
    const p = (async () => {
      const list = await this.pancake.fetchCommunes(provinceCode);
      const data = list
        .map((c) => ({ code: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      this.communesCache.set(provinceCode, { at: Date.now(), data });
      return data;
    })().finally(() => {
      this.communesInflight.delete(provinceCode);
    });
    this.communesInflight.set(provinceCode, p);
    return p;
  }
}
