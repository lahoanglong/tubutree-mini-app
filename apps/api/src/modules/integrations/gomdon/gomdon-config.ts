import type { SystemConfigService } from '../../system-config/system-config.service';
import type { GomdonConfig, GomdonWarehouseConfig } from './gomdon.types';

/** Cấu hình KHÔNG bí mật (kho lấy hàng, cân nặng mặc định). Admin sửa ở tab Cấu hình. */
export const GOMDON_CONFIG_KEY = 'shipping.gomdon.config';
/** Công tắc admin bật/tắt lựa chọn "gửi lại vật liệu tái chế" ở checkout (mặc định TẮT). */
export const GOMDON_RECYCLING_TOGGLE_KEY = 'shipping.gomdon.recycling_enabled';

/**
 * Base URL production của Gomdon (tài liệu: mọi API nằm dưới https://admin.gomdon.com.vn/api/v2/...) — chỉ
 * dùng mặc định khi NODE_ENV=production. Tài liệu KHÔNG có môi trường sandbox/test riêng: GOMDON_BASE_URL
 * chỉ để trỏ sang môi trường Gomdon cấp riêng (nếu có) — không có URL thử nào an toàn để đặt sẵn.
 */
export const GOMDON_PRODUCTION_BASE_URL = 'https://admin.gomdon.com.vn';

export const DEFAULT_GOMDON_WAREHOUSE: GomdonWarehouseConfig = {
  name: 'Fuwa3e Tubu HCM',
  phone: '0965573541',
  address: 'Golf Park, 1 đường số 2',
  ward: 'Phường Long Bình',
  district: 'Thành phố Thủ Đức',
  province: 'Thành phố Hồ Chí Minh',
};

export const DEFAULT_GOMDON_WEIGHT_FALLBACK = 500;

type RawGomdonConfig = Partial<{
  phone: string;
  password: string;
  defaultWarehouse: Partial<GomdonWarehouseConfig>;
  defaultWeightFallback: number;
}>;

/**
 * Base URL Gomdon. Cố ý KHÔNG mặc định trỏ production ở dev/test: có tài khoản thật trong .env máy
 * dev là mỗi lần thử checkout lại đặt bưu tá BestExpress thật tới kho. Dev muốn thử thì tự đặt
 * GOMDON_BASE_URL rõ ràng. Production không đặt → dùng URL production.
 */
export function resolveGomdonBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.GOMDON_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return env.NODE_ENV === 'production' ? GOMDON_PRODUCTION_BASE_URL : '';
}

/**
 * Gộp cấu hình Gomdon. Tài khoản (phone/password) ưu tiên ENV (GOMDON_PHONE/GOMDON_PASSWORD) —
 * để mật khẩu KHÔNG phải nằm trong SystemConfig (hiện nguyên văn ở GET /admin/config và lịch sử
 * config). Giữ fallback đọc phone/password từ SystemConfig cho tương thích bản WIP cũ.
 */
export async function loadGomdonConfig(
  systemConfig: Pick<SystemConfigService, 'get'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GomdonConfig> {
  const raw = (await systemConfig.get<RawGomdonConfig | null>(GOMDON_CONFIG_KEY, {})) ?? {};
  const fallback = Number(raw.defaultWeightFallback);
  return {
    baseUrl: resolveGomdonBaseUrl(env),
    phone: env.GOMDON_PHONE?.trim() || raw.phone?.trim() || '',
    password: env.GOMDON_PASSWORD?.trim() || raw.password?.trim() || '',
    defaultWarehouse: { ...DEFAULT_GOMDON_WAREHOUSE, ...(raw.defaultWarehouse ?? {}) },
    defaultWeightFallback: Number.isFinite(fallback) && fallback > 0 ? fallback : DEFAULT_GOMDON_WEIGHT_FALLBACK,
  };
}

export function hasGomdonCredentials(cfg: Pick<GomdonConfig, 'baseUrl' | 'phone' | 'password'>): boolean {
  return Boolean(cfg.baseUrl && cfg.phone && cfg.password);
}

/**
 * Cờ tính năng cho checkout: CHỈ bật khi Gomdon đã cấu hình đủ VÀ admin bật công tắc
 * (=== true: config là Json, chuỗi "false" vẫn truthy). Tắt thì FE ẩn lựa chọn và BE từ chối
 * hasRecyclingPickup=true — không hứa thu gom khi không có ai đi thu.
 */
export async function isGomdonRecyclingEnabled(
  systemConfig: Pick<SystemConfigService, 'get'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const toggle = await systemConfig.get<unknown>(GOMDON_RECYCLING_TOGGLE_KEY, false);
  if (toggle !== true) return false;
  return hasGomdonCredentials(await loadGomdonConfig(systemConfig, env));
}
