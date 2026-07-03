import { haversineMeters } from './geo.util';
import { ipMatch } from './ip.util';

export interface AttnConfig {
  officeIps: string[];
  lat: number | null;
  lng: number | null;
  radiusM: number;
  enforceIp: boolean;
}

export type VerifyReason = 'NOT_CONFIGURED' | 'IP_NOT_ALLOWED' | 'OUT_OF_RADIUS';
export type VerifyResult = { ok: true; distanceM: number } | { ok: false; reason: VerifyReason };

/**
 * Xác minh nhân viên đang ở công ty: cần đúng IP nội bộ (nếu bật) + trong bán kính GPS.
 * Fail-closed: thiếu cả IP allowlist lẫn toạ độ → NOT_CONFIGURED (không cho checkin).
 */
export function verifyPresence(cfg: AttnConfig, ip: string, lat: number, lng: number): VerifyResult {
  const gpsConfigured = cfg.lat !== null && cfg.lng !== null;
  const ipActive = cfg.enforceIp && cfg.officeIps.length > 0;
  if (!gpsConfigured && !ipActive) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (ipActive && !ipMatch(ip, cfg.officeIps)) return { ok: false, reason: 'IP_NOT_ALLOWED' };
  if (gpsConfigured) {
    const d = haversineMeters(cfg.lat as number, cfg.lng as number, lat, lng);
    if (d > cfg.radiusM) return { ok: false, reason: 'OUT_OF_RADIUS' };
    return { ok: true, distanceM: Math.round(d) };
  }
  return { ok: true, distanceM: 0 };
}
