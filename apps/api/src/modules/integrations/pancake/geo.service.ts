import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PancakeClient } from './pancake.client';
import { isNewGeoCode } from './geo-code';

/**
 * ok = phường thuộc tỉnh theo danh mục Pancake; invalid = mã cũ (trước sắp xếp địa giới 2025) / tỉnh không có /
 * phường không thuộc tỉnh; unknown = chưa đối chiếu được (Pancake lỗi/chưa cấu hình) → nơi gọi cho qua.
 */
export type WardCheck = 'ok' | 'invalid' | 'unknown';

/** DTO địa giới rút gọn cho FE. `code` = mã gửi Pancake khi đặt đơn. */
export interface GeoOption {
  code: string;
  name: string;
}

type CacheEntry = { at: number; data: GeoOption[] };

const PROVINCES_UNAVAILABLE = 'Chưa tải được danh sách tỉnh/thành, vui lòng thử lại sau ít phút.';
const COMMUNES_UNAVAILABLE = 'Chưa tải được danh sách phường/xã, vui lòng thử lại sau ít phút.';

/**
 * Tra cứu địa giới (Tỉnh → Phường/Xã) PROXY từ Pancake, cache in-memory.
 * Location gần như tĩnh → cache lâu (24h) để FE mở form địa chỉ không gọi Pancake mỗi lần.
 * Trả mã ĐÚNG hệ Pancake ("84_VN*") nên đặt đơn không lỗi location.
 *
 * Chỉ cache danh sách CÓ dữ liệu: một lần Pancake trả rỗng/lỗi mà bị cache 24h là cả ngày không ai tạo được
 * địa chỉ (nên không đặt được đơn đầu). Hết hạn mà lần làm mới lỗi thì phục vụ tiếp bản tốt gần nhất.
 */
@Injectable()
export class GeoService {
  private static readonly TTL_MS = 24 * 60 * 60 * 1000;
  private readonly logger = new Logger(GeoService.name);
  private provincesCache: CacheEntry | null = null;
  private provincesInflight: Promise<GeoOption[]> | null = null;
  private readonly communesCache = new Map<string, CacheEntry>();
  // Dedup request đang bay cùng tham số → cold cache không bắn N lần lên Pancake (thundering herd).
  private readonly communesInflight = new Map<string, Promise<GeoOption[]>>();

  constructor(private readonly pancake: PancakeClient) {}

  async provinces(): Promise<GeoOption[]> {
    if (this.provincesCache && Date.now() - this.provincesCache.at < GeoService.TTL_MS) {
      return this.provincesCache.data;
    }
    if (this.provincesInflight) return this.provincesInflight;
    this.provincesInflight = this.refresh(
      'tỉnh/thành',
      async () => {
        const list = await this.pancake.fetchProvinces();
        // Dùng new_id (hệ 2 cấp) làm code; bỏ tỉnh thiếu new_id.
        const withNewId = list.filter((p) => p.new_id);
        if (withNewId.length < list.length) {
          this.logger.warn(
            `Bỏ ${list.length - withNewId.length}/${list.length} tỉnh thiếu new_id (Pancake geo) — sẽ không hiện trong picker.`,
          );
        }
        return withNewId.map((p) => ({ code: p.new_id as string, name: p.name }));
      },
      this.provincesCache,
      (entry) => {
        this.provincesCache = entry;
      },
      PROVINCES_UNAVAILABLE,
    ).finally(() => {
      this.provincesInflight = null;
    });
    return this.provincesInflight;
  }

  async communes(provinceCode: string): Promise<GeoOption[]> {
    // Endpoint công khai: chỉ nhận mã có trong danh sách tỉnh (đã cache 24h) để số ô cache và số lượt gọi Pancake
    // bị chặn trên bằng số tỉnh, không phụ thuộc vào chuỗi người gọi gửi.
    const known = await this.provinces();
    if (!known.some((p) => p.code === provinceCode)) throw new BadRequestException('provinceCode không hợp lệ.');
    const cached = this.communesCache.get(provinceCode);
    if (cached && Date.now() - cached.at < GeoService.TTL_MS) return cached.data;
    const inflight = this.communesInflight.get(provinceCode);
    if (inflight) return inflight;
    const p = this.refresh(
      `phường/xã của ${provinceCode}`,
      async () => (await this.pancake.fetchCommunes(provinceCode)).map((c) => ({ code: c.id, name: c.name })),
      cached ?? null,
      (entry) => this.communesCache.set(provinceCode, entry),
      COMMUNES_UNAVAILABLE,
    ).finally(() => {
      this.communesInflight.delete(provinceCode);
    });
    this.communesInflight.set(provinceCode, p);
    return p;
  }

  async checkWard(provinceCode: string | null | undefined, wardCode: string | null | undefined): Promise<WardCheck> {
    if (!isNewGeoCode(provinceCode) || !wardCode?.trim() || wardCode === '00') return 'invalid';
    if (!this.pancake.isConfigured()) return 'unknown';
    let communes: GeoOption[];
    try {
      communes = await this.communes(provinceCode as string);
    } catch (err) {
      if (err instanceof BadRequestException) return 'invalid';
      this.logger.warn(`Chưa đối chiếu được phường ${wardCode} / tỉnh ${provinceCode}: ${err instanceof Error ? err.message : err}`);
      return 'unknown';
    }
    return communes.some((c) => c.code === wardCode) ? 'ok' : 'invalid';
  }

  private async refresh(
    what: string,
    load: () => Promise<GeoOption[]>,
    stale: CacheEntry | null,
    store: (entry: CacheEntry) => void,
    unavailable: string,
  ): Promise<GeoOption[]> {
    let reason: string;
    try {
      const data = (await load()).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      if (data.length > 0) {
        store({ at: Date.now(), data });
        return data;
      }
      reason = 'danh sách rỗng';
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
    if (stale) {
      this.logger.warn(`Làm mới ${what} từ Pancake lỗi (${reason}) — dùng tiếp bản đã cache.`);
      return stale.data;
    }
    this.logger.error(`Không tải được ${what} từ Pancake: ${reason}`);
    throw new ServiceUnavailableException(unavailable);
  }
}
