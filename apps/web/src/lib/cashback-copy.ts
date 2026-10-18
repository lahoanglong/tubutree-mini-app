import type { CashbackStatus } from '@tubutree/app-core/api/cashback';
import type { BadgeTone } from '@/components/ui/badge';

export const CASHBACK_TXN_META: Record<CashbackStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  CONFIRMED: { label: 'Đã duyệt', tone: 'success' },
  PAID: { label: 'Đã hoàn vào Ví', tone: 'neutral' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};

/** Tỉ lệ hoàn tiền: DB lưu phân số (0.035) nên nhân 100; một chữ số thập phân là đủ, số tròn bỏ phần lẻ. Cùng kết quả với Mini App. */
export function formatRatePct(rate: number | string | null | undefined): string {
  const v = Number(rate ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '0%';
  const pct = v * 100;
  return `${pct.toFixed(1).replace(/\.0$/, '').replace('.', ',')}%`;
}
