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

export interface SourceTotals {
  newUsers: number;
  firstOrderUsers: number;
  secondOrderUsers: number;
  revenue: number;
}

export interface SourceReport {
  range: { from: string; to: string; days: number };
  windowDays: number;
  rows: (SourceTotals & { week: string; source: string; label: string; firstWindowClosed: boolean; secondWindowClosed: boolean })[];
  bySource: (SourceTotals & { source: string; label: string })[];
  totals: SourceTotals;
}

export type SourceReportBy = 'source' | 'campaign';

export const getSourceReport = (r: ReportRange, by: SourceReportBy = 'source') =>
  apiFetch<SourceReport>(`/admin/reports/sources?${rangeQuery(r)}${by === 'campaign' ? '&by=campaign' : ''}`);

export type PayoutExportStatus = 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED';
export type RefundExportStatus = 'OPEN' | 'UNVERIFIED' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'DISMISSED';

const withStatus = (r: ReportRange, status?: string) => `${rangeQuery(r)}${status ? `&status=${encodeURIComponent(status)}` : ''}`;

/** Khấu trừ TNCN của CTV theo người nhận, lệnh đã chi trong khoảng ngày chi. */
export const downloadPitCsv = (r: ReportRange) =>
  apiDownload(`/admin/reports/exports/tax?${rangeQuery(r)}`, `thue-tncn-ctv-${r.from}-${r.to}.csv`);

/** Lệnh rút tiền theo ngày yêu cầu. */
export const downloadPayoutsCsv = (r: ReportRange, status?: PayoutExportStatus) =>
  apiDownload(`/admin/reports/exports/payouts?${withStatus(r, status)}`, `lenh-rut-tien-${r.from}-${r.to}.csv`);

/** Khoản hoàn tiền khách theo ngày tạo khoản hoàn. */
export const downloadRefundsCsv = (r: ReportRange, status?: RefundExportStatus) =>
  apiDownload(`/admin/reports/exports/refunds?${withStatus(r, status)}`, `hoan-tien-khach-${r.from}-${r.to}.csv`);
