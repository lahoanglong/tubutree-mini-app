import { api } from './api';

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
export const getMyPayroll = (year: number, month: number) =>
  api.get<MyPayroll>('/staff/payroll', { params: { year, month } }).then((r) => r.data);

export const updateBank = (dto: BankInput) =>
  api.put<StaffProfile>('/staff/bank', dto).then((r) => r.data);

// ── Admin ──
export const adminGetPayroll = (year: number, month: number) =>
  api.get<AdminPayrollRow[]>('/admin/payroll', { params: { year, month } }).then((r) => r.data);

export const setRate = (userId: string, hourlyRate: number) =>
  api.put<StaffProfile>(`/admin/staff/${userId}/rate`, { hourlyRate }).then((r) => r.data);

export const finalizePayroll = (staffId: string, year: number, month: number) =>
  api.post<{ finalized: boolean }>(`/admin/payroll/${staffId}/finalize`, { year, month }).then((r) => r.data);

export const markPaid = (
  staffId: string,
  body: { year: number; month: number; proofImageUrl: string; note?: string },
) => api.post<{ paid: boolean }>(`/admin/payroll/${staffId}/mark-paid`, body).then((r) => r.data);

export const adjustPayroll = (dto: { staffId: string; workDate: string; amount: number; reason: string }) =>
  api.post<{ adjusted: boolean }>('/admin/payroll/adjust', dto).then((r) => r.data);
