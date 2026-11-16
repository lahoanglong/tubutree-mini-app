import {
  GIFT_ATTACH_MIN_NET_GOODS_VND,
  RECYCLE_FUNNEL_STEPS,
  type LaunchWatchFraud,
  type LaunchWatchFunnelRow,
  type LaunchWatchWindow,
  type RecycleFunnelStep,
} from '@tubutree/shared-types';
import { formatDateTime } from '@/lib/format-date';

export const WINDOW_OPTIONS: ReadonlyArray<{ key: LaunchWatchWindow; label: string }> = [
  { key: 'h72', label: '72 giờ' },
  { key: 'd7', label: '7 ngày' },
  { key: 'd30', label: '30 ngày' },
];

/** Nhãn từng bước phễu; khai đủ mọi bước của `RECYCLE_FUNNEL_STEPS` (Record ép compiler báo khi thêm bước mới). */
export const STEP_LABELS: Record<RecycleFunnelStep, string> = {
  enter: 'Vào màn Đổi rác',
  phone_saved: 'Đã lưu số điện thoại',
  geo_granted: 'Cho phép vị trí',
  geo_denied: 'Từ chối vị trí',
  submitted: 'Đã gửi yêu cầu',
  fee_short_shown: 'Thấy thông báo thiếu phí',
  fee_path_attach: 'Chọn gắn vào đơn mua',
  fee_path_wallet: 'Chọn trả bằng Ví',
  fee_path_bank: 'Chọn chuyển khoản',
  fee_path_dropoff: 'Chọn mang tới điểm nhận',
  second_order_shown: 'Thấy gợi ý đặt đơn thứ hai',
  second_order_click: 'Bấm gợi ý đặt đơn thứ hai',
};

export const stepLabel = (step: string): string => (STEP_LABELS as Record<string, string>)[step] ?? step;

/** Số nguyên có dấu chấm ngăn nghìn ("1.234"), tự ghép để không phụ thuộc ICU của trình duyệt. */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "42,9%" (một chữ số thập phân, dấu phẩy, bỏ ",0"); null thì "—". */
export function formatPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  return `${String(Math.round(pct * 10) / 10).replace('.', ',')}%`;
}

/** Tỉ lệ phần trăm một chữ số thập phân; null khi mẫu số là 0. */
export function ratioPct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((1000 * part) / whole) / 10 : null;
}

/** Mỗi bước kèm % khách khác nhau so với bước "Vào màn Đổi rác" (cột Tổng); null khi chưa ai vào màn. */
export function funnelWithPct(rows: readonly LaunchWatchFunnelRow[]): Array<LaunchWatchFunnelRow & { label: string; pctOfEnter: number | null }> {
  const enter = rows.find((r) => r.step === 'enter')?.total ?? 0;
  const byStep = new Map(rows.map((r) => [r.step, r]));
  return RECYCLE_FUNNEL_STEPS.map((step) => {
    const r = byStep.get(step) ?? { step, web: 0, miniapp: 0, total: 0 };
    return { ...r, label: STEP_LABELS[step], pctOfEnter: ratioPct(r.total, enter) };
  });
}

export type AlertLevel = 'ok' | 'amber' | 'red';
export type FraudMetric = 'giftOrdersOverOne' | 'giftOrdersBelowMin' | 'giftMaxPerAccount';

export interface FraudAlert {
  metric: FraudMetric;
  level: 'amber' | 'red';
  message: string;
}

/** Từ ngần này quà 0đ trên một tài khoản trong cửa sổ thì báo vàng (luật không cấm, nhưng đáng xem có lập nhiều tài khoản không). */
export const GIFT_PER_ACCOUNT_AMBER_AT = 3;

/**
 * Chỉ số vi phạm một điều bất biến (luật gắn quà 0đ của W179) báo ĐỎ; chỉ số bất thường nhưng chưa vi phạm luật báo VÀNG.
 * Trả danh sách rỗng khi mọi thứ đúng kỳ vọng.
 */
export function fraudAlerts(fraud: LaunchWatchFraud): FraudAlert[] {
  const out: FraudAlert[] = [];
  const { zeroGift } = fraud;
  if (zeroGift.ordersOverOne > 0) {
    out.push({
      metric: 'giftOrdersOverOne',
      level: 'red',
      message: `${formatCount(zeroGift.ordersOverOne)} đơn mang hơn 1 quà 0đ. Mỗi đơn chỉ được gắn tối đa 1 quà.`,
    });
  }
  if (zeroGift.ordersBelowMin > 0) {
    out.push({
      metric: 'giftOrdersBelowMin',
      level: 'red',
      message: `${formatCount(zeroGift.ordersBelowMin)} đơn gắn quà 0đ nhưng tiền hàng sau giảm dưới ${formatCount(GIFT_ATTACH_MIN_NET_GOODS_VND)}đ.`,
    });
  }
  if (zeroGift.maxPerAccount >= GIFT_PER_ACCOUNT_AMBER_AT) {
    out.push({
      metric: 'giftMaxPerAccount',
      level: 'amber',
      message: `Có tài khoản nhận ${formatCount(zeroGift.maxPerAccount)} quà 0đ trong cửa sổ này. Nên xem có phải một người lập nhiều tài khoản.`,
    });
  }
  return out;
}

export function metricLevel(alerts: readonly FraudAlert[], metric: FraudMetric): AlertLevel {
  return alerts.find((a) => a.metric === metric)?.level ?? 'ok';
}

/** "14:05" theo giờ Việt Nam; thiếu hoặc sai định dạng thì "—". */
export function formatUpdatedAt(iso: string | null | undefined): string {
  const t = formatDateTime(iso);
  return t === '—' ? t : t.slice(0, 5);
}
