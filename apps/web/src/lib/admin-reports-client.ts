import { apiDownload, apiFetch } from './client-api';

export interface RevenueTotals {
  orders: number;
  cancelled: number;
  paidOrders: number;
  gross: number;
  partialRefund: number;
  revenue: number;
  gmv: number;
}

export interface RevenueReport {
  range: { from: string; to: string; days: number };
  basis: string;
  totals: RevenueTotals & { newUsers: number };
  byDay: (RevenueTotals & { day: string; channel: string; label: string })[];
  byChannel: (RevenueTotals & { key: string; label: string })[];
  byPlatform: (RevenueTotals & { key: string; label: string })[];
}

export interface ReportRange {
  from: string;
  to: string;
}

const rangeQuery = (r: ReportRange) => `from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`;

export const getRevenueReport = (r: ReportRange) => apiFetch<RevenueReport>(`/admin/reports/revenue?${rangeQuery(r)}`);

/** CSV theo dòng hàng của mọi đơn đặt trong khoảng ngày (giờ VN, cả hai đầu). */
export const downloadOrderItemsCsv = (r: ReportRange) =>
  apiDownload(`/admin/reports/order-items/export?${rangeQuery(r)}`, `dong-hang-${r.from}-${r.to}.csv`);
