import { VITAL_THRESHOLDS, VITAL_VIEWPORT_MAX, type VitalName, type VitalRating } from '@tubutree/shared-types';
import { apiFetch } from '../client-api';

/** Một dòng của `GET /admin/perf/vitals` (VitalsRow ở apps/api/src/modules/analytics/vitals/vitals-summary.service.ts). */
export interface ClientVitalsRow {
  platform: 'web' | 'miniapp';
  name: VitalName;
  /** Mẫu route; `*` là gộp mọi route của nhóm khung nhìn. */
  route: string;
  viewport: string;
  samples: number;
  p75: number;
  good: number;
  needsImprovement: number;
  poor: number;
  rating: VitalRating;
  enoughSamples: boolean;
}

export interface ClientVitalsSummary {
  days: 7 | 28;
  since: string;
  minSamples: number;
  rows: ClientVitalsRow[];
}

export const getClientVitals = (days: 7 | 28) => apiFetch<ClientVitalsSummary>(`/admin/perf/vitals?days=${days}`);

/** Thứ tự cột của bảng: năm số đo web rồi `READY` của Mini App. */
export const VITAL_COLUMNS: readonly VitalName[] = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB', 'READY'];

export const VITAL_LABELS: Record<VitalName, string> = {
  LCP: 'LCP',
  INP: 'INP',
  CLS: 'CLS',
  FCP: 'FCP',
  TTFB: 'TTFB',
  READY: 'Mở tới bấm được',
};

// Biên lấy từ cách API chia nhóm (`vitalViewport`), để nhãn không lệch khi đổi biên.
const VIEWPORT_LABELS: Record<string, string> = {
  s: `Điện thoại (≤ ${VITAL_VIEWPORT_MAX.s}px)`,
  m: `Máy tính bảng (≤ ${VITAL_VIEWPORT_MAX.m}px)`,
  l: `Máy tính (> ${VITAL_VIEWPORT_MAX.m}px)`,
};
export const viewportLabel = (vp: string) => VIEWPORT_LABELS[vp] ?? vp;

const nf = (digits: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** CLS không đơn vị, 2 số lẻ; dưới 1 giây ghi mili giây, từ 1 giây ghi giây 1 số lẻ (dấu phẩy thập phân). */
export function formatVital(name: VitalName, value: number): string {
  if (name === 'CLS') return nf(2).format(value);
  return value < 1000 ? `${Math.round(value)} ms` : `${nf(1).format(value / 1000)} s`;
}

/** Ngưỡng của số đo ghi bằng lời, cho dòng chú thích dưới bảng. */
export function thresholdText(name: VitalName): string {
  const [good, poor] = VITAL_THRESHOLDS[name];
  return `${VITAL_LABELS[name]}: tốt ≤ ${formatVital(name, good)}, kém > ${formatVital(name, poor)}`;
}

export interface ClientVitalsLine {
  key: string;
  platform: 'web' | 'miniapp';
  route: string;
  viewport: string;
  /** Số mẫu lớn nhất trong các số đo của dòng, để xếp route nhiều lượt xem lên trên. */
  samples: number;
  cells: Partial<Record<VitalName, ClientVitalsRow>>;
}

/**
 * Gom các dòng (nền tảng, route, khung nhìn, số đo) thành một dòng bảng cho mỗi (nền tảng, route, khung nhìn), mỗi số đo một ô. Web đứng trước Mini
 * App; trong mỗi nền tảng dòng gộp `*` của từng khung nhìn đứng trước, rồi tới route nhiều mẫu hơn.
 */
export function pivotClientVitals(rows: readonly ClientVitalsRow[]): ClientVitalsLine[] {
  const lines = new Map<string, ClientVitalsLine>();
  for (const r of rows) {
    const key = `${r.platform}|${r.route}|${r.viewport}`;
    const line = lines.get(key) ?? { key, platform: r.platform, route: r.route, viewport: r.viewport, samples: 0, cells: {} };
    line.cells[r.name] = r;
    line.samples = Math.max(line.samples, r.samples);
    lines.set(key, line);
  }
  const rank = (l: ClientVitalsLine) => [l.platform === 'web' ? 0 : 1, l.route === '*' ? 0 : 1] as const;
  return [...lines.values()].sort((a, b) => {
    const [pa, ra] = rank(a);
    const [pb, rb] = rank(b);
    return pa - pb || ra - rb || b.samples - a.samples || a.route.localeCompare(b.route) || a.viewport.localeCompare(b.viewport);
  });
}
