import type { HttpClient } from '../http';

export type PayrollStatus = 'OPEN' | 'FINALIZED' | 'PAID';

export interface StaffProfile {
  hourlyRate: number;
  bankBin: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  qrImageUrl: string | null;
  active: boolean;
}

export interface PayrollDay {
  id: string;
  workDate: string;
  workedMinutes: number;
  hourlyRate: number;
  gross: number;
  fines: number;
  net: number;
}

export interface PayrollMonth {
  year: number;
  month: number;
  totalMinutes: number;
  gross: number;
  totalFines: number;
  net: number;
  status: PayrollStatus;
  paidAt: string | null;
  proofImageUrl: string | null;
  note: string | null;
}

export interface MyPayroll {
  month: PayrollMonth;
  days: PayrollDay[];
  profile: StaffProfile | null;
}

export interface AdminPayrollRow {
  staff: { id: string; fullName: string | null; phone: string | null };
  month: PayrollMonth;
  profile: StaffProfile | null;
  qrImageUrl: string | null;
}

export interface BankInput {
  bankBin?: string;
  bankAccountNo?: string;
  bankAccountName?: string;
  qrImageUrl?: string;
}

// ── Self ──
export const getMyPayroll = (http: HttpClient, year: number, month: number) =>
  http.get<MyPayroll>('/staff/payroll', { query: { year, month } });

export const updateBank = (http: HttpClient, dto: BankInput) =>
  http.put<StaffProfile>('/staff/bank', dto);

export interface SessionHistoryRow {
  id: string;
  shiftId: string;
  checkinAt: string;
  checkoutAt: string | null;
  isLate: boolean;
  closeReason: string | null;
}

export interface StaffMonthDetail {
  month: PayrollMonth;
  days: PayrollDay[];
  profile: StaffProfile | null;
  sessions: SessionHistoryRow[];
}

// ── Admin ──
export const adminGetPayroll = (http: HttpClient, year: number, month: number) =>
  http.get<AdminPayrollRow[]>('/admin/payroll', { query: { year, month } });

export const adminGetDetail = (http: HttpClient, staffId: string, year: number, month: number) =>
  http.get<StaffMonthDetail>(`/admin/payroll/${staffId}/detail`, { query: { year, month } });

export const setRate = (http: HttpClient, userId: string, hourlyRate: number) =>
  http.put<StaffProfile>(`/admin/staff/${userId}/rate`, { hourlyRate });

export const finalizePayroll = (http: HttpClient, staffId: string, year: number, month: number) =>
  http.post<{ finalized: boolean }>(`/admin/payroll/${staffId}/finalize`, { year, month });

/** Mở lại tháng đã chốt/đã trả để sửa — trước đây chốt xong là không còn đường sửa trong app. */
export const reopenPayroll = (http: HttpClient, staffId: string, year: number, month: number) =>
  http.post<{ status: string }>(`/admin/payroll/${staffId}/reopen?year=${year}&month=${month}`);

export const markPaid = (
  http: HttpClient,
  staffId: string,
  body: { year: number; month: number; proofImageUrl: string; note?: string },
) => http.post<{ paid: boolean }>(`/admin/payroll/${staffId}/mark-paid`, body);

export interface AdjustPayrollInput {
  staffId: string;
  /** Ngày công YYYY-MM-DD; tháng đã chốt/đã trả thì máy chủ từ chối. */
  workDate: string;
  /** Số nguyên VND khác 0, tối đa ±50 triệu: dương = trừ lương (phạt), âm = thưởng. */
  amount: number;
  /** Dấu vết kiểm toán, máy chủ yêu cầu từ 3 ký tự. */
  reason: string;
  /** Chỉ gửi sau khi máy chủ báo khoản giống hệt vừa ghi (409 PAYROLL_ADJUST_DUPLICATE) và admin xác nhận đây là khoản thứ hai. */
  allowDuplicate?: boolean;
}

export const adjustPayroll = (http: HttpClient, body: AdjustPayrollInput) =>
  http.post<{ adjusted: boolean }>('/admin/payroll/adjust', body);

/** Tính lại tháng chưa chốt. `reprice` áp đơn giá hiện tại cho cả ngày đã tính: chỉ dùng khi đơn giá từng nhập sai. */
export const recomputePayroll = (
  http: HttpClient,
  staffId: string,
  year: number,
  month: number,
  opts: { reprice?: boolean } = {},
) =>
  http.post<PayrollMonth>(
    `/admin/payroll/${staffId}/recompute?year=${year}&month=${month}${opts.reprice ? '&reprice=1' : ''}`,
  );
