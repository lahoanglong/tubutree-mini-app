import type { NoelMetricsDTO, NoelRetentionGroup, NoelWindowDays } from '@tubutree/shared-types';
import { formatCount, formatPct } from '@/components/admin/launch-watch-format';

export const NOEL_WINDOWS: ReadonlyArray<{ days: NoelWindowDays; label: string }> = [
  { days: 1, label: '1 ngày' },
  { days: 7, label: '7 ngày' },
  { days: 14, label: '14 ngày' },
];

/** Tên các món trang trí, khớp xmasTreeCopy.names ở app-core. */
export const ORNAMENT_LABELS: Record<string, string> = {
  star: 'Ngôi sao đỉnh cây',
  lights: 'Dây đèn ấm',
  baubles: 'Quả châu đỏ',
  gifts: 'Hộp quà xanh',
  reindeer: 'Tuần lộc mini',
  wreath: 'Vòng nguyệt quế',
};

/** Tên game trong Sảnh Game (mùa thường), khớp `game.<id>.title` ở app-core. Game chưa khai ở đây hiện mã của nó. */
export const GAME_LABELS: Record<string, string> = {
  dew_catcher: 'Hứng Giọt Sương',
  refill_rush: 'Phân Loại Vỏ Chai Thần Tốc',
  eco_merge: 'Ghép Mầm Xanh',
  green_conveyor: 'Băng Chuyền Xanh',
  daily_quiz: 'Đố Xanh Mỗi Ngày',
  sort: 'Đúng Thùng',
  match: 'Ghép Cặp',
  origin: 'Đoán Xuất Xứ',
  basket: 'Giỏ Đúng Việc',
  kitchen_swap: 'Căn Bếp Xanh',
};
export const gameLabel = (game: string): string => GAME_LABELS[game] ?? game;
export const ornamentLabel = (slot: string): string => ORNAMENT_LABELS[slot] ?? slot;

/** Dưới ngần này cặp (khách, ngày) mỗi nhóm thì chưa nên kết luận. */
export const MIN_RETENTION_SAMPLE = 30;

/** 'YYYY-MM-DD' thành '14/12'. */
export function dayLabel(dayKey: string): string {
  return `${dayKey.slice(8, 10)}/${dayKey.slice(5, 7)}`;
}

export function rangeLabel(fromKey: string, toKey: string): string {
  return fromKey === toKey ? dayLabel(fromKey) : `${dayLabel(fromKey)} đến ${dayLabel(toKey)}`;
}

/** Số thập phân một chữ số, dấu phẩy ("412,3"); số nguyên bỏ ",0". */
export function formatDecimal(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

/** Điểm trung bình: arcade là điểm ("412,3"), game mini là đúng/tổng ("4,3/8"); chưa có ván là "—". */
export function formatAvgScore(avg: number | null, outOf: number | null): string {
  if (avg == null) return '—';
  return outOf == null ? formatDecimal(avg) : `${formatDecimal(avg)}/${formatDecimal(outOf)}`;
}

/** Chiều rộng thanh (%) so với giá trị lớn nhất; 0 khi không có gì. Tối thiểu 4% cho giá trị khác 0 để vẫn thấy. */
export function barPercent(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(4, Math.round((value / max) * 100));
}

/** Hiệu hai tỉ lệ (điểm phần trăm) kèm dấu; null khi một nhóm trống. */
export function retentionGap(noel: NoelRetentionGroup, other: NoelRetentionGroup): string | null {
  if (noel.ratePct == null || other.ratePct == null) return null;
  const gap = Math.round((noel.ratePct - other.ratePct) * 10) / 10;
  return `${gap > 0 ? '+' : gap < 0 ? '−' : ''}${formatDecimal(Math.abs(gap))} điểm phần trăm`;
}

export function retentionSampleSmall(r: NoelMetricsDTO['retention']): boolean {
  return Math.min(r.noel.userDays, r.other.userDays) < MIN_RETENTION_SAMPLE;
}

export interface EconomyAlert {
  level: 'red' | 'amber';
  message: string;
}

/** Tăng từ ngần này (%) so với khoảng trước và đủ lớn mới nhắc: tránh nhắc vì số nhỏ nhảy. */
const GROWTH_ALERT_PCT = 50;
const GROWTH_ALERT_MIN_BASE = 20;

/**
 * Soi thưởng game không phình ngoài ý: đỏ khi có số vượt trần (đáng lẽ không bao giờ, trần chặn bằng một UPDATE có điều kiện),
 * vàng khi giọt nước hoặc Điểm Xanh game mini tăng hơn một nửa so với khoảng liền trước.
 */
export function economyAlerts(e: NoelMetricsDTO['economy']): EconomyAlert[] {
  const out: EconomyAlert[] = [];
  const { caps, current: c, previous: p } = e;
  if (caps.miniWaterPerUserDay > 0 && c.maxUserWaterInDay > caps.miniWaterPerUserDay) {
    out.push({ level: 'red', message: `Có khách nhận ${formatCount(c.maxUserWaterInDay)} giọt nước game trong một ngày, vượt trần ${formatCount(caps.miniWaterPerUserDay)}.` });
  }
  if (caps.miniPointsPerUserDay > 0 && c.maxUserPointsInDay > caps.miniPointsPerUserDay) {
    out.push({ level: 'red', message: `Có khách nhận ${formatCount(c.maxUserPointsInDay)} Điểm Xanh game trong một ngày, vượt trần ${formatCount(caps.miniPointsPerUserDay)}.` });
  }
  if (caps.miniGlobalPointsPerDay > 0 && c.maxGlobalPointsInDay > caps.miniGlobalPointsPerDay) {
    out.push({ level: 'red', message: `Điểm Xanh game phát trong một ngày (${formatCount(c.maxGlobalPointsInDay)}) vượt ngân sách ngày ${formatCount(caps.miniGlobalPointsPerDay)}.` });
  }
  const grew = (now: number, before: number) => before >= GROWTH_ALERT_MIN_BASE && (now - before) * 100 >= before * GROWTH_ALERT_PCT;
  if (grew(c.miniWater, p.miniWater)) {
    out.push({ level: 'amber', message: `Giọt nước phát từ game mini tăng ${formatCount(Math.round(((c.miniWater - p.miniWater) * 100) / p.miniWater))}% so với khoảng trước (${formatCount(p.miniWater)} thành ${formatCount(c.miniWater)}).` });
  }
  if (grew(c.miniPoints, p.miniPoints)) {
    out.push({ level: 'amber', message: `Điểm Xanh phát từ game mini tăng ${formatCount(Math.round(((c.miniPoints - p.miniPoints) * 100) / p.miniPoints))}% so với khoảng trước (${formatCount(p.miniPoints)} thành ${formatCount(c.miniPoints)}).` });
  }
  return out;
}

export { formatCount, formatPct };
